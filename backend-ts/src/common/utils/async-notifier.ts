/**
 * AsyncNotifier - 轻量级条件变量工具
 *
 * 替代手写的 Map<key, Array<(result) => void>> + add/remove/resolve 模式。
 * C++ condition_variable 风格的 wait / notify 封装。
 *
 * 用法：
 *   const n = new AsyncNotifier();
 *   等待端:
 *   const signalled = await n.wait("key", 5000);
 *   if (signalled) { /* 被 notify 唤醒 * / }
 *   通知端:
 *   n.notify("key");
 *   hasWaiters:
 *   n.hasWaiters("key") -> boolean
 */
export class AsyncNotifier {
  private waiters = new Map<
    string,
    Array<{ resolve: (value: boolean) => void; timer: NodeJS.Timeout }>
  >();

  /**
   * 等待通知。
   * @param key   标识符
   * @param timeoutMs  超时毫秒（>= 0；0 表示不等待立即返回）
   * @returns true=收到 notify(), false=超时
   */
  wait(key: string, timeoutMs: number): Promise<boolean> {
    // 0 超时：不等待，直接返回 false
    if (timeoutMs <= 0) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.remove(key, resolve);
        resolve(false);
      }, timeoutMs);

      const list = this.waiters.get(key);
      if (list) {
        list.push({ resolve, timer });
      } else {
        this.waiters.set(key, [{ resolve, timer }]);
      }
    });
  }

  /**
   * 通知所有 key 对应的等待者。清理定时器，删除 key。
   */
  notify(key: string): void {
    const list = this.waiters.get(key);
    if (!list || list.length === 0) return;

    for (const w of list) {
      clearTimeout(w.timer);
      w.resolve(true);
    }
    this.waiters.delete(key);
  }

  /**
   * 是否有 key 对应的等待者（替代 pollWatchers.has() 检查）
   */
  hasWaiters(key: string): boolean {
    return this.waiters.has(key) && this.waiters.get(key)!.length > 0;
  }

  /** 移除单个等待者（超时时调用） */
  private remove(key: string, resolve: (value: boolean) => void): void {
    const list = this.waiters.get(key);
    if (!list) return;
    const idx = list.findIndex((w) => w.resolve === resolve);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.waiters.delete(key);
  }
}
