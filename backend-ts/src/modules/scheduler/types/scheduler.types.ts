/**
 * 定时任务调度类型
 */
export type TaskScheduleType = "cron" | "once";

/**
 * 定时任务执行模式
 */
export type TaskTargetMode = "new_session" | "existing_session";

/**
 * 定时任务状态
 *
 * missed：计划窗口被错过（电脑休眠、应用未运行、进程长时间阻塞），不补跑、只留痕。
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "missed";

/**
 * 定时任务实体
 */
export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /**
   * 调度类型：cron 周期性 / once 一次性定点执行
   */
  scheduleType: TaskScheduleType;
  /**
   * cron 表达式（scheduleType 为 cron 时使用）
   */
  cronExpression: string;
  /**
   * 定点执行时间 ISO 字符串（scheduleType 为 once 时使用）
   */
  executeAt?: string | null;
  targetMode: TaskTargetMode;
  targetSessionId?: string | null;
  /**
   * 任务输出模式（仅 targetMode=new_session 有意义）：
   * - independent：每次执行都新建一个会话；
   * - merged：首次新建并记住会话，后续复用该会话（见 mergedSessionId）。
   */
  outputMode?: "independent" | "merged";
  /**
   * 合并输出模式下记住的会话 ID；首次执行新建后回存，后续复用。
   */
  mergedSessionId?: string | null;
  agentId?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
  /**
   * 工作目录：new_session 建会话时传入；null/未设 → 由后端自动生成临时目录（旧行为）。
   */
  workspacePath?: string | null;
  /**
   * 附加工作目录绑定（远程连接等），键为附件类型 ID，值为连接 ID 列表；
   * 建会话时并入 session.settings.attachments。
   */
  attachments?: Record<string, string[]> | null;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 到期时间 ISO 字符串；超过后自动暂停（enabled=false），不再创建新的执行。
   * null/未设置表示永不到期。
   */
  expiresAt?: string | null;
  /**
   * 无人值守运行：新建会话执行时注入 danger-full-access 沙盒模式，
   * 使命中提权的工具审批在触发前即被放行，回合不会卡在等待确认。
   * 仅对 new_session 生效；existing_session 沿用用户会话自身设置。
   */
  unattended?: boolean;
  /**
   * 已执行次数
   */
  executionCount?: number;
  /**
   * 最大重试次数（默认 0 表示不重试）
   */
  maxRetries?: number;
  /**
   * 重试间隔（秒，默认 60）
   */
  retryInterval?: number;
}

/**
 * 定时任务执行日志
 */
export interface ScheduledTaskLog {
  id: string;
  taskId: string;
  sessionId?: string | null;
  status: TaskStatus;
  error?: string | null;
  /** missed 状态专用：错过窗口的说明（含次数与原因），与 error 分开以便 UI 中性展示 */
  reason?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}
