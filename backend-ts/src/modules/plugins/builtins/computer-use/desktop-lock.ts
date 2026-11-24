import { ComputerScriptError } from "../computer-script/computer-script.types";

interface Waiter {
  resolve: (release: () => void) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * 进程级桌面锁。
 *
 * 整个进程只有一个 computer sidecar，观察 generation 也是全局的：
 * 两个会话交错 observe/input 会互相把对方租约变陈旧。脚本运行期间
 * （含审批等待）持有本锁；第二个脚本最多等待 timeoutMs，超时返回
 * COMPUTER_BUSY，而不是静默排队几分钟。
 */
export class DesktopLock {
  private locked = false;
  private readonly waiters: Waiter[] = [];

  async acquire(timeoutMs = 15_000, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new ComputerScriptError("CANCELLED", "Computer script cancelled");
    }
    if (!this.locked) {
      this.locked = true;
      return this.makeRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.remove(waiter);
          reject(
            new ComputerScriptError(
              "COMPUTER_BUSY",
              "Another computer script is already driving the desktop. Try again after it finishes.",
            ),
          );
        }, Math.max(0, timeoutMs)),
        signal,
      };

      if (signal) {
        waiter.onAbort = () => {
          this.remove(waiter);
          reject(new ComputerScriptError("CANCELLED", "Computer script cancelled"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }

  private remove(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.waiters.shift();
      if (!next) {
        this.locked = false;
        return;
      }
      clearTimeout(next.timer);
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      next.resolve(this.makeRelease());
    };
  }
}
