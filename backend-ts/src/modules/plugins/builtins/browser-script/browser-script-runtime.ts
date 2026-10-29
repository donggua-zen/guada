import { Logger } from "@nestjs/common";
import { Worker } from "worker_threads";
import { BridgeClient, BridgeRequestError } from "../../../bridge/bridge-client";
import { BROWSER_SCRIPT_WORKER_SOURCE } from "./browser-script.worker";
import {
  BrowserScriptErrorPayload,
  BrowserScriptRunResult,
  BrowserScriptScreenshot,
  BrowserScriptTraceStep,
} from "./browser-script.types";
import type { FileRef } from "../../../../common/types/conversation.types";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_ACTION_TIMEOUT_MS = 3_000;
const MAX_ACTION_TIMEOUT_MS = 30_000;
const MAX_TRACE_STEPS = 100;
const MAX_LOGS = 100;
const WAIT_POLL_MS = 100;

/** 渲染视口固定尺寸范围（与前端 VIEWPORT_MIN/MAX、Electron 侧校验保持一致） */
const MIN_VIEWPORT_WIDTH = 320;
const MAX_VIEWPORT_WIDTH = 3840;
const MIN_VIEWPORT_HEIGHT = 240;
const MAX_VIEWPORT_HEIGHT = 2160;

export class BrowserScriptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "BrowserScriptError";
  }
}

export interface BrowserScriptRunParams {
  script: string;
  name?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  /** 实际发起调用的 Agent 会话（沿用浏览器服务既有 created_by 约定） */
  createdBy: string;
  /** 所属父会话（用于标签可见性，沿用浏览器服务既有 session_id 约定） */
  ownerSessionId: string;
  sessionPath: string;
  /**
   * 截图落盘回调（由插件按会话注入，runtime 不感知存储实现）。
   *
   * 返回会话副本引用与物理路径；`saveTo` 由调用方解释为「额外导出到工作区」。
   * 截图字节不会返回给 worker，落盘后即释放。
   */
  persistScreenshot?: (
    data: Buffer,
    meta: { width?: number; height?: number; saveTo?: string },
  ) => Promise<{
    ref?: FileRef;
    absolutePath?: string;
    exportedPath?: string;
  }>;
}

interface RunState {
  trace: BrowserScriptTraceStep[];
  screenshots: BrowserScriptScreenshot[];
  logs: string[];
  lastUrl?: string;
  lastTitle?: string;
}

/**
 * 脚本运行器。
 *
 * 职责边界：
 * - Worker + vm 负责执行模型脚本（不阻塞 NestJS 事件循环，可强制终止）
 * - 本类负责把脚本调用翻译成 Bridge 的 browser_* 方法
 * - locator 由 Electron/ivya 在动作时 live 解析；snapshot 只用于观察
 */
export class BrowserScriptRuntime {
  private readonly logger = new Logger(BrowserScriptRuntime.name);

  constructor(private readonly bridge: BridgeClient) {}

