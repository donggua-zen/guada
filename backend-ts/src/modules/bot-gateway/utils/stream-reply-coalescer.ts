/**
 * 流式回复合并器
 *
 * 高频流式增量只保留最新全文，避免「每个 token 一帧、逐帧等待 ack」
 * 导致发送队列无限积压：
 * - 首帧立即发送，不增加首字延迟
 * - 相邻两次发送之间至少间隔 intervalMs
 * - 任意时刻最多一个发送在途，发送期间到达的内容合并为最新值
 *
 * 发送吞吐因此不再与 token 速率耦合：网络往返再慢，也只是降低刷新频率，
 * 不会让待发帧越积越多。
 */
export class StreamReplyCoalescer {
  private pendingContent: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private disposed = false;
  private lastSentAt = 0;

  constructor(
    private readonly send: (content: string) => Promise<void>,
    private readonly intervalMs: number,
    private readonly onError: (error: Error) => void,
  ) {}

  /**
   * 提交最新全文
   *
   * 只保留最后一次提交的内容；已有发送在途或已排期时不会新增待发任务。
   */
  update(content: string): void {
    if (this.disposed) return;

    this.pendingContent = content;
    if (this.inFlight || this.timer) return;

    this.schedule();
  }

  /**
   * 停止合并器
   *
   * 取消待发的中间帧；已在途的发送无法取消，最终帧由调用方发送。
   */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pendingContent = null;
  }

  private schedule(): void {
    if (
      this.disposed ||
      this.inFlight ||
      this.timer ||
      this.pendingContent === null
    ) {
      return;
    }

    // 首帧立即发送；后续帧遵守最小间隔
    const wait =
      this.lastSentAt === 0
        ? 0
        : Math.max(0, this.lastSentAt + this.intervalMs - Date.now());

    if (wait === 0) {
      this.flush();
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  private flush(): void {
    if (this.disposed || this.inFlight || this.pendingContent === null) return;

    const content = this.pendingContent;
    this.pendingContent = null;

    // 上一次发送刚结束但间隔未到：保留最新内容，等间隔到了再发
    const wait = this.lastSentAt + this.intervalMs - Date.now();
    if (this.lastSentAt > 0 && wait > 0) {
      this.pendingContent = content;
      this.schedule();
      return;
    }

    this.inFlight = true;
    this.lastSentAt = Date.now();

    void this.send(content)
      .catch((error: unknown) => {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.inFlight = false;
        if (!this.disposed && this.pendingContent !== null) {
          this.schedule();
        }
      });
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
