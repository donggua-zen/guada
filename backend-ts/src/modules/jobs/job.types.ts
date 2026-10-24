/**
 * 通用后台作业的类型契约。
 *
 * 执行器（shell / subagent / workflow / remote / pty）只负责真正的工作；
 * JobRegistry 负责稳定 id、状态、读取、取消、归属和完成通知。
 */

export type JobId = `job-${string}`;

export type JobKind =
  | "shell"
  | "remote-shell"
  | "pty"
  | "subagent"
  | "workflow"
  | "scheduler";

export type JobStatus =
  | "running"
  | "stopping"
  | "completed"
  | "killed"
  | "failed"
  | "lost";

export type JobTerminalStatus = Exclude<JobStatus, "running" | "stopping">;

/** 单次读取的字节上限默认值与夹取范围（与 process read 保持一致） */
export const JOB_READ_DEFAULT_MAX_BYTES = 64 * 1024;
export const JOB_READ_MIN_MAX_BYTES = 1024;
export const JOB_READ_MAX_MAX_BYTES = 512 * 1024;

/** 每会话并发 running/stopping 作业上限 */
export const JOB_MAX_CONCURRENT_PER_SESSION = 10;

/** 终态 job 在内存中的保留时间（日志文件另有更长的磁盘保留） */
export const JOB_TERMINAL_TTL_MS = 10 * 60 * 1000;

export interface JobReadOptions {
  /** 绝对字节偏移；缺省读尾部 */
  offset?: number;
  /** 单次最多返回字节数 */
  maxBytes?: number;
}

export interface JobOutputRead {
  text: string;
  /** 本次实际读取起点 */
  offset: number;
  /** 下次增量读取起点 */
  nextOffset: number;
  /** 读取时日志总大小 */
  size: number;
  truncated: boolean;
  logFilePath?: string;
}

export interface JobOutcome {
  status: JobTerminalStatus;
  detail?: string;
  /** 终态兜底输出；读取器不可用时 job_read 用它 */
  output?: string;
  exitCode?: number | null;
}

export interface JobStartSpec {
  kind: JobKind;
  label: string;
  sessionId: string;
  /** 执行器句柄：本地 processId / 远程 r:conn:pid / 子会话 id / runId */
  handle?: string;
  /** 日志文件路径（可选；远程为远端路径） */
  logFilePath?: string;
  /** 是否投递完成通知；默认 true。前台工具结果已交付时设 false。 */
  notify?: boolean;
  read: (opts: JobReadOptions) => Promise<JobOutputRead>;
  cancel: (reason?: string) => void | Promise<void>;
  /**
   * 可选：向运行中的作业投递输入。shell/remote-shell 写 stdin 字节流；
   * 缺省表示该类作业不支持 send（registry 会明确报错，而不是静默丢弃）。
   */
  send?: (input: string, appendNewline?: boolean) => Promise<void>;
  isAlive?: () => boolean;
  /** 结果已被 read/wait/consume 交付，或 kill 主动抑制通知；只调用一次 */
  onReported?: () => void;
  /** 终态 job 被 TTL 清理或 disposeSession 移除；只调用一次 */
  onDisposed?: () => void;
  /** 可选：实时日志大小（shell 用 fs.stat；remote 返回最后已知值） */
  getLogSize?: () => Promise<number | undefined>;
  /** 执行器结算时 resolve；reject 视为 failed */
  done: Promise<JobOutcome>;
}

export interface JobSnapshot {
  id: JobId;
  kind: JobKind;
  label: string;
  sessionId: string;
  status: JobStatus;
  detail?: string;
  handle?: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  logFilePath?: string;
  logSize?: number;
  reported: boolean;
}

export interface JobListSnapshot {
  revision: number;
  jobs: JobSnapshot[];
}

export interface JobSettledEvent {
  sessionId: string;
  job: JobSnapshot;
  /** false = 执行器明确要求不投递通知（如前台工具结果已交付） */
  notify: boolean;
}

export interface JobChangedEvent {
  sessionId: string;
  revision: number;
  job: JobSnapshot;
}

/** 前端 jobs 快照流：一次带全量元数据，revision 单调递增。 */
export interface JobsSnapshotEvent {
  sessionId: string;
  revision: number;
  timestamp: string;
  jobs: JobSnapshot[];
}