  async run(
    params: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<BrowserScriptRunResult> {
    const timeoutMs = clamp(
      params.timeoutMs,
      1000,
      MAX_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    );
    const startedAt = Date.now();
    const state: RunState = {
      trace: [],
      screenshots: [],
      logs: [],
    };

    return new Promise<BrowserScriptRunResult>((resolve) => {
      let worker: Worker | null = null;
      let timer: NodeJS.Timeout | null = null;
      let settled = false;
      // 内部取消源：超时/外部取消时中断仍在途的 Bridge 请求。
      // 只销毁 worker 不会停止主进程里的页面操作，所以必须有这一层。
      const controller = new AbortController();
      const bridgeSignal = controller.signal;

      function onAbort(): void {
        controller.abort();
        try {
          worker?.postMessage({
            type: "cancel",
            reason: "Browser script cancelled",
          });
        } catch {
          /* worker 可能已退出 */
        }
        finalize({ status: "cancelled" });
      }

      const finalize = (
        partial: Partial<BrowserScriptRunResult> & {
          status: BrowserScriptRunResult["status"];
        },
      ): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        controller.abort();

        const result: BrowserScriptRunResult = {
          status: partial.status,
          value: partial.value,
          error: partial.error,
          trace: state.trace,
          screenshots: state.screenshots,
          logs: state.logs,
          lastUrl: state.lastUrl,
          lastTitle: state.lastTitle,
          durationMs: Date.now() - startedAt,
        };

        try {
          void worker?.terminate();
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      if (signal?.aborted) {
        controller.abort();
        finalize({ status: "cancelled" });
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      if (!params.script || !params.script.trim()) {
        finalize({
          status: "failed",
          error: {
            code: "SCRIPT_PARSE",
            message: "script must be a non-empty string",
          },
        });
        return;
      }

      try {
        worker = new Worker(BROWSER_SCRIPT_WORKER_SOURCE, {
          eval: true,
          workerData: { script: params.script, args: params.args ?? {} },
          resourceLimits: {
            maxOldGenerationSizeMb: 256,
            maxYoungGenerationSizeMb: 32,
          },
        });
      } catch (error) {
        finalize({
          status: "failed",
          error: {
            code: "WORKER_START_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        return;
      }

      timer = setTimeout(() => {
        try {
          worker?.postMessage({
            type: "cancel",
            reason: `Browser script timed out after ${timeoutMs}ms`,
          });
        } catch {
          /* ignore */
        }
        finalize({
          status: "failed",
          error: {
            code: "TIMEOUT",
            message: `Browser script timed out after ${timeoutMs}ms`,
          },
        });
      }, timeoutMs);

      worker.on("message", (msg: any) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "ready") {
          try {
            worker?.postMessage({ type: "go" });
          } catch {
            /* ignore */
          }
          return;
        }

        if (msg.type === "log") {
          if (state.logs.length < MAX_LOGS) {
            state.logs.push(String(msg.message ?? ""));
          }
          return;
        }

        if (msg.type === "call") {
          void this.dispatch(msg.method, msg.params ?? {}, state, params, bridgeSignal)
            .then((value) => {
              if (settled) return;
              try {
                worker?.postMessage({
                  type: "call-result",
                  callId: msg.callId,
                  ok: true,
                  value,
                });
              } catch {
                /* ignore */
              }
            })
            .catch((error) => {
              if (settled) return;
              try {
                worker?.postMessage({
                  type: "call-result",
                  callId: msg.callId,
                  ok: false,
                  error: toErrorPayload(error),
                });
              } catch {
                /* ignore */
              }
            });
          return;
        }

        if (msg.type === "result") {
          finalize({ status: "completed", value: msg.value });
          return;
        }

        if (msg.type === "error") {
          finalize({ status: "failed", error: normalizeWorkerError(msg.error) });
        }
      });

      worker.on("error", (error: Error) => {
        if (settled) return;
        this.logger.warn(`browser-script worker error: ${error.message}`);
        finalize({
          status: "failed",
          error: { code: "WORKER_CRASHED", message: error.message },
        });
      });

      worker.on("exit", (code) => {
        if (settled) return;
        finalize({
          status: "failed",
          error: {
            code: "WORKER_EXITED",
            message: `Browser script worker exited with code ${code}`,
          },
        });
      });
    });
  }

  // ── 调用分发 ──

  private async dispatch(
    method: string,
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const startedAt = Date.now();
    const target = summarizeCall(method, params);
    try {
      const value = await this.handleCall(method, params, state, run, signal);
      pushTrace(state, {
        method,
        target,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return value;
    } catch (error) {
      const payload = toErrorPayload(error);
      pushTrace(state, {
        method,
        target,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: { code: payload.code, message: payload.message },
      });
      throw error;
    }
  }

  private async handleCall(
    method: string,
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    switch (method) {
      case "goto":
        return this.goto(params, state, run, signal);
      case "snapshot":
        return this.snapshot(params, state, run, signal);
      case "click":
        return this.locatorAction(params.target, "click", params, state, run, signal);
      case "fill":
        return this.locatorAction(params.target, "fill", params, state, run, signal);
      case "hover":
        return this.locatorAction(params.target, "hover", params, state, run, signal);
      case "press":
        return this.press(params, state, run, signal);
      case "scroll":
        return this.scroll(params, state, run, signal);
      case "selectOption":
        return this.locatorAction(
          params.target,
          "selectOption",
          params,
          state,
          run,
          signal,
        );
      case "check":
        return this.locatorAction(params.target, "check", params, state, run, signal);
      case "elementState":
        return this.locatorAction(params.target, "state", params, state, run, signal);
      case "waitFor":
        return this.locatorAction(params.target, "wait", params, state, run, signal);
      case "locator":
        return this.handleLocator(params, state, run, signal);
      case "waitForLoadState":
        return this.waitForLoadState(params.state, params, run, signal);
      case "evaluate":
        return this.handleEvaluate(params, state, run, signal);
      case "screenshot":
        return this.handleScreenshot(params, state, run, signal);
      case "setViewport":
        return this.setViewport(params, run, signal);
      case "console":
        return this.handleConsole(params, run, signal);
      case "history":
        return this.handleHistory(params, state, run, signal);
      case "tabs":
        return this.handleTabs(params, state, run, signal);
      case "info":
        return this.handleInfo(state, run, signal);
      default:
        throw new BrowserScriptError(
          "UNKNOWN_METHOD",
          `Unknown browser script method: ${method}`,
        );
    }
  }

  // ── 导航与快照 ──

  private async handleConsole(
    params: any,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any[]> {
    const logs = await this.bridge.request(
      "browser_console",
      { created_by: run.createdBy, clear: params?.clear === true },
      signal,
    );
    return Array.isArray(logs) ? logs : [];
  }

  private async goto(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const url = String(params.url ?? "").trim();
    if (!url) {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "goto(url, options?) requires a URL string",
      );
    }
    if (/^javascript:/i.test(url)) {
      throw new BrowserScriptError(
        "NAVIGATION_BLOCKED",
        "Navigation to javascript: URLs is not allowed",
      );
    }

    const res = await this.bridge.request(
      "browser_navigate",
      {
        url,
        new_tab: Boolean(params.newTab),
        wait_until: String(params.waitUntil || "domcontentloaded"),
        session_path: run.sessionPath,
        session_id: run.ownerSessionId,
        created_by: run.createdBy,
      },
      signal,
    );

    state.lastUrl = res?.url ?? state.lastUrl;
    state.lastTitle = res?.title ?? state.lastTitle;
    return res;
  }

  private async snapshot(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const type = String(params.type || "simple");
    if (type !== "simple" && type !== "struct" && type !== "summary") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        'snapshot type must be "simple", "struct", or "summary"',
      );
    }

    const res = await this.bridge.request(
      "browser_snapshot",
      {
        type,
        wait_for_load: params.waitForLoad === true,
        created_by: run.createdBy,
      },
      signal,
    );

    state.lastUrl = res?.url ?? state.lastUrl;
    state.lastTitle = res?.title ?? state.lastTitle;
    return res;
  }

  private async waitForLoadState(
    stateName: string,
    options: any,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const name = String(stateName || "domcontentloaded");
    if (name === "networkidle") {
      throw new BrowserScriptError(
        "UNSUPPORTED",
        'networkidle is not supported by the embedded browser; use "domcontentloaded" or "load".',
      );
    }
    if (name !== "domcontentloaded" && name !== "load") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        'waitForLoadState requires "domcontentloaded" or "load"',
      );
    }

    const timeout = clamp(options?.timeout, 100, 10_000, 3_000);
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const readyState = await this.evaluateRaw(
          "document.readyState",
          run,
          signal,
        );
        if (
          name === "load"
            ? readyState === "complete"
            : readyState === "interactive" || readyState === "complete"
        ) {
          return { state: readyState };
        }
      } catch (error) {
        lastError = error;
      }
      await delay(
        Math.min(WAIT_POLL_MS, Math.max(1, deadline - Date.now())),
        signal,
      );
    }

    throw new BrowserScriptError(
      "TIMEOUT",
      `Timed out after ${timeout}ms waiting for "${name}"${
        lastError instanceof Error ? `: ${lastError.message}` : ""
      }.`,
    );
  }

