/**
 * 通用后台作业的类型契约。
 *
 * 执行器（shell / subagent / workflow / remote / pty）只负责真正的工作；
 * JobRegistry 负责稳定 id、状态、读取、取消、归属和完成通知。
 *
 * ── 作业完成后的结果交付：三条路径，靠 `reported` 收口互斥 ──
 * 1. 回合内完成、且是 shell / remote-shell：
 *    回合「正常收尾」时由 turn.stopping 续跑钩子收割
 *    （shell.plugin.handleTurnStopping → processManager.drainCompleted /
 *    workspaceRouter.drainRemoteProcesses）。输出直接注入本轮并触发新一轮 LLM 调用，
 *    drain 时先 registry.markReported → 不会再发一条完成通知。
 * 2. 其余情况（subagent，以及未命中路径 1 的 kind）：
 *    settle 时会话仍在跑 → markNoticePending；回合正常收尾时由 JobNotifier
 *    批量投递一条 <system_reminder> 通知（user_cancel / error 收尾不投递）。
 * 3. 模型主动 job_read：读到终态同样置 reported，抑制路径 1/2 的重复投递。
 *
 * 注意：registry.takePendingNotices 只在回合收尾被调用；turn.stopping 不碰这条队列，
 * 它在进程层就把输出消费掉了（见 JobRegistryService.markNoticePending 注释）。
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

/**
 * 运行时判定（编译期靠 JobTerminalStatus 挡，但执行器返回的 outcome 来自异步通道）。
 * settle() 用它做守卫：非终态一律按 failed 结算，避免记录停在 running 却已 settled
 * （那样会永久占用每会话配额，且 1s 快照 ticker 永远停不下来）。
 */
export function isJobTerminalStatus(
  status: JobStatus,
): status is JobTerminalStatus {
  return (
    status === "completed" ||
    status === "killed" ||
    status === "failed" ||
    status === "lost"
  );
}

/** 默认静默的 kind：结果已由工具返回值或目标会话回合交付，不需要额外唤醒一回合。 */
const SILENT_NOTIFY_KINDS: ReadonlySet<JobKind> = new Set([
  "workflow",
  "scheduler",
]);

/**
 * notify 的唯一默认值来源（显式传入优先）。
 * JobRegistryService.start 用它归一化，投递侧（JobNotifier）只信归一化后的布尔值——
 * 避免"哪些 kind 不通知"在注册与投递两处各写一份。
 */
export function defaultJobNotify(kind: JobKind): boolean {
  return !SILENT_NOTIFY_KINDS.has(kind);
}

/**
 * 字节日志类 kind：输出有稳定字节空间（offset/nextOffset 可靠）。
 * shell / remote-shell / pty 追加写日志文件；subagent / workflow / scheduler 是
 * 内存文本（每次读取整体重生成），没有稳定的字节偏移，也不产生 logSize。
 */
export function isByteLogJobKind(kind: JobKind): boolean {
  return kind === "shell" || kind === "remote-shell" || kind === "pty";
}

/** 单次读取的字节上限默认值与夹取范围（与 process read 保持一致） */
export const JOB_READ_DEFAULT_MAX_BYTES = 64 * 1024;
export const JOB_READ_MIN_MAX_BYTES = 1024;
export const JOB_READ_MAX_MAX_BYTES = 512 * 1024;

/** 每会话并发 running/stopping 作业上限 */
export const JOB_MAX_CONCURRENT_PER_SESSION = 10;

/** 终态 job 在内存中的保留时间（日志文件另有更长的磁盘保留） */
export const JOB_TERMINAL_TTL_MS = 10 * 60 * 1000;

/**
 * 取消看门狗：kill() 只把状态置 stopping，终态由执行器的 done 结算。
 * 执行器若漏掉 done（cancel 成功但进程/流永不收尾），记录会永久停在 stopping，
 * 既占每会话配额，又让 1s 快照 ticker 常驻。到期仍未结算则兜底按 killed 收尾。
 * 20s 的取值覆盖：shell 的 SIGTERM→2s→SIGKILL 升级、workflow 的 5s 宽限 + terminate、
 * subagent 的流 abort 收尾。
 */
export const JOB_CANCEL_WATCHDOG_MS = 20_000;

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
  /**
   * 是否投递完成通知。缺省按 kind 决定（见 defaultJobNotify：workflow / scheduler 默认
   * 静默，其余默认通知）；前台工具结果已交付时可显式设 false 抑制。
   */
  notify?: boolean;
  read: (opts: JobReadOptions) => Promise<JobOutputRead>;
  cancel: (reason?: string) => void | Promise<void>;
  /**
   * 可选：向运行中的作业投递输入。shell/remote-shell 写 stdin 字节流；
   * 缺省表示该类作业不支持 send（registry 会明确报错，而不是静默丢弃）。
   */
  send?: (input: string, appendNewline?: boolean) => Promise<void>;
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
  /**
   * 进程启动标识（全局 APP_BOOT_ID）。revision 只在同一 bootId 内单调，进程重启后归零；
   * 前端靠它识别"该重置"，否则会把新进程的低 revision 快照当成过期快照永久丢弃
   * （UI 卡在不存在的 running 作业上）。与会话流事件的 streamBootId 同一真相。
   */
  bootId: string;
  revision: number;
  jobs: JobSnapshot[];
}

export interface JobSettledEvent {
  sessionId: string;
  job: JobSnapshot;
  /** 是否投递完成通知；缺省值已在 JobRegistryService.start 按 kind 归一化 */
  notify: boolean;
}

/** 前端 jobs 快照流：一次带全量元数据，revision 在同一 bootId 内单调递增。 */
export interface JobsSnapshotEvent {
  sessionId: string;
  /** 见 JobListSnapshot.bootId：变化即后端重启，前端忽略 revision 直接采用 */
  bootId: string;
  revision: number;
  timestamp: string;
  jobs: JobSnapshot[];
}
