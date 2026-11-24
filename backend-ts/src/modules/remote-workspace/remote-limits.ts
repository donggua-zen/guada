/**
 * 远端文件传输/读写的单次大小闸门。
 *
 * 背景：`remote_transfer` 已经是 1MB 分块（内存恒定，实测 1.2GB 传输 Node 峰值
 * ~130MB、目标端 agent 峰值 ~23MB），但整文件读写入口（read/write/edit）仍是单条
 * RPC；且大文件传输耗时长，链路中断概率显著上升——断链本身会以传输错误结束
 * 工具调用，但若错误以流 'error' 形式冒出则可能带走整个后端进程。
 *
 * 闸门的目标不是"省内存"，而是在入口处给出可执行的拒绝，避免把极端输入交给
 * 传输链路去赌。两道闸门都可按环境变量调整：
 * - REMOTE_TRANSFER_MAX_MB：remote_transfer 单文件上限（默认 4096）
 * - REMOTE_FILE_MAX_MB：read/write/edit 单次整文件上限（默认 64）
 */

/** 单文件传输默认上限（MB） */
const DEFAULT_TRANSFER_MAX_MB = 4096;
/** 整文件读写（read/write/edit）默认上限（MB） */
const DEFAULT_FILE_MAX_MB = 64;
/** 上限的防呆区间（MB）：避免配成 0 把功能关死或配置溢出 */
const MIN_LIMIT_MB = 1;
const MAX_LIMIT_MB = 1024 * 1024;

function envMb(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT_MB, Math.max(MIN_LIMIT_MB, parsed));
}

/** remote_transfer 单文件上限（字节） */
export function getRemoteTransferMaxMb(): number {
  return envMb("REMOTE_TRANSFER_MAX_MB", DEFAULT_TRANSFER_MAX_MB);
}

export function getRemoteTransferMaxBytes(): number {
  return getRemoteTransferMaxMb() * 1024 * 1024;
}

/** 整文件读写上限（字节） */
export function getRemoteFileMaxMb(): number {
  return envMb("REMOTE_FILE_MAX_MB", DEFAULT_FILE_MAX_MB);
}

export function getRemoteFileMaxBytes(): number {
  return getRemoteFileMaxMb() * 1024 * 1024;
}

/** 人类可读体积（MB/GB，闸门错误文案用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes}B`;
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/** 闸门错误类型：调用方据此把"超限拒绝"与普通传输错误区分开（如 stat 失败回退） */
export class RemoteLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteLimitError";
  }
}

/** 传输闸门错误（统一文案：说明上限、给出现有替代方案与环境变量） */
export function transferLimitError(size: number, max: number, action: string): RemoteLimitError {
  return new RemoteLimitError(
    `${action} blocked: file is ${formatBytes(size)}, which exceeds the single-transfer ` +
      `limit of ${formatBytes(max)}. For large copies use a shell command on the target ` +
      `(e.g. run_command with scp/rsync/cp inside the remote host) or split the file. ` +
      `Raise REMOTE_TRANSFER_MAX_MB (currently ${getRemoteTransferMaxMb()}) if this size is intended.`,
  );
}

/** 整文件读写闸门错误（read/write/edit 用） */
export function fileLimitError(size: number, max: number, action: string): RemoteLimitError {
  return new RemoteLimitError(
    `${action} blocked: file is ${formatBytes(size)}, which exceeds the whole-file limit of ` +
      `${formatBytes(max)}. Read a narrower range (read with offset/limit), or use ` +
      `run_command (head/tail/sed on the remote) for large files. Raise REMOTE_FILE_MAX_MB ` +
      `(currently ${getRemoteFileMaxMb()}) if a full-file operation is intended.`,
  );
}