  // ── 定位与动作 ──

  private normalizeTarget(target: any): any {
    if (!target || typeof target !== "object") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "target is required (CSS selector or locator from getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle/locator)",
      );
    }

    if (target.kind === "selector") {
      const selector = String(target.selector ?? "").trim();
      if (!selector) {
        throw new BrowserScriptError(
          "INVALID_ARGUMENT",
          "target selector must be a non-empty string",
        );
      }
      if (/^e\d+$/.test(selector)) {
        throw new BrowserScriptError(
          "INVALID_ARGUMENT",
          `Ref target "${selector}" was removed. Use tab.getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle or tab.locator(css) instead.`,
        );
      }
      return toWireDescriptor({
        ...target,
        kind: "selector",
        selector,
        ...(typeof target.index === "number" ? { index: target.index } : {}),
      });
    }

    const locatorKinds = new Set([
      "role",
      "text",
      "label",
      "placeholder",
      "testid",
      "altText",
      "title",
    ]);
    if (!locatorKinds.has(String(target.kind))) {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        `Unknown locator kind: ${String(target.kind)}`,
      );
    }
    return toWireDescriptor(target);
  }

  private async locatorAction(
    target: any,
    action: string,
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const descriptor = this.normalizeTarget(target);
    const optionSource = params?.options ?? params ?? {};
    const payload: any = {
      descriptor,
      action,
      options: pickActionOptions(optionSource),
      created_by: run.createdBy,
    };
    if (params?.value !== undefined) payload.value = params.value;
    if (params?.key !== undefined) payload.key = params.key;
    if (params?.values !== undefined) payload.values = toWireValue(params.values);
    if (params?.checked !== undefined) {
      payload.checked = params.checked !== false;
    }
    if (action === "wait") {
      payload.state = normalizeWaitState(optionSource?.state ?? params?.state);
      payload.timeout = clamp(optionSource?.timeout, 100, 30_000, 3_000);
    } else {
      payload.timeout = actionTimeout(optionSource);
    }

    const result = await this.bridge.request("browser_locator", payload, signal);
    state.lastUrl = result?.url ?? state.lastUrl;
    state.lastTitle = result?.title ?? state.lastTitle;
    return result;
  }

  private async press(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const key = String(params?.key ?? "").trim();
    if (!key) {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "press(key) requires a key name such as Enter, Tab, Escape, ArrowDown, or Control+A",
      );
    }

    if (params?.target !== undefined) {
      return this.locatorAction(params.target, "press", { ...params, key }, state, run, signal);
    }

    const result = await this.bridge.request(
      "browser_press",
      {
        key,
        modifiers: normalizeModifiers(params?.modifiers),
        timeout: actionTimeout(params),
        trusted: resolveTrustedOption(params),
        created_by: run.createdBy,
      },
      signal,
    );
    return result;
  }

  private async scroll(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    if (params?.target !== undefined) {
      return this.locatorAction(params.target, "scroll", params, state, run, signal);
    }
    return this.bridge.request(
      "browser_scroll",
      {
        delta_x: params?.deltaX,
        delta_y: params?.deltaY,
        timeout: actionTimeout(params),
        created_by: run.createdBy,
      },
      signal,
    );
  }

  private async handleLocator(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const descriptor = params?.locator;
    if (!descriptor || typeof descriptor !== "object") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "locator descriptor is required",
      );
    }
    const action = String(params.action || "");
    switch (action) {
      case "click":
      case "fill":
      case "hover":
      case "press":
      case "scroll":
      case "selectOption":
      case "check":
      case "uncheck":
      case "state":
      case "count":
      case "text":
      case "isVisible":
      case "waitFor": {
        const bridgeAction = action === "waitFor" ? "wait" : action;
        return this.locatorAction(
          descriptor,
          bridgeAction,
          params,
          state,
          run,
          signal,
        );
      }
      default:
        throw new BrowserScriptError(
          "UNKNOWN_ACTION",
          `Unknown locator action: ${action}`,
        );
    }
  }


  // ── 页面 JavaScript ──

  private async handleEvaluate(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const code = toPageCode(params.fn, params.arg);
    return this.evaluateRaw(code, run, signal, true);
  }

  private async evaluateRaw(
    code: string,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
    mutates: boolean = false,
  ): Promise<any> {
    return this.bridge.request(
      "browser_evaluate",
      { code, mutates, created_by: run.createdBy },
      signal,
    );
  }

  // ── 截图 / 历史 / 标签 ──

  private async handleScreenshot(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const saveTo =
      typeof params?.saveTo === "string" && params.saveTo.trim()
        ? params.saveTo.trim()
        : undefined;

    const res = await this.bridge.request(
      "browser_screenshot",
      {
        created_by: run.createdBy,
        full_page: Boolean(params?.fullPage),
        // 仅影响捕获端是否保留原始栅格（显式导出时不做降采样）
        wants_save: Boolean(saveTo),
      },
      signal,
    );

    const base64 = typeof res?.data === "string" ? res.data : "";
    if (!base64) {
      throw new BrowserScriptError(
        "SCREENSHOT_FAILED",
        "screenshot returned no image data",
      );
    }
    if (!run.persistScreenshot) {
      throw new BrowserScriptError(
        "SCREENSHOT_FAILED",
        "screenshot persistence is not configured",
      );
    }

    const saved = await run.persistScreenshot(Buffer.from(base64, "base64"), {
      width: res?.width,
      height: res?.height,
      saveTo,
    });

    state.screenshots.push({
      ref: saved.ref,
      absolutePath: saved.absolutePath,
      ...(saved.exportedPath ? { exportedPath: saved.exportedPath } : {}),
      width: res?.width,
      height: res?.height,
    });

    // 只把小对象回给 worker：base64 若进入 worker（256MB 堆）会在循环截图时 OOM。
    return {
      ok: true,
      width: res?.width,
      height: res?.height,
      ...(saved.exportedPath ? { savedTo: saved.exportedPath } : {}),
    };
  }

  /**
   * 设置当前标签（或显式 tabId）的固定渲染视口。
   * 仅接受整数与固定范围；实际生效值由 Electron 回读 guest 后返回。
   */
  private async setViewport(
    params: any,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const width = Number(params?.width);
    const height = Number(params?.height);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MIN_VIEWPORT_WIDTH ||
      width > MAX_VIEWPORT_WIDTH ||
      height < MIN_VIEWPORT_HEIGHT ||
      height > MAX_VIEWPORT_HEIGHT
    ) {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        `setViewportSize requires integer width ${MIN_VIEWPORT_WIDTH}-${MAX_VIEWPORT_WIDTH} and height ${MIN_VIEWPORT_HEIGHT}-${MAX_VIEWPORT_HEIGHT}`,
        { width: params?.width, height: params?.height },
      );
    }

    const tabId =
      typeof params?.tabId === "string" && params.tabId.trim()
        ? params.tabId.trim()
        : undefined;

    return this.bridge.request(
      "browser_set_viewport",
      {
        width,
        height,
        created_by: run.createdBy,
        ...(tabId ? { tab_id: tabId } : {}),
      },
      signal,
    );
  }

  private async handleHistory(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const action = String(params.action || "");
    if (action !== "back" && action !== "forward" && action !== "reload") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        'history action must be "back", "forward", or "reload"',
      );
    }

    return this.bridge.request(
      "browser_history",
      { action, created_by: run.createdBy },
      signal,
    );
  }

  private async handleTabs(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const action = String(params.action || "");
    return this.bridge.request(
      "browser_tabs",
      {
        action,
        index: params.index,
        created_by: run.createdBy,
      },
      signal,
    );
  }

  private async handleInfo(
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const current = await this.bridge.request(
      "browser_tabs",
      { action: "current", created_by: run.createdBy },
      signal,
    );
    if (!current) return null;

    state.lastUrl = current.url ?? state.lastUrl;
    state.lastTitle = current.title ?? state.lastTitle;
    return current;
  }
}

