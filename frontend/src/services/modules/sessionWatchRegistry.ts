/**
 * 会话 watch 注册表（引用计数）。
 *
 * 同屏可能有多个 pane 打开同一会话（主会话 / 子代理标签 / bot 面板），
 * 每个 pane 挂载时 acquire、卸载或切换时 release；计数归零才真正 unwatch。
 *
 * 传输侧（SessionEventsService）只保存"期望集合"，重连后由客户端重放，
 * 因此这里只负责在服务端 watch/unwatch 上做去重。
 */
export class SessionWatchRegistry {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly watch: (sessionId: string) => void,
    private readonly unwatch: (sessionId: string) => void,
  ) {}

  acquire(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    const next = (this.counts.get(sessionId) ?? 0) + 1;
    this.counts.set(sessionId, next);
    if (next === 1) this.watch(sessionId);
  }

  release(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    const current = this.counts.get(sessionId);
    if (!current) return;
    if (current > 1) {
      this.counts.set(sessionId, current - 1);
      return;
    }
    this.counts.delete(sessionId);
    this.unwatch(sessionId);
  }

  /** 测试/诊断：当前被持有的会话数 */
  size(): number {
    return this.counts.size;
  }
}
