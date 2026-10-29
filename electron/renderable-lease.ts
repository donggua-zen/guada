/**
 * 截图/隐藏页动作的「临时可渲染」租约。
 *
 * 背景：`setWebviewRenderable(true)` 会让一个后台 webview 参与合成，
 * 调用方必须在结束后撤销。历史上这条路径是裸 boolean，一旦某个 CDP
 * 命令卡住导致 finally 没执行，页面会永久停留在「透明但可渲染」状态
 * （同时吞掉应用点击）。这里用引用计数 + TTL 兜底：
 *
 * - 多个并发操作共享同一窗口的 renderable 状态，最后一个 release 才撤销；
 * - 每份租约带 TTL，调用方挂死时也能自动归零；
 * - onChange 是唯一副作用出口，便于 manager 集中发 IPC 与恢复焦点。
 */

const DEFAULT_TTL_MS = 45_000;
const MIN_TTL_MS = 50;

interface LeaseEntry {
  count: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface RenderableLeaseOptions {
  /** 租约最长存活时间，默认 45s（大于截图 15s 与动作 30s 上限） */
  ttlMs?: number;
  onChange(windowId: string, active: boolean): void;
}

export class RenderableLease {
  private readonly entries = new Map<string, LeaseEntry>();
  private readonly ttlMs: number;

  constructor(private readonly options: RenderableLeaseOptions) {
    this.ttlMs = Math.max(MIN_TTL_MS, options.ttlMs ?? DEFAULT_TTL_MS);
  }

  acquire(windowId: string): void {
    const existing = this.entries.get(windowId);
    if (existing) {
      existing.count += 1;
      this.resetTimer(windowId, existing);
      return;
    }
    const entry: LeaseEntry = { count: 1 };
    this.entries.set(windowId, entry);
    this.resetTimer(windowId, entry);
    this.notify(windowId, true);
  }

  release(windowId: string): void {
    const entry = this.entries.get(windowId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) {
      this.resetTimer(windowId, entry);
      return;
    }
    this.clear(windowId, entry);
    this.notify(windowId, false);
  }

  /** 强制撤销某个窗口（或全部）的租约，用于窗口隐藏/关闭/前端重载。 */
  releaseAll(windowId?: string): void {
    const ids = windowId ? [windowId] : Array.from(this.entries.keys());
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      this.clear(id, entry);
      this.notify(id, false);
    }
  }

  isActive(windowId: string): boolean {
    return this.entries.has(windowId);
  }

  count(windowId: string): number {
    return this.entries.get(windowId)?.count ?? 0;
  }

  dispose(): void {
    this.releaseAll();
  }

  private resetTimer(windowId: string, entry: LeaseEntry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    const timer = setTimeout(() => {
      if (this.entries.get(windowId) !== entry) return;
      this.entries.delete(windowId);
      entry.timer = undefined;
      this.notify(windowId, false);
    }, this.ttlMs);
    // 不让兜底计时器阻止应用退出（Electron 主进程是 Node 环境）。
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    entry.timer = timer;
  }

  private clear(windowId: string, entry: LeaseEntry): void {
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    this.entries.delete(windowId);
  }

  private notify(windowId: string, active: boolean): void {
    try {
      this.options.onChange(windowId, active);
    } catch {
      // 监听方（IPC/窗口操作）失败不能让租约状态卡住。
    }
  }
}