// ── 工具函数 ──

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number = min,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function actionTimeout(options: any): number {
  return clamp(
    options?.timeout,
    100,
    MAX_ACTION_TIMEOUT_MS,
    DEFAULT_ACTION_TIMEOUT_MS,
  );
}

function pickActionOptions(options: any): Record<string, unknown> {
  const keys = [
    "button",
    "clickCount",
    "modifiers",
    "force",
    "timeout",
    "trusted",
    "fullSimulation",
    "deltaX",
    "deltaY",
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (options && options[key] !== undefined) out[key] = options[key];
  }
  return out;
}

function normalizeModifiers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modifiers = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return modifiers.length > 0 ? modifiers : undefined;
}

function resolveTrustedOption(options: any): boolean | undefined {
  if (options?.trusted !== undefined) return options.trusted === true;
  if (options?.fullSimulation !== undefined) {
    return options.fullSimulation === true;
  }
  return undefined;
}

function normalizeWaitState(value: unknown): "attached" | "visible" | "hidden" | "detached" {
  if (value === "attached" || value === "hidden" || value === "detached") {
    return value;
  }
  if (value === undefined || value === null || value === "visible") {
    return "visible";
  }
  throw new BrowserScriptError(
    "INVALID_ARGUMENT",
    'waitFor state must be "attached", "visible", "hidden", or "detached"',
    { state: value },
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BrowserScriptError("CANCELLED", "Browser script cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new BrowserScriptError("CANCELLED", "Browser script cancelled"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toWireValue(value: any): any {
  if (Object.prototype.toString.call(value) === "[object RegExp]") {
    return { __regexp: (value as RegExp).source, flags: (value as RegExp).flags };
  }
  if (Array.isArray(value)) return value.map(toWireValue);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toWireValue(item);
    }
    return out;
  }
  return value;
}

