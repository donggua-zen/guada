import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log/main";

/**
 * 下载跟踪（对齐 zcode IAB 的 will-download 语义）。
 *
 * 下载自动落盘系统 Downloads 目录：一旦注册 will-download 监听却不调用
 * setSavePath，Chromium 会弹原生「另存为」对话框挂住自动化；所以这里总是
 * 主动分配保存路径（同名追加序号）。记录保存在内存中，供
 * tab.waitForDownload / tab.downloads 查询。
 */

export interface DownloadRecord {
  id: string;
  windowId: string;
  url: string;
  filename: string;
  path: string | null;
  state: "pending" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  mime: string | null;
  startedAt: number;
}

interface DownloadWaiter {
  resolve: (record: DownloadRecord | null) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
}

interface BrowserDownloadItem {
  getURL(): string;
  getMimeType(): string;
  getFilename(): string;
  getSavePath(): string;
  setSavePath(path: string): void;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  once(event: "done", listener: (_event: unknown, state: string) => void): unknown;
}

const MAX_RECORDS = 100;

export class BrowserDownloadTracker {
  private readonly downloads = new Map<string, DownloadRecord>();
  private readonly waiters = new Map<string, DownloadWaiter[]>();
  private readonly listeners = new Map<
    string,
    { session: Electron.Session; listener: (...args: any[]) => void }
  >();
  private nextId = 1;

  setup(webContents: Electron.WebContents, windowId: string): void {
    const sessionContext = webContents.session;
    if (!sessionContext) return;
    // 同一个 windowId 重复 setup 时先摘掉旧监听，避免共享 session 上堆积
    this.removeListener(windowId);

    const listener = (
      _event: unknown,
      item: BrowserDownloadItem,
      contents: Electron.WebContents,
    ): void => {
      if (contents !== webContents) return;
      this.onDownload(windowId, item);
    };
    sessionContext.on("will-download", listener as never);
    this.listeners.set(windowId, { session: sessionContext, listener: listener as never });
  }

  private removeListener(windowId: string): void {
    const entry = this.listeners.get(windowId);
    if (!entry) return;
    this.listeners.delete(windowId);
    try {
      entry.session.removeListener("will-download", entry.listener as never);
    } catch {
      // session 可能已销毁
    }
  }

  private onDownload(windowId: string, item: BrowserDownloadItem): void {
    const record: DownloadRecord = {
      id: `dl_${this.nextId++}`,
      windowId,
      url: safeString(() => item.getURL()),
      filename: safeString(() => item.getFilename()) || `download-${Date.now()}`,
      path: null,
      state: "pending",
      receivedBytes: safeNumber(() => item.getReceivedBytes()),
      totalBytes: safeNumber(() => item.getTotalBytes()),
      mime: safeString(() => item.getMimeType()) || null,
      startedAt: Date.now(),
    };

    try {
      const dir = app.getPath("downloads");
      const savePath = uniqueDownloadPath(dir, record.filename);
      item.setSavePath(savePath);
      record.path = savePath;
    } catch (error: any) {
      log.warn(`[browser-download] save path setup failed: ${error?.message || error}`);
    }

    this.downloads.set(record.id, record);
    this.trim();
    log.info(
      `[browser-download] started ${record.id} file=${record.filename} url=${record.url}`,
    );

    item.once("done", (_doneEvent, state: string) => {
      record.state =
        state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
      record.path = safeString(() => item.getSavePath()) || record.path;
      record.receivedBytes = safeNumber(() => item.getReceivedBytes());
      log.info(
        `[browser-download] ${record.state} ${record.id} file=${record.filename} path=${record.path}`,
      );
      const waiter = this.waiters.get(windowId)?.shift();
      if (waiter) {
        this.clearWaiter(windowId, waiter);
        waiter.resolve(record);
      }
    });
  }

  /**
   * 等待该标签的下一个下载完成；已有 pending 记录时立即返回该记录。
   * 超时或取消返回 null。
   */
  wait(
    windowId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<DownloadRecord | null> {
    const existing = Array.from(this.downloads.values())
      .filter((record) => record.windowId === windowId && record.state === "pending")
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (existing) return Promise.resolve(existing);
    if (signal?.aborted) return Promise.resolve(null);

    return new Promise<DownloadRecord | null>((resolve) => {
      const waiter: DownloadWaiter = {
        resolve,
        timer: setTimeout(() => {
          this.clearWaiter(windowId, waiter);
          resolve(null);
        }, timeoutMs),
      };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          this.clearWaiter(windowId, waiter);
          resolve(null);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      const waiters = this.waiters.get(windowId) ?? [];
      waiters.push(waiter);
      this.waiters.set(windowId, waiters);
    });
  }

  /** 最近的下载记录（新→旧）。 */
  list(windowId?: string, limit = 20): DownloadRecord[] {
    return Array.from(this.downloads.values())
      .filter((record) => !windowId || record.windowId === windowId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  dispose(windowId: string): void {
    this.removeListener(windowId);
    const waiters = this.waiters.get(windowId);
    if (waiters) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
      }
      this.waiters.delete(windowId);
    }
    for (const [id, record] of this.downloads) {
      if (record.windowId === windowId) this.downloads.delete(id);
    }
  }

  disposeAll(): void {
    const ids = new Set<string>([
      ...this.listeners.keys(),
      ...Array.from(this.downloads.values()).map((record) => record.windowId),
    ]);
    for (const windowId of ids) this.dispose(windowId);
  }

  private clearWaiter(windowId: string, waiter: DownloadWaiter): void {
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    const waiters = this.waiters.get(windowId);
    if (!waiters) return;
    const index = waiters.indexOf(waiter);
    if (index >= 0) waiters.splice(index, 1);
    if (waiters.length === 0) this.waiters.delete(windowId);
  }

  private trim(): void {
    if (this.downloads.size <= MAX_RECORDS) return;
    const stale = Array.from(this.downloads.values())
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, this.downloads.size - MAX_RECORDS);
    for (const record of stale) this.downloads.delete(record.id);
  }
}

function safeString(getter: () => string | undefined): string {
  try {
    return String(getter() ?? "");
  } catch {
    return "";
  }
}

function safeNumber(getter: () => number | undefined): number {
  try {
    return Number(getter() ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** 下载文件名非法字符清洗 + 同名追加序号 */
function uniqueDownloadPath(dir: string, rawFilename: string): string {
  const sanitized =
    rawFilename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "_")
      .trim() || `download-${Date.now()}`;
  const ext = path.extname(sanitized);
  const base = ext ? sanitized.slice(0, -ext.length) : sanitized;
  let candidate = path.join(dir, sanitized);
  let index = 1;
  for (;;) {
    let exists = false;
    try {
      exists = fs.existsSync(candidate);
    } catch {
      exists = false;
    }
    if (!exists) return candidate;
    candidate = path.join(dir, `${base} (${index})${ext}`);
    index += 1;
    if (index > 999) return path.join(dir, `${base}-${Date.now()}${ext}`);
  }
}
