import { Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { BridgeClient, BridgeRequestError } from "../../../bridge/bridge-client";
import { AskDeniedError } from "../../../../common/types/ask.types";
import type { FileRef } from "../../../../common/types/conversation.types";
import { requiredObservationKind } from "../computer-use/lease";
import type { ComputerPolicyKey } from "../computer-use/policy";
import { COMPUTER_SCRIPT_WORKER_SOURCE } from "./computer-script.worker";
import {
  ComputerScriptError,
  ComputerScriptErrorPayload,
  ComputerScriptRunParams,
  ComputerScriptRunResult,
  ComputerScriptScreenshot,
  ComputerScriptTraceStep,
} from "./computer-script.types";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_TRACE_STEPS = 100;
const MAX_LOGS = 100;
const MAX_ACTIONS = 60;
const MAX_OBSERVATIONS = 40;
const MAX_SCREENSHOTS = 20;
const MAX_TEXT_LENGTH = 65_536;

const FATAL_CODES = new Set([
  "POLICY_DENIED",
  "APPROVAL_UNAVAILABLE",
  "PLAN_MODE_DENIED",
  "COMPUTER_BUSY",
  "ACTION_LIMIT",
  "OBSERVATION_LIMIT",
  "SCREENSHOT_LIMIT",
  "TIMEOUT",
  "CANCELLED",
  "SIDECAR_UNAVAILABLE",
  "PERMISSION_REQUIRED",
  "UNAVAILABLE",
  "CALL_FAILED",
  "WORKER_CRASHED",
  "WORKER_EXITED",
  "WORKER_START_FAILED",
]);

interface RunState {
  trace: ComputerScriptTraceStep[];
  screenshots: ComputerScriptScreenshot[];
  logs: string[];
  actions: number;
  observations: number;
  usedComputer: boolean;
  screenshotDir: string;
  screenshotSeq: number;
}

/**
 * 桌面脚本运行器。
 *
 * 职责边界：
 * - Worker + vm 负责执行模型脚本（不阻塞 NestJS 事件循环，可强制终止）
 * - 本类把脚本调用翻译成 Bridge 的 computer_* 方法
 * - 策略/审批/计划模式由插件通过 hooks 注入；租约由本类自动携带
 * - 截图字节交给插件的 persistScreenshot 回调，不进入 worker / meta
 */
export class ComputerScriptRuntime {
  private readonly logger = new Logger(ComputerScriptRuntime.name);

  constructor(private readonly bridge: BridgeClient) {}

  async run(
    params: ComputerScriptRunParams,
    signal?: AbortSignal,
  ): Promise<ComputerScriptRunResult> {
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
      actions: 0,
      observations: 0,
      usedComputer: false,
      screenshotDir: path.join(
        params.hooks.screenshotDir ||
          path.join(os.tmpdir(), "guada-computer-script"),
        sanitizeSegment(params.hooks.sessionId || "session"),
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
      screenshotSeq: 0,
    };

    return new Promise<ComputerScriptRunResult>((resolve) => {
      let worker: Worker | null = null;
      let timer: NodeJS.Timeout | null = null;
      let settled = false;
      // 内部取消源：超时/外部取消时中断仍在途的 Bridge 请求。
      // 只销毁 worker 不会停止主进程里的桌面动作，所以必须有这一层。
      const controller = new AbortController();
      const bridgeSignal = controller.signal;
      // 审批等待不计入脚本超时：authorize 前后顺延 deadline。
      let deadline = startedAt + timeoutMs;

      const scheduleTimeout = (): void => {
        if (settled) return;
        if (timer) clearTimeout(timer);
        const remaining = Math.max(0, deadline - Date.now());
        timer = setTimeout(() => {
          try {
            worker?.postMessage({
              type: "cancel",
              reason: `Computer script timed out after ${timeoutMs}ms`,
            });
          } catch {
            /* worker 可能已退出 */
          }
          finalize({
            status: "failed",
            error: {
              code: "TIMEOUT",
              message: `Computer script timed out after ${timeoutMs}ms`,
            },
          });
        }, remaining);
      };

      const onAbort = (): void => {
        controller.abort();
        try {
          worker?.postMessage({
            type: "cancel",
            reason: "Computer script cancelled",
          });
        } catch {
          /* worker 可能已退出 */
        }
        finalize({ status: "cancelled" });
      };

      const finalize = (
        partial: Partial<ComputerScriptRunResult> & {
          status: ComputerScriptRunResult["status"];
        },
      ): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        controller.abort();

        try {
          void worker?.terminate();
        } catch {
          /* ignore */
        }

        resolve({
          status: partial.status,
          value: partial.value,
          error: partial.error,
          trace: state.trace,
          screenshots: state.screenshots,
          logs: state.logs,
          durationMs: Date.now() - startedAt,
          usedComputer: state.usedComputer,
        });
      };

      const abortScript = (payload: ComputerScriptErrorPayload): void => {
        try {
          worker?.postMessage({
            type: "cancel",
            reason: payload.message || payload.code,
          });
        } catch {
          /* worker 可能已退出 */
        }
        finalize({ status: "failed", error: payload });
      };

      // 审批等待不计入脚本总超时：等待期间暂停定时器，返回后把等待时长补进 deadline。
      const waitThroughApproval = async <T>(
        fn: () => Promise<T>,
      ): Promise<T> => {
        if (settled) {
          throw new ComputerScriptError(
            "CANCELLED",
            "Computer script cancelled",
          );
        }
        const waitStartedAt = Date.now();
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          return await fn();
        } finally {
          if (!settled) {
            deadline += Date.now() - waitStartedAt;
            scheduleTimeout();
          }
        }
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
        worker = new Worker(COMPUTER_SCRIPT_WORKER_SOURCE, {
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

      scheduleTimeout();

      // 桌面调用严格串行：脚本里即使写 Promise.all，也按调用顺序逐个执行，
      // 避免并发 observe/input 互相覆盖租约与 generation。
      let callChain: Promise<void> = Promise.resolve();

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
          const runCall = () => {
            // 脚本可能已经返回/超时；队列里的调用不能再触达桌面。
            if (settled) return Promise.resolve();
            return this.dispatch(
              msg.method,
              msg.params ?? {},
              state,
              params,
              bridgeSignal,
              waitThroughApproval,
              abortScript,
            )
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
          };
          callChain = callChain.then(runCall, runCall);
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
        this.logger.warn(`computer-script worker error: ${error.message}`);
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
            message: `Computer script worker exited with code ${code}`,
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
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
    abortScript: (payload: ComputerScriptErrorPayload) => void,
  ): Promise<any> {
    state.usedComputer = true;
    const startedAt = Date.now();
    const target = summarizeCall(method, params);
    try {
      const value = await this.handleCall(
        method,
        params,
        state,
        run,
        signal,
        waitThroughApproval,
      );
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
      if (FATAL_CODES.has(payload.code)) abortScript(payload);
      throw error;
    }
  }

  private async handleCall(
    method: string,
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    switch (method) {
      case "screenshot":
        return this.handleScreenshot(params, state, run, signal, waitThroughApproval);
      case "a11y":
        return this.handleA11y(params, state, run, signal, waitThroughApproval);
      case "windows":
        return this.handleWindows(params, state, run, signal, waitThroughApproval);
      case "apps":
        return this.handleApps(params, state, run, signal, waitThroughApproval);
      case "cursor":
        return this.handleCursor(state, run, signal, waitThroughApproval);
      case "click":
        return this.handleClick(params, state, run, signal, waitThroughApproval);
      case "setValue":
        return this.handleSetValue(params, state, run, signal, waitThroughApproval);
      case "type":
        return this.handleInput(
          "type",
          { action: "type", text: textValue(params.text, "type text", MAX_TEXT_LENGTH) },
          "type",
          false,
          state,
          run,
          signal,
          waitThroughApproval,
        );
      case "key":
        return this.handleInput(
          "key",
          { action: "key", key: stringValue(params.key, "key combo", 256) },
          "key",
          false,
          state,
          run,
          signal,
          waitThroughApproval,
        );
      case "scroll":
        return this.handleScroll(params, state, run, signal, waitThroughApproval);
      case "focusWindow":
        return this.handleFocusWindow(params, state, run, signal, waitThroughApproval);
      case "move":
        return this.handleMove(params, state, run, signal, waitThroughApproval);
      case "drag":
        return this.handleDrag(params, state, run, signal, waitThroughApproval);
      case "launch":
        return this.handleLaunch(params, state, run, signal, waitThroughApproval);
      default:
        throw new ComputerScriptError(
          "UNKNOWN_METHOD",
          `Unknown computer script method: ${method}`,
        );
    }
  }

  // ── 观察 ──

  private async handleScreenshot(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countObservation(state);
    this.countScreenshot(state);
    await this.authorize(
      { policyKey: "screenshot", detail: "Capture the screen", phase: "observe" },
      run,
      signal,
      waitThroughApproval,
    );

    const display = optionalInt(params?.display, "display", 0);
    const outputPath = path.join(
      state.screenshotDir,
      `computer-${Date.now()}-${++state.screenshotSeq}.png`,
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const result = await this.sendRequest(
      "computer_observe",
      {
        action: "screenshot",
        output_path: outputPath,
        ...(display !== undefined ? { display } : {}),
      },
      signal,
    );

    run.hooks.leases.record(
      run.hooks.sessionId,
      "screenshot",
      Number(result?.generation),
    );

    const width = finiteNumber(result?.width);
    const height = finiteNumber(result?.height);
    const sourcePath =
      typeof result?.image_path === "string" && result.image_path
        ? result.image_path
        : outputPath;

    let saved: { ref?: FileRef; absolutePath: string } | undefined;
    try {
      if (!run.hooks.persistScreenshot) {
        saved = { absolutePath: sourcePath };
      } else {
        const data = await fs.readFile(sourcePath);
        saved = await run.hooks.persistScreenshot(data, { width, height });
      }
    } catch (error: any) {
      throw new ComputerScriptError(
        "SCREENSHOT_FAILED",
        `Failed to persist the screenshot: ${error?.message ?? String(error)}`,
        { path: sourcePath },
      );
    } finally {
      // 会话副本落盘后删掉 sidecar 写的临时 PNG；测试等无 persister 的场景保留。
      if (run.hooks.persistScreenshot && saved?.absolutePath !== sourcePath) {
        void fs.unlink(sourcePath).catch(() => undefined);
      }
    }

    state.screenshots.push({
      ...(saved.ref ? { ref: saved.ref } : {}),
      absolutePath: saved.absolutePath,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });

    return {
      ok: true,
      generation: result?.generation,
      width: result?.width,
      height: result?.height,
      path: saved.absolutePath,
    };
  }

  private async handleA11y(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countObservation(state);
    await this.authorize(
      {
        policyKey: "a11y_observe",
        detail: "Read the accessibility tree",
        phase: "observe",
      },
      run,
      signal,
      waitThroughApproval,
    );

    const pid = optionalInt(params?.pid, "pid", 1);
    const result = await this.sendRequest(
      "computer_a11y_observe",
      pid !== undefined ? { pid } : {},
      signal,
    );
    run.hooks.leases.record(
      run.hooks.sessionId,
      "accessibility",
      Number(result?.generation),
    );
    return {
      generation: result?.generation,
      entries: Array.isArray(result?.entries) ? result.entries : [],
      text: typeof result?.text === "string" ? result.text : "",
      truncated: result?.truncated === true,
    };
  }

  private async handleWindows(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countObservation(state);
    await this.authorize(
      { policyKey: "list_windows", detail: "List desktop windows", phase: "observe" },
      run,
      signal,
      waitThroughApproval,
    );

    const result = await this.sendRequest(
      "computer_observe",
      { action: "list_windows" },
      signal,
    );
    run.hooks.leases.record(
      run.hooks.sessionId,
      "window_list",
      Number(result?.generation),
    );
    return {
      generation: result?.generation,
      windows: Array.isArray(result?.windows) ? result.windows : [],
      text: typeof result?.text === "string" ? result.text : "",
    };
  }

  private async handleApps(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countObservation(state);
    await this.authorize(
      { policyKey: "list_windows", detail: "List desktop applications", phase: "observe" },
      run,
      signal,
      waitThroughApproval,
    );

    const result = await this.sendRequest(
      "computer_observe",
      { action: "list_apps" },
      signal,
    );
    return {
      apps: Array.isArray(result?.apps) ? result.apps : [],
      text: typeof result?.text === "string" ? result.text : "",
    };
  }

  private async handleCursor(
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countObservation(state);
    // 光标位置是纯读取，不触碰桌面、也不需要租约/策略。
    return this.sendRequest(
      "computer_observe",
      { action: "cursor_position" },
      signal,
    );
  }

  // ── 动作 ──

  private async handleClick(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const options = params || {};
    const hasRef = options.ref !== undefined;
    const hasName = options.name !== undefined;
    const hasPoint = options.x !== undefined || options.y !== undefined;
    const targetCount = [hasRef, hasName, hasPoint].filter(Boolean).length;

    if (targetCount !== 1) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        "click requires exactly one target: ref, name, or x/y",
      );
    }

    if (hasRef || hasName) {
      if (options.button !== undefined && options.button !== "left") {
        throw new ComputerScriptError(
          "UNSUPPORTED",
          "Element clicks are left-button only. Use x/y with button for right or middle click.",
        );
      }
      if (options.clicks !== undefined && options.clicks !== 1) {
        throw new ComputerScriptError(
          "UNSUPPORTED",
          "Element clicks are single-click only. Use x/y with clicks for double or triple click.",
        );
      }

      const input: Record<string, unknown> = { action: "click_element" };
      if (hasRef) {
        input.ref = integerValue(options.ref, "click ref", 0);
      } else {
        input.element_name = stringValue(options.name, "click name", 256);
      }
      return this.handleInput(
        "click_element",
        input,
        "click_element",
        false,
        state,
        run,
        signal,
        waitThroughApproval,
      );
    }

    const x = integerValue(options.x, "click x");
    const y = integerValue(options.y, "click y");
    const button =
      options.button === undefined ? "left" : String(options.button);
    const clicks = options.clicks === undefined ? 1 : Number(options.clicks);

    if (button !== "left" && button !== "right" && button !== "middle") {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        'click button must be "left", "right", or "middle"',
      );
    }
    if (!Number.isInteger(clicks) || clicks < 1 || clicks > 3) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        "click clicks must be 1, 2, or 3",
      );
    }

    let action: ComputerPolicyKey;
    if (button === "right") {
      if (clicks !== 1) {
        throw new ComputerScriptError(
          "UNSUPPORTED",
          "Right click supports a single click only",
        );
      }
      action = "right_click";
    } else if (button === "middle") {
      if (clicks !== 1) {
        throw new ComputerScriptError(
          "UNSUPPORTED",
          "Middle click supports a single click only",
        );
      }
      action = "middle_click";
    } else if (clicks === 2) {
      action = "double_click";
    } else if (clicks === 3) {
      action = "triple_click";
    } else {
      action = "left_click";
    }

    return this.handleInput(
      action,
      { action, x, y },
      action,
      true,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleSetValue(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const options = params || {};
    const hasRef = options.ref !== undefined;
    const hasName = options.name !== undefined;
    if (hasRef === hasName) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        "setValue requires exactly one of ref or name",
      );
    }

    const input: Record<string, unknown> = {
      action: "set_value",
      text: textValue(options.text, "setValue text", MAX_TEXT_LENGTH),
    };
    if (hasRef) {
      input.ref = integerValue(options.ref, "setValue ref", 0);
    } else {
      input.element_name = stringValue(options.name, "setValue name", 256);
    }

    return this.handleInput(
      "set_value",
      input,
      "set_value",
      false,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleScroll(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const options = params || {};
    const direction = String(options.direction ?? "");
    if (
      direction !== "up" &&
      direction !== "down" &&
      direction !== "left" &&
      direction !== "right"
    ) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        'scroll direction must be "up", "down", "left", or "right"',
      );
    }
    const amount =
      options.amount === undefined
        ? 3
        : integerValue(options.amount, "scroll amount", 1);
    if (amount > 100) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        "scroll amount must be between 1 and 100",
      );
    }

    const hasX = options.x !== undefined;
    const hasY = options.y !== undefined;
    if (hasX !== hasY) {
      throw new ComputerScriptError(
        "INVALID_ARGUMENT",
        "scroll x and y must be provided together",
      );
    }

    const input: Record<string, unknown> = { action: "scroll", direction, amount };
    if (hasX) {
      input.x = integerValue(options.x, "scroll x");
      input.y = integerValue(options.y, "scroll y");
    }

    return this.handleInput(
      "scroll",
      input,
      "scroll",
      hasX,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleFocusWindow(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const windowId = integerValue(
      params?.window_id,
      "focusWindow windowId",
      0,
    );
    return this.handleInput(
      "focus_window",
      { action: "focus_window", window_id: windowId },
      "focus_window",
      false,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleMove(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const x = integerValue(params?.x, "move x");
    const y = integerValue(params?.y, "move y");
    return this.handleInput(
      "mouse_move",
      { action: "mouse_move", x, y },
      "mouse_move",
      true,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleDrag(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    const x = integerValue(params?.x, "drag x");
    const y = integerValue(params?.y, "drag y");
    const toX = integerValue(params?.toX, "drag toX");
    const toY = integerValue(params?.toY, "drag toY");
    return this.handleInput(
      "drag",
      { action: "drag", x, y, to_x: toX, to_y: toY },
      "drag",
      true,
      state,
      run,
      signal,
      waitThroughApproval,
    );
  }

  private async handleLaunch(
    params: any,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countAction(state);
    const target = stringValue(params?.path, "launch path", 1024);
    await this.authorize(
      { policyKey: "launch_app", detail: `Launch ${target}`, phase: "launch" },
      run,
      signal,
      waitThroughApproval,
    );

    try {
      return await this.sendRequest("launch_app", { path: target }, signal);
    } finally {
      run.hooks.leases.clear(run.hooks.sessionId);
    }
  }

  // ── 统一 input 路径 ──

  private async handleInput(
    action: string,
    params: Record<string, unknown>,
    policyKey: ComputerPolicyKey,
    hasPoint: boolean,
    state: RunState,
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<any> {
    this.countAction(state);

    // 先确认有匹配的观察，避免“先弹审批、再告诉模型没观察”的糟糕体验。
    const lease = run.hooks.leases.peek(run.hooks.sessionId);
    if (!lease) {
      throw new ComputerScriptError(
        "NO_OBSERVATION",
        "No desktop observation is available. Call computer.screenshot() or computer.a11y() before sending input.",
      );
    }
    const required = requiredObservationKind(policyKey, hasPoint);
    if (required && lease.kind !== required) {
      throw new ComputerScriptError(
        "WRONG_OBSERVATION_KIND",
        `The "${action}" action requires a ${required} observation, but the latest observation is ${lease.kind}. Observe with the matching method first.`,
      );
    }

    try {
      await this.authorize(
        { policyKey, detail: describeAction(action, params), phase: "input" },
        run,
        signal,
        waitThroughApproval,
      );
    } catch (error) {
      run.hooks.leases.clear(run.hooks.sessionId);
      throw error;
    }

    try {
      return await this.sendRequest(
        "computer_input",
        {
          action,
          expected_generation: lease.generation,
          ...params,
        },
        signal,
      );
    } catch (error: any) {
      if (
        error?.code === "STALE_REFERENCE" ||
        error?.code === "UNCERTAIN" ||
        error?.code === "PERMISSION_REQUIRED"
      ) {
        run.hooks.leases.clear(run.hooks.sessionId);
      }
      throw error;
    } finally {
      // 与既有工具语义一致：任何输入后观察失效。
      run.hooks.leases.clear(run.hooks.sessionId);
    }
  }

  // ── 辅助 ──

  private async authorize(
    request: {
      policyKey: ComputerPolicyKey;
      detail: string;
      phase: "observe" | "input" | "launch";
    },
    run: ComputerScriptRunParams,
    signal: AbortSignal,
    waitThroughApproval: <T>(fn: () => Promise<T>) => Promise<T>,
  ): Promise<void> {
    if (request.phase !== "observe" && run.hooks.isPlanMode()) {
      throw new ComputerScriptError(
        "PLAN_MODE_DENIED",
        `Plan mode is active: "${request.policyKey}" cannot run until the user approves the plan and exits plan mode.`,
      );
    }

    await waitThroughApproval(() => run.hooks.authorize(request, signal));
  }

  private countObservation(state: RunState): void {
    state.observations += 1;
    if (state.observations > MAX_OBSERVATIONS) {
      throw new ComputerScriptError(
        "OBSERVATION_LIMIT",
        `This script exceeded the ${MAX_OBSERVATIONS} observation limit. Split it into smaller scripts.`,
      );
    }
  }

  private countAction(state: RunState): void {
    state.actions += 1;
    if (state.actions > MAX_ACTIONS) {
      throw new ComputerScriptError(
        "ACTION_LIMIT",
        `This script exceeded the ${MAX_ACTIONS} desktop action limit. Split it into smaller scripts.`,
      );
    }
  }

  private countScreenshot(state: RunState): void {
    if (state.screenshots.length >= MAX_SCREENSHOTS) {
      throw new ComputerScriptError(
        "SCREENSHOT_LIMIT",
        `This script exceeded the ${MAX_SCREENSHOTS} screenshot limit. Split it into smaller scripts.`,
      );
    }
  }

  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    try {
      return await this.bridge.request(method, params, signal);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (message.includes(`Unknown method: ${method}`)) {
        throw new ComputerScriptError(
          "SIDECAR_UNAVAILABLE",
          `The desktop bridge rejected "${method}". The Electron main process is probably running an older build; rebuild electron (pnpm run build:electron-ts) and restart the desktop app.`,
          error?.details,
        );
      }
      throw error;
    }
  }
}

// ── 工具函数 ──

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function sanitizeSegment(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalInt(
  value: unknown,
  name: string,
  min?: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || (min !== undefined && n < min)) {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be an integer${min !== undefined ? ` >= ${min}` : ""}`,
    );
  }
  return n;
}

function integerValue(
  value: unknown,
  name: string,
  min?: number,
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || (min !== undefined && n < min)) {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be an integer${min !== undefined ? ` >= ${min}` : ""}`,
    );
  }
  return n;
}

function stringValue(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be a non-empty string`,
    );
  }
  if (value.length > maxLength) {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be at most ${maxLength} characters`,
    );
  }
  return value;
}

/** 允许空串：setValue 可用空串清空字段，type 空串是无害 no-op。 */
function textValue(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be a string`,
    );
  }
  if (value.length > maxLength) {
    throw new ComputerScriptError(
      "INVALID_ARGUMENT",
      `${name} must be at most ${maxLength} characters`,
    );
  }
  return value;
}

function describeAction(
  action: string,
  params: Record<string, unknown>,
): string {
  switch (action) {
    case "click_element": {
      if (params.ref !== undefined) return `Click element [${params.ref}]`;
      const name = String(params.element_name ?? "");
      const preview = name.length > 120 ? `${name.slice(0, 120)}…` : name;
      return `Click element "${preview}"`;
    }
    case "left_click":
      return `Left-click at (${params.x}, ${params.y})`;
    case "right_click":
      return `Right-click at (${params.x}, ${params.y})`;
    case "middle_click":
      return `Middle-click at (${params.x}, ${params.y})`;
    case "double_click":
      return `Double-click at (${params.x}, ${params.y})`;
    case "triple_click":
      return `Triple-click at (${params.x}, ${params.y})`;
    case "mouse_move":
      return `Move the cursor to (${params.x}, ${params.y})`;
    case "type": {
      const text = String(params.text ?? "");
      return `Type ${text.length} character(s)`;
    }
    case "key":
      return `Press key combo ${String(params.key ?? "")}`;
    case "scroll":
      return `Scroll ${String(params.direction)} by ${String(
        params.amount ?? 3,
      )}`;
    case "focus_window":
      return `Focus window ${params.window_id}`;
    case "set_value": {
      const text = String(params.text ?? "");
      return `Set element value (${text.length} character(s))`;
    }
    case "drag":
      return `Drag from (${params.x}, ${params.y}) to (${params.to_x}, ${params.to_y})`;
    default:
      return action;
  }
}

function summarizeCall(method: string, params: any): string | undefined {
  switch (method) {
    case "screenshot":
      return params?.display !== undefined ? `display ${params.display}` : "primary";
    case "a11y":
      return params?.pid !== undefined ? `pid ${params.pid}` : "foreground";
    case "windows":
    case "apps":
    case "cursor":
      return undefined;
    case "click": {
      if (params?.ref !== undefined) return `ref ${params.ref}`;
      if (params?.name !== undefined) {
        const name = String(params.name);
        return `name "${name.length > 80 ? `${name.slice(0, 80)}…` : name}"`;
      }
      const button = params?.button ?? "left";
      const clicks = params?.clicks ?? 1;
      return `(${params?.x}, ${params?.y}) ${button} x${clicks}`;
    }
    case "setValue":
      return `${
        params?.ref !== undefined ? `ref ${params.ref}` : `name ${params?.name}`
      }, ${String(params?.text ?? "").length} chars`;
    case "type":
      return `${String(params?.text ?? "").length} chars`;
    case "key":
      return String(params?.key ?? "");
    case "scroll":
      return `${
        params?.x !== undefined ? `(${params.x}, ${params.y}) ` : ""
      }${String(params?.direction ?? "")} x${String(params?.amount ?? 3)}`;
    case "focusWindow":
      return `window ${params?.window_id}`;
    case "move":
      return `(${params?.x}, ${params?.y})`;
    case "drag":
      return `(${params?.x}, ${params?.y}) -> (${params?.toX}, ${params?.toY})`;
    case "launch": {
      const target = String(params?.path ?? "");
      return target.length > 160 ? `${target.slice(0, 160)}…` : target;
    }
    default:
      return undefined;
  }
}

function pushTrace(state: RunState, step: ComputerScriptTraceStep): void {
  state.trace.push(step);
  if (state.trace.length > MAX_TRACE_STEPS) {
    state.trace.splice(0, state.trace.length - MAX_TRACE_STEPS);
  }
}

const BRIDGE_ERROR_CODE_MAP: Record<string, string> = {
  BRIDGE_TIMEOUT: "TIMEOUT",
  BRIDGE_DISCONNECTED: "CALL_FAILED",
};

function mapBridgeCode(code: string): string {
  return BRIDGE_ERROR_CODE_MAP[code] || code;
}

function toErrorPayload(error: unknown): ComputerScriptErrorPayload {
  if (error instanceof ComputerScriptError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof AskDeniedError) {
    return {
      code: error.outcome === "cancelled" ? "CANCELLED" : "POLICY_DENIED",
      message: error.feedback
        ? `${error.message}: ${error.feedback}`
        : error.message,
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
    return { code: "CANCELLED", message: "Computer call was cancelled" };
  }
  return {
    code: mapBridgeCode(String(any?.code || "CALL_FAILED")),
    message: String(any?.message || error),
    ...(any?.details === undefined ? {} : { details: any.details }),
  };
}

function normalizeWorkerError(error: any): ComputerScriptErrorPayload {
  if (!error || typeof error !== "object") {
    return { code: "SCRIPT_ERROR", message: String(error) };
  }
  return {
    code: String(error.code || "SCRIPT_ERROR"),
    message: String(error.message || "Computer script failed"),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}
