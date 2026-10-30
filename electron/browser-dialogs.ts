import { BrowserBridgeError } from "./browser-errors";

/**
 * JS 原生弹窗（alert/confirm/prompt/beforeunload）跟踪。
 *
 * 对齐 zcode 的语义：不做预置自动消解，页面调用 alert() 会真实挂起 JS，
 * 由模型通过 getDialog/handleDialog 决策。CDP `Page.javascriptDialogOpening`
 * 把弹窗内容存入 pendingDialogs，`Page.handleJavaScriptDialog` 处理。
 *
 * 弹窗会阻塞该 renderer 上的所有后续 CDP/JS 调用，因此配套三层兜底：
 * - 动作/截图前 probe：有弹窗直接 NOT_ACTIONABLE（details.dialog）；
 * - navigate 前 dismissAll；
 * - worker finalize（正常/超时/取消）自动关掉残留弹窗。
 */

export interface PendingDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultPrompt?: string;
}

interface DialogEntry {
  windowId: string;
  webContents: Electron.WebContents;
  attachedByUs: boolean;
  listener: (_event: unknown, method: string, params: unknown) => void;
}

function normalizeDialogType(type: string | undefined): PendingDialog["type"] {
  if (
    type === "confirm" ||
    type === "prompt" ||
    type === "beforeunload"
  ) {
    return type;
  }
  return "alert";
}

export class BrowserDialogTracker {
  private readonly entries = new Map<string, DialogEntry>();
  private readonly pending = new Map<string, PendingDialog>();

  constructor(
    private readonly logDialog?: (
      windowId: string,
      type: string,
      message: string,
    ) => void,
  ) {}

  /**
   * 为 guest 安装弹窗跟踪。已 attached 的 debugger 只挂监听、不 detach；
   * 新 attach 的会在 destroy 时由我们负责 detach。
   */
  async setup(webContents: Electron.WebContents, windowId: string): Promise<void> {
    if (this.entries.has(windowId) || webContents.isDestroyed()) return;

    const listener = (_event: unknown, method: string, params: unknown): void => {
      if (method === "Page.javascriptDialogOpening") {
        const data = (params ?? {}) as {
          type?: string;
          message?: string;
          defaultPrompt?: string;
        };
        const dialog: PendingDialog = {
          type: normalizeDialogType(data.type),
          message: typeof data.message === "string" ? data.message : "",
          ...(typeof data.defaultPrompt === "string"
            ? { defaultPrompt: data.defaultPrompt }
            : {}),
        };
        this.pending.set(windowId, dialog);
        this.logDialog?.(windowId, dialog.type, dialog.message);
      } else if (method === "Page.javascriptDialogClosed") {
        this.pending.delete(windowId);
      }
    };

    const attachedByUs = !webContents.debugger.isAttached();
    try {
      if (attachedByUs) webContents.debugger.attach("1.3");
    } catch (error: any) {
      // 并发路径下可能已被别人 attach，只挂监听即可。
      if (!webContents.debugger.isAttached()) {
        throw new BrowserBridgeError(
          "CALL_FAILED",
          `Failed to attach debugger for dialog tracking: ${error?.message || error}`,
        );
      }
    }

    webContents.debugger.on("message", listener);
    this.entries.set(windowId, {
      windowId,
      webContents,
      attachedByUs,
      listener,
    });

    try {
      await webContents.debugger.sendCommand("Page.enable");
    } catch (error: any) {
      // Page.enable 失败时弹窗事件收不到，但 attach 本身不能因此拆除
      // （其他功能可能正共用 debugger）；记录错误让上层可观测。
      throw new BrowserBridgeError(
        "CALL_FAILED",
        `Failed to enable Page domain for dialog tracking: ${error?.message || error}`,
      );
    }
  }

  get(windowId: string): PendingDialog | null {
    return this.pending.get(windowId) ?? null;
  }

  async handle(
    windowId: string,
    accept: boolean,
    promptText?: string,
  ): Promise<{ ok: true; handled: boolean }> {
    const entry = this.entries.get(windowId);
    if (!entry || entry.webContents.isDestroyed()) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", `Tab ${windowId} not found`);
    }
    // 没有待处理弹窗时直接返回：脚本结束兜底会无条件调用一次，
    // 不能让它触发 "No dialog is showing" 之类的 CDP 报错/日志噪音。
    if (!this.pending.has(windowId)) {
      return { ok: true, handled: false };
    }
    try {
      await entry.webContents.debugger.sendCommand("Page.handleJavaScriptDialog", {
        accept,
        ...(promptText !== undefined ? { promptText } : {}),
      });
    } finally {
      // 即使命令报错（弹窗已被页面关闭），本地记录也要清掉。
      this.pending.delete(windowId);
    }
    return { ok: true, handled: true };
  }

  /** 有残留弹窗时静默拒绝关闭；导航/脚本结束兜底用，不抛错。 */
  async dismissAll(windowId: string): Promise<void> {
    if (!this.pending.has(windowId)) return;
    try {
      await this.handle(windowId, false);
    } catch {
      this.pending.delete(windowId);
    }
  }

  dispose(windowId: string): void {
    const entry = this.entries.get(windowId);
    if (!entry) return;
    this.entries.delete(windowId);
    this.pending.delete(windowId);
    try {
      entry.webContents.debugger.removeListener("message", entry.listener);
      if (entry.attachedByUs && entry.webContents.debugger.isAttached()) {
        entry.webContents.debugger.detach();
      }
    } catch {
      // webContents 可能正在销毁
    }
  }

  disposeAll(): void {
    for (const windowId of Array.from(this.entries.keys())) {
      this.dispose(windowId);
    }
  }
}
