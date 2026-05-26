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
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed";

/**
 * 定时任务实体
 */
export interface ScheduledTask {
  id: string;
  userId: string;
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
  characterId?: string | null;
  modelId?: string | null;
  settings?: Record<string, any> | null;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 最大执行次数（默认 null 表示无限次）
   */
  maxExecutions?: number | null;
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
  startedAt: string;
  finishedAt?: string | null;
}
