/**
 * 压缩被用户取消（手动压缩的维护流中止 / abortSignal 触发）。
 *
 * 与普通失败区分：coordinator 据此记录"取消"日志；压缩错误路径不落任何写入
 * （appendCompact/appendPrune 前的检查点保证中止后不 commit）。
 */
export class CompactionCancelledError extends Error {
  constructor(message = "Compaction cancelled by user") {
    super(message);
    this.name = "CompactionCancelledError";
  }
}