function toWireDescriptor(descriptor: any): any {
  return toWireValue(descriptor);
}

function describeTarget(target: any): string {
  if (!target || typeof target !== "object") return String(target ?? "");
  if (target.kind === "selector") {
    return String(target.selector ?? "").slice(0, 120);
  }
  return describeLocator(target);
}

function describeLocator(descriptor: any): string {
  if (!descriptor || typeof descriptor !== "object") {
    return String(descriptor ?? "");
  }
  if (descriptor.kind === "selector") {
    return String(descriptor.selector ?? "");
  }
  if (descriptor.kind === "role") {
    const name =
      descriptor.name === undefined
        ? ""
        : ` name=${String(descriptor.name)}`;
    return `role=${String(descriptor.role)}${name}`;
  }
  if (
    descriptor.kind === "text" ||
    descriptor.kind === "label" ||
    descriptor.kind === "placeholder" ||
    descriptor.kind === "altText" ||
    descriptor.kind === "title"
  ) {
    return `${String(descriptor.kind)}=${String(descriptor.text)}`;
  }
  if (descriptor.kind === "testid") {
    return `testid=${String(descriptor.testId)}`;
  }
  return JSON.stringify(toWireValue(descriptor));
}

function summarizeCall(method: string, params: any): string | undefined {
  switch (method) {
    case "goto":
      return String(params?.url ?? "").slice(0, 160);
    case "snapshot":
      return String(params?.type ?? "simple");
    case "click":
    case "fill":
    case "hover":
    case "waitFor":
    case "selectOption":
    case "check":
    case "uncheck":
    case "elementState":
      return describeTarget(params?.target);
    case "press":
      return `${String(params?.key ?? "")}${params?.target ? ` @ ${describeTarget(params.target)}` : ""}`;
    case "scroll":
      return params?.target
        ? describeTarget(params.target)
        : `${params?.deltaX ?? 0},${params?.deltaY ?? 0}`;
    case "locator":
      return `${describeLocator(params?.locator)}:${String(
        params?.action ?? "",
      )}`;
    case "tabs":
    case "history":
      return String(params?.action ?? "");
    case "evaluate":
      return "<js>";
    case "screenshot":
      return String(params?.saveTo ?? "viewport");
    case "setViewport":
      return `${String(params?.width ?? "?")}x${String(params?.height ?? "?")}`;
    default:
      return undefined;
  }
}

