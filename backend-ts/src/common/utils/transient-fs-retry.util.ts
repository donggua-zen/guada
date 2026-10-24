/**
 * 瞬态文件系统错误重试。
 *
 * Windows 上文件描述符/句柄表被打满时，`fs.open` 会返回 EMFILE/ENFILE。这类错误
 * 发生在 open 阶段，尚未写入任何字节，因此重试不会产生重复行；等已结束进程的
 * 句柄被释放（或 GC 回收）后，重试通常就能成功。
 *
 * 只重试句柄/描述符耗尽；权限、磁盘满、IO 错误立即抛出，避免掩盖真实故障。
 */

/** 是否为可重试的句柄/描述符耗尽错误 */
export function isTransientFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EMFILE" || code === "ENFILE";
}

export interface TransientFsRetryOptions {
  /** 总尝试次数（含首次），默认 4 */
  attempts?: number;
  /** 首次退避毫秒数，默认 100；后续按 2 的幂递增 */
  baseDelayMs?: number;
}

/**
 * 对 EMFILE/ENFILE 做有限次指数退避重试。
 *
 * 调用方必须保证 `op` 在失败时没有产生部分写入（本工具用于 open 阶段失败的
 * appendFile/writeFile 正是如此）。
 */
export async function withTransientFsRetry<T>(
  op: () => Promise<T>,
  options: TransientFsRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);

  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      if (attempt >= attempts - 1 || !isTransientFsError(error)) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt),
      );
    }
  }
}
