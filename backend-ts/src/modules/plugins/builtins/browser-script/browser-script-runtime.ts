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

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_ACTION_TIMEOUT_MS = 3_000;
const MAX_ACTION_TIMEOUT_MS = 30_000;
const MAX_TRACE_STEPS = 100;
const MAX_LOGS = 100;
const WAIT_POLL_MS = 100;
const LOCATOR_POLL_MS = 200;

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
}

interface SnapshotState {
  generation: number;
  type: "simple" | "struct";
  tree: any;
  url?: string;
  title?: string;
}

interface RunState {
  generation: number;
  lastSnapshot: SnapshotState | null;
  trace: BrowserScriptTraceStep[];
  screenshots: BrowserScriptScreenshot[];
  logs: string[];
  lastUrl?: string;
  lastTitle?: string;
}

interface ResolveOptions {
  allowEmpty?: boolean;
  allowMultiple?: boolean;
  allowNonActionable?: boolean;
}

/**
 * 脚本运行器。
 *
 * 职责边界：
 * - Worker + vm 负责执行模型脚本（不阻塞 NestJS 事件循环，可强制终止）
 * - 本类负责把脚本调用翻译成既有 Bridge 的 browser_* 方法
 * - 快照代号、ref 校验、locator 解析、取消/超时都在宿主侧完成
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
      generation: 0,
      lastSnapshot: null,
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
          generation: state.generation,
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
      case "click": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          true,
        );
        return this.click(selector, params, state, run, signal);
      }
      case "fill": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          true,
        );
        return this.fill(selector, params.value, params, state, run, signal);
      }
      case "hover": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          true,
        );
        return this.hover(selector, params, state, run, signal);
      }
      case "press":
        return this.press(params, state, run, signal);
      case "scroll":
        return this.scroll(params, state, run, signal);
      case "selectOption": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          true,
        );
        return this.selectOption(selector, params, state, run, signal);
      }
      case "check": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          true,
        );
        return this.check(selector, params, state, run, signal);
      }
      case "elementState": {
        const selector = await this.resolveTarget(
          params.target,
          state,
          run,
          signal,
          false,
        );
        return this.elementState(selector, state, run, signal);
      }
      case "waitFor":
        return this.handleWaitFor(params, state, run, signal);
      case "locator":
        return this.handleLocator(params, state, run, signal);
      case "waitForLoadState":
        return this.waitForLoadState(params.state, params, run, signal);
      case "evaluate":
        return this.handleEvaluate(params, state, run, signal);
      case "screenshot":
        return this.handleScreenshot(params, state, run, signal);
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

    state.lastSnapshot = null;
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

    state.generation = Number(res?.generation ?? state.generation);
    const generation = state.generation;
    state.lastUrl = res?.url ?? state.lastUrl;
    state.lastTitle = res?.title ?? state.lastTitle;

    if (type === "simple" || type === "struct") {
      state.lastSnapshot = {
        generation,
        type,
        tree: res?.tree,
        url: res?.url,
        title: res?.title,
      };
    } else {
      // summary 没有可复用的 ref 树，明确作废旧快照
      state.lastSnapshot = null;
    }

    return res;
  }

  private async ensureSnapshot(
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<void> {
    if (state.lastSnapshot) return;
    await this.snapshot({ type: "simple" }, state, run, signal);
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

  // ── 定位 ──

  private async resolveTarget(
    target: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
    requireUnique = true,
  ): Promise<string> {
    if (!target || typeof target !== "object") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "target is required (ref string, CSS selector, snapshot node, or locator)",
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
        await this.ensureSnapshot(state, run, signal);
        assertRef(selector, state);
        return selector;
      }
      if (requireUnique) {
        await this.assertUniqueSelector(selector, run, signal);
      }
      return selector;
    }

    const resolved = await this.resolveLocator(target, state, run, signal);
    if (!resolved.selector) {
      throw new BrowserScriptError(
        "NOT_FOUND",
        `No actionable element matched ${describeLocator(target)}.`,
      );
    }
    return resolved.selector;
  }

  private async resolveLocator(
    descriptor: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
    options: ResolveOptions = {},
  ): Promise<{ selector: string | null; matches: any[] }> {
    if (!descriptor || typeof descriptor !== "object") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "locator descriptor is required",
      );
    }

    if (descriptor.kind === "selector") {
      const selector = String(descriptor.selector ?? "").trim();
      if (!selector) {
        throw new BrowserScriptError(
          "INVALID_ARGUMENT",
          "locator(selector) requires a non-empty string",
        );
      }
      if (/^e\d+$/.test(selector)) {
        await this.ensureSnapshot(state, run, signal);
        const node = findRef(state.lastSnapshot?.tree, selector);
        if (!node) {
          // ref 与某一次快照绑定；等待一个旧 ref 重新出现没有意义
          throw staleRef(selector, state);
        }
        return { selector, matches: [node] };
      }
      return { selector, matches: [] };
    }

    await this.ensureSnapshot(state, run, signal);
    const all = this.findLocatorMatches(descriptor, state.lastSnapshot?.tree);

    if (all.length === 0) {
      if (options.allowEmpty) return { selector: null, matches: [] };
      throw new BrowserScriptError(
        "NOT_FOUND",
        `No element matched ${describeLocator(
          descriptor,
        )}. Take a fresh snapshot and use its facts.`,
      );
    }

    const actionable = all.filter(
      (node) => typeof node.ref === "string" && node.ref.length > 0,
    );

    if (actionable.length === 0) {
      if (options.allowNonActionable) {
        return { selector: null, matches: all };
      }
      throw new BrowserScriptError(
        "NOT_ACTIONABLE",
        `Matched ${describeLocator(
          descriptor,
        )} but it has no interactive ref. Use a CSS selector or inspect the snapshot.`,
        { candidates: candidateList(all) },
      );
    }

    if (actionable.length > 1) {
      if (options.allowMultiple) {
        return { selector: actionable[0].ref, matches: all };
      }
      throw new BrowserScriptError(
        "AMBIGUOUS",
        `Locator ${describeLocator(descriptor)} matched ${
          actionable.length
        } interactive elements. Narrow it with role+name or use a unique ref.`,
        { candidates: candidateList(actionable) },
      );
    }

    return { selector: actionable[0].ref, matches: all };
  }

  private findLocatorMatches(descriptor: any, tree: any): any[] {
    if (!tree) return [];
    const matches = findNodes(tree, (node: any) => {
      if (!node || typeof node !== "object") return false;
      if (descriptor.kind === "role") {
        if (node.role !== descriptor.role) return false;
        return matchName(node.name, descriptor.name, descriptor.exact);
      }
      if (descriptor.kind === "text") {
        return matchName(
          node.name ?? node.text,
          descriptor.text,
          descriptor.exact,
        );
      }
      return false;
    });

    if (typeof descriptor.index === "number" && Number.isFinite(descriptor.index)) {
      const index = Math.trunc(descriptor.index);
      const picked = index < 0 ? matches[matches.length + index] : matches[index];
      return picked ? [picked] : [];
    }

    return matches;
  }

  private async assertUniqueSelector(
    selector: string,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<void> {
    const count = await this.evaluateRaw(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      run,
      signal,
    );
    if (count === 0) {
      throw new BrowserScriptError(
        "NOT_FOUND",
        `Selector "${selector}" matched 0 elements.`,
      );
    }
    if (typeof count === "number" && count > 1) {
      throw new BrowserScriptError(
        "AMBIGUOUS",
        `Selector "${selector}" matched ${count} elements; use a more specific selector or a role/name locator.`,
      );
    }
  }

  // ── 动作 ──

  private async click(
    selector: string,
    options: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    const res = await this.bridge.request(
      "browser_click",
      {
        selector,
        generation,
        button: normalizeMouseButton(options?.button),
        click_count: options?.clickCount,
        modifiers: normalizeModifiers(options?.modifiers),
        force: options?.force === true,
        timeout: actionTimeout(options),
        trusted: resolveTrustedOption(options),
        created_by: run.createdBy,
      },
      signal,
    );
    // 点击后 DOM 可能已变化，旧 ref 不再可信
    state.lastSnapshot = null;
    return res;
  }

  private async hover(
    selector: string,
    options: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    const res = await this.bridge.request(
      "browser_hover",
      {
        selector,
        generation,
        force: options?.force === true,
        timeout: actionTimeout(options),
        trusted: resolveTrustedOption(options),
        created_by: run.createdBy,
      },
      signal,
    );
    // hover 可能展开菜单/浮层，旧快照不再完整
    state.lastSnapshot = null;
    return res;
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

    const hasTarget = params?.target !== undefined;
    const selector = hasTarget
      ? await this.resolveTarget(params.target, state, run, signal, true)
      : undefined;
    const generation =
      selector && /^e\d+$/.test(selector)
        ? state.lastSnapshot?.generation
        : undefined;

    const res = await this.bridge.request(
      "browser_press",
      {
        key,
        ...(selector ? { selector } : {}),
        generation,
        modifiers: normalizeModifiers(params?.modifiers),
        timeout: actionTimeout(params),
        trusted: resolveTrustedOption(params),
        created_by: run.createdBy,
      },
      signal,
    );
    state.lastSnapshot = null;
    return res;
  }

  private async scroll(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const hasTarget = params?.target !== undefined;
    const selector = hasTarget
      ? await this.resolveTarget(params.target, state, run, signal, true)
      : undefined;
    const generation =
      selector && /^e\d+$/.test(selector)
        ? state.lastSnapshot?.generation
        : undefined;
    return this.bridge.request(
      "browser_scroll",
      {
        ...(selector ? { selector } : {}),
        generation,
        delta_x: params?.deltaX,
        delta_y: params?.deltaY,
        timeout: actionTimeout(params),
        created_by: run.createdBy,
      },
      signal,
    );
  }

  private async selectOption(
    selector: string,
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    const res = await this.bridge.request(
      "browser_select",
      {
        selector,
        values: params?.values ?? params?.value,
        generation,
        force: params?.force === true,
        timeout: actionTimeout(params),
        created_by: run.createdBy,
      },
      signal,
    );
    state.lastSnapshot = null;
    return res;
  }

  private async check(
    selector: string,
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    const res = await this.bridge.request(
      "browser_check",
      {
        selector,
        checked: params?.checked !== false,
        generation,
        force: params?.force === true,
        timeout: actionTimeout(params),
        trusted: resolveTrustedOption(params),
        created_by: run.createdBy,
      },
      signal,
    );
    state.lastSnapshot = null;
    return res;
  }

  private async elementState(
    selector: string,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    return this.bridge.request(
      "browser_element_state",
      { selector, generation, created_by: run.createdBy },
      signal,
    );
  }

  private async fill(
    selector: string,
    value: unknown,
    options: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    if (typeof value !== "string") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "fill(target, value) requires a string value",
      );
    }
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    return this.bridge.request(
      "browser_input",
      {
        selector,
        value,
        generation,
        force: options?.force === true,
        timeout: actionTimeout(options),
        trusted: resolveTrustedOption(options),
        created_by: run.createdBy,
      },
      signal,
    );
  }

  private async handleWaitFor(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const target = params.target;
    if (target && typeof target === "object" && target.kind !== "selector") {
      const selector = await this.waitForLocator(
        target,
        params.options ?? params,
        state,
        run,
        signal,
      );
      return { ok: true, found: true, selector };
    }

    const selector = await this.resolveTarget(
      target,
      state,
      run,
      signal,
      false,
    );
    return this.waitForSelector(
      selector,
      params.options ?? params,
      state,
      run,
      signal,
    );
  }

  private async waitForSelector(
    selector: string,
    options: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const timeout = clamp(options?.timeout, 100, 30_000, 3_000);
    const stateName = normalizeWaitState(options?.state);
    const generation = /^e\d+$/.test(selector)
      ? state.lastSnapshot?.generation
      : undefined;
    return this.bridge.request(
      "browser_wait",
      {
        selector,
        timeout,
        state: stateName,
        generation,
        created_by: run.createdBy,
      },
      signal,
    );
  }

  private async waitForLocator(
    descriptor: any,
    options: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<string> {
    const timeout = clamp(options?.timeout, 100, 30_000, 3_000);
    const stateName = normalizeWaitState(options?.state);
    if (
      descriptor.kind !== "selector" &&
      (stateName === "hidden" || stateName === "detached")
    ) {
      throw new BrowserScriptError(
        "UNSUPPORTED",
        `waitFor({state:"${stateName}"}) requires a CSS selector or ref; role/text locators can only wait for attached/visible.`,
      );
    }

    const deadline = Date.now() + timeout;
    let lastMatches: any[] = [];
    let sawMatches = false;

    for (;;) {
      const resolved = await this.resolveLocator(
        descriptor,
        state,
        run,
        signal,
        { allowEmpty: true, allowNonActionable: true },
      );
      lastMatches = resolved.matches;
      if (resolved.selector) {
        if (stateName !== "attached") {
          await this.waitForSelector(
            resolved.selector,
            {
              state: stateName,
              timeout: Math.max(100, deadline - Date.now()),
            },
            state,
            run,
            signal,
          );
        }
        return resolved.selector;
      }
      if (lastMatches.length > 0) {
        // 元素已出现但还没有可交互 ref：继续等布局/交互属性就绪，
        // 而不是立刻判死（旧实现会在这里直接抛 NOT_ACTIONABLE）。
        sawMatches = true;
      }
      if (Date.now() >= deadline) {
        if (sawMatches) {
          throw new BrowserScriptError(
            "NOT_ACTIONABLE",
            `Matched ${describeLocator(
              descriptor,
            )} but it has no interactive ref after ${timeout}ms.`,
            { candidates: candidateList(lastMatches) },
          );
        }
        throw new BrowserScriptError(
          "TIMEOUT",
          `Timed out after ${timeout}ms waiting for ${describeLocator(
            descriptor,
          )}.`,
          { candidates: candidateList(lastMatches) },
        );
      }
      state.lastSnapshot = null;
      await delay(
        Math.min(
          LOCATOR_POLL_MS,
          Math.max(1, deadline - Date.now()),
        ),
        signal,
      );
    }
  }

  private async handleLocator(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const descriptor = params.locator;
    const action = String(params.action || "");
    const options = params.options || {};

    if (!descriptor || typeof descriptor !== "object") {
      throw new BrowserScriptError(
        "INVALID_ARGUMENT",
        "locator descriptor is required",
      );
    }

    // 纯 CSS selector：不需要快照树，直接走页面 DOM
    if (
      descriptor.kind === "selector" &&
      !/^e\d+$/.test(String(descriptor.selector ?? ""))
    ) {
      const selector = String(descriptor.selector ?? "").trim();
      if (!selector) {
        throw new BrowserScriptError(
          "INVALID_ARGUMENT",
          "locator(selector) requires a non-empty string",
        );
      }

      const hasIndex =
        typeof descriptor.index === "number" &&
        Number.isFinite(descriptor.index);
      if (hasIndex && action !== "count" && action !== "text") {
        throw new BrowserScriptError(
          "UNSUPPORTED",
          "first()/last()/nth() on a CSS locator is not supported for actions; use a unique CSS selector or a role/text locator.",
          { selector, action, index: descriptor.index },
        );
      }

      if (action === "count") {
        const count = await this.evaluateRaw(
          `document.querySelectorAll(${JSON.stringify(selector)}).length`,
          run,
          signal,
        );
        if (hasIndex && typeof count === "number") {
          const index = Math.trunc(descriptor.index);
          const withinRange = index >= 0 ? index < count : -index <= count;
          return withinRange ? 1 : 0;
        }
        return count;
      }
      if (action === "text") {
        const index = hasIndex ? Math.trunc(descriptor.index) : 0;
        return this.evaluateRaw(
          `(() => { const list = document.querySelectorAll(${JSON.stringify(
            selector,
          )}); const idx = ${JSON.stringify(index)}; const el = idx < 0 ? list[list.length + idx] : list[idx]; return el ? (el.innerText || el.textContent || '') : ''; })()`,
          run,
          signal,
        );
      }
      if (action === "isVisible") {
        return this.isVisibleSelector(selector, run, signal);
      }
      if (action === "state") {
        return this.elementState(selector, state, run, signal);
      }
      if (action === "waitFor") {
        return this.waitForSelector(selector, options, state, run, signal);
      }
      if (action === "click" || action === "fill") {
        await this.assertUniqueSelector(selector, run, signal);
        return action === "click"
          ? this.click(selector, options, state, run, signal)
          : this.fill(selector, params.value, options, state, run, signal);
      }
      if (action === "hover" || action === "selectOption" || action === "check" || action === "uncheck") {
        await this.assertUniqueSelector(selector, run, signal);
        if (action === "hover") {
          return this.hover(selector, options, state, run, signal);
        }
        if (action === "selectOption") {
          return this.selectOption(
            selector,
            { ...options, values: params.values ?? params.value },
            state,
            run,
            signal,
          );
        }
        return this.check(
          selector,
          { ...options, checked: action === "check" ? params.checked !== false : false },
          state,
          run,
          signal,
        );
      }
      if (action === "press") {
        await this.assertUniqueSelector(selector, run, signal);
        return this.press(
          { ...options, key: params.key, target: { kind: "selector", selector } },
          state,
          run,
          signal,
        );
      }
      if (action === "scroll") {
        await this.assertUniqueSelector(selector, run, signal);
        return this.scroll(
          { ...options, target: { kind: "selector", selector } },
          state,
          run,
          signal,
        );
      }
      throw new BrowserScriptError(
        "UNKNOWN_ACTION",
        `Unknown locator action: ${action}`,
      );
    }

    if (action === "count") {
      await this.ensureSnapshot(state, run, signal);
      const matches = this.findLocatorMatches(
        descriptor,
        state.lastSnapshot?.tree,
      );
      return matches.length;
    }

    if (action === "text") {
      const resolved = await this.resolveLocator(
        descriptor,
        state,
        run,
        signal,
        { allowEmpty: true, allowMultiple: true, allowNonActionable: true },
      );
      const node = resolved.matches[0];
      return node ? node.name ?? node.text ?? "" : "";
    }

    if (action === "isVisible") {
      const resolved = await this.resolveLocator(
        descriptor,
        state,
        run,
        signal,
        { allowEmpty: true, allowMultiple: true, allowNonActionable: true },
      );
      if (!resolved.selector) return false;
      return this.isVisibleSelector(
        resolved.selector,
        run,
        signal,
        state.lastSnapshot?.generation,
      );
    }

    if (action === "state") {
      const resolved = await this.resolveLocator(
        descriptor,
        state,
        run,
        signal,
        { allowEmpty: true, allowMultiple: true, allowNonActionable: true },
      );
      if (!resolved.selector) {
        return { ok: true, found: false, visible: false, enabled: false, editable: false, stable: false, inViewport: false, covered: true, tagName: "", rect: { x: 0, y: 0, width: 0, height: 0 }, viewport: { width: 0, height: 0 } };
      }
      return this.elementState(resolved.selector, state, run, signal);
    }

    if (action === "waitFor") {
      const selector = await this.waitForLocator(
        descriptor,
        options,
        state,
        run,
        signal,
      );
      return { ok: true, found: true, selector };
    }

    if (
      action === "click" ||
      action === "fill" ||
      action === "hover" ||
      action === "selectOption" ||
      action === "check" ||
      action === "uncheck" ||
      action === "press" ||
      action === "scroll"
    ) {
      const resolved = await this.resolveLocator(
        descriptor,
        state,
        run,
        signal,
      );
      if (!resolved.selector) {
        throw new BrowserScriptError(
          "NOT_FOUND",
          `No actionable element matched ${describeLocator(descriptor)}.`,
        );
      }
      if (action === "click") {
        return this.click(resolved.selector, options, state, run, signal);
      }
      if (action === "fill") {
        return this.fill(
          resolved.selector,
          params.value,
          options,
          state,
          run,
          signal,
        );
      }
      if (action === "hover") {
        return this.hover(resolved.selector, options, state, run, signal);
      }
      if (action === "selectOption") {
        return this.selectOption(
          resolved.selector,
          { ...options, values: params.values ?? params.value },
          state,
          run,
          signal,
        );
      }
      if (action === "check" || action === "uncheck") {
        return this.check(
          resolved.selector,
          { ...options, checked: action === "check" ? params.checked !== false : false },
          state,
          run,
          signal,
        );
      }
      if (action === "press") {
        return this.press(
          { ...options, key: params.key, target: { kind: "selector", selector: resolved.selector } },
          state,
          run,
          signal,
        );
      }
      return this.scroll(
        { ...options, target: { kind: "selector", selector: resolved.selector } },
        state,
        run,
        signal,
      );
    }

    throw new BrowserScriptError(
      "UNKNOWN_ACTION",
      `Unknown locator action: ${action}`,
    );
  }

  private async isVisibleSelector(
    selector: string,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
    generation?: number,
  ): Promise<boolean> {
    const state = await this.bridge.request(
      "browser_element_state",
      { selector, generation, created_by: run.createdBy },
      signal,
    );
    return state?.found === true && state?.visible === true;
  }

  // ── 页面 JavaScript ──

  private async handleEvaluate(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const code = toPageCode(params.fn, params.arg);
    const value = await this.evaluateRaw(code, run, signal, true);
    // evaluate 可能改 DOM，旧 ref 不再可信
    state.lastSnapshot = null;
    return value;
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
    const res = await this.bridge.request(
      "browser_screenshot",
      {
        created_by: run.createdBy,
        file_path: params.filePath,
        session_path: run.sessionPath,
        full_page: Boolean(params.fullPage),
      },
      signal,
    );

    const screenshot: BrowserScriptScreenshot = {
      path: res?.path,
      width: res?.width,
      height: res?.height,
    };
    if (screenshot.path) state.screenshots.push(screenshot);
    return res;
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

    const res = await this.bridge.request(
      "browser_history",
      { action, created_by: run.createdBy },
      signal,
    );

    state.lastSnapshot = null;
    return res;
  }

  private async handleTabs(
    params: any,
    state: RunState,
    run: BrowserScriptRunParams,
    signal?: AbortSignal,
  ): Promise<any> {
    const action = String(params.action || "");
    const res = await this.bridge.request(
      "browser_tabs",
      {
        action,
        index: params.index,
        created_by: run.createdBy,
      },
      signal,
    );

    if (action === "select" || action === "close" || action === "close_all") {
      state.lastSnapshot = null;
    }
    return res;
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

function normalizeMouseButton(value: unknown): "left" | "right" | "middle" | undefined {
  const button = typeof value === "string" ? value.toLowerCase() : "";
  return button === "right" || button === "middle" || button === "left"
    ? button
    : undefined;
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

function findNodes(node: any, predicate: (node: any) => boolean): any[] {
  const out: any[] = [];
  const walk = (current: any): void => {
    if (!current || typeof current !== "object") return;
    if (predicate(current)) out.push(current);
    const children = Array.isArray(current.children) ? current.children : [];
    for (const child of children) walk(child);
  };
  walk(node);
  return out;
}

function findRef(node: any, ref: string): any | null {
  if (!node || typeof node !== "object") return null;
  if (node.ref === ref) return node;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const found = findRef(child, ref);
    if (found) return found;
  }
  return null;
}

function assertRef(ref: string, state: RunState): any {
  const node = findRef(state.lastSnapshot?.tree, ref);
  if (!node) {
    throw staleRef(ref, state);
  }
  return node;
}

function staleRef(ref: string, state: RunState): BrowserScriptError {
  return new BrowserScriptError(
    "STALE_REF",
    `Ref "${ref}" is not present in the current snapshot (generation ${state.generation}). Call tab.snapshot() and use a ref from that result.`,
  );
}

function matchName(value: unknown, pattern: unknown, exact?: boolean): boolean {
  if (pattern === undefined || pattern === null) return true;
  const text = String(value ?? "");
  if (Object.prototype.toString.call(pattern) === "[object RegExp]") {
    return (pattern as RegExp).test(text);
  }
  const needle = String(pattern);
  return exact === true ? text === needle : text.includes(needle);
}

function candidateList(
  nodes: any[],
): Array<{ ref?: string; role?: string; name?: string }> {
  return nodes.slice(0, 5).map((node) => {
    const name = node.name ?? node.text;
    return {
      ...(node.ref ? { ref: String(node.ref) } : {}),
      ...(node.role ? { role: String(node.role) } : {}),
      ...(name ? { name: String(name).slice(0, 80) } : {}),
    };
  });
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
  if (descriptor.kind === "text") {
    return `text=${String(descriptor.text)}`;
  }
  return JSON.stringify(descriptor);
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
      return String(params?.filePath ?? "viewport");
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