function pushTrace(
  state: RunState,
  step: BrowserScriptTraceStep,
): void {
  state.trace.push(step);
  if (state.trace.length > MAX_TRACE_STEPS) {
    state.trace.splice(0, state.trace.length - MAX_TRACE_STEPS);
  }
}

function toPageCode(fn: unknown, arg: unknown): string {
  const source = String(fn ?? "").trim();
  if (!source) {
    throw new BrowserScriptError(
      "INVALID_ARGUMENT",
      "evaluate(fn, arg?) requires a function or code string",
    );
  }

  const isFunction =
    /^(async\s+)?function\b/.test(source) ||
    /^(async\s+)?\(?[\w\s,]*\)?\s*=>/.test(source);
  if (isFunction) {
    return `(${source})(${JSON.stringify(arg ?? null)})`;
  }

  const hasStatements = /\breturn\b/.test(source) || source.includes(";");
  if (hasStatements) {
    return `(async () => {\n${source}\n})()`;
  }
  return `(async () => (${source}))()`;
}

const BRIDGE_ERROR_CODE_MAP: Record<string, string> = {
  ELEMENT_NOT_FOUND: "NOT_FOUND",
  ACTION_TIMEOUT: "TIMEOUT",
  NAVIGATION_TIMEOUT: "TIMEOUT",
  BRIDGE_TIMEOUT: "TIMEOUT",
  BRIDGE_DISCONNECTED: "CALL_FAILED",
};

function mapBridgeCode(code: string): string {
  return BRIDGE_ERROR_CODE_MAP[code] || code;
}

function toErrorPayload(error: unknown): BrowserScriptErrorPayload {
  if (error instanceof BrowserScriptError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof BridgeRequestError) {
    return {
      code: mapBridgeCode(error.code),
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  const any = error as any;
  if (any?.name === "AbortError" || any?.code === "ABORT_ERR") {
    return { code: "CANCELLED", message: "Browser call was cancelled" };
  }
  return {
    code: mapBridgeCode(String(any?.code || "CALL_FAILED")),
    message: String(any?.message || error),
    ...(any?.details === undefined ? {} : { details: any.details }),
  };
}

function normalizeWorkerError(error: any): BrowserScriptErrorPayload {
  if (!error || typeof error !== "object") {
    return { code: "SCRIPT_ERROR", message: String(error) };
  }
  return {
    code: String(error.code || "SCRIPT_ERROR"),
    message: String(error.message || "Browser script failed"),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}
