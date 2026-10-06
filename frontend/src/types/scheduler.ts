/**
 * 定时任务模块类型定义
 */

import type { PaginatedResponse } from './common'

/**
 * 执行目标模式
 */
export type TargetMode = 'new_session' | 'existing_session'

/**
 * 任务执行状态
 */
export type TaskLogStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 定时任务对象
 */
export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  scheduleType: 'cron' | 'once'
  cronExpression: string
  executeAt?: string | null
  targetMode: TargetMode
  targetSessionId?: string | null
  /** 任务输出模式（仅 new_session 有意义）：independent 每次新建 / merged 首次新建后复用 */
  outputMode?: 'independent' | 'merged'
  /** 合并输出模式记住的会话 ID */
  mergedSessionId?: string | null
  agentId?: string | null
  modelId?: string | null
  settings?: Record<string, unknown> | null
  /** 工作目录；null → 后端自动生成临时目录 */
  workspacePath?: string | null
  /** 附加工作目录绑定（远程连接），key=附件类型ID，value=连接ID列表 */
  attachments?: Record<string, string[]> | null
  enabled: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
  createdAt: string
  updatedAt: string
  /** 到期时间 ISO 字符串；超过后自动暂停。null/未设表示永不到期 */
  expiresAt?: string | null
  /** 无人值守运行（仅 new_session 生效：注入 danger-full-access 沙盒模式） */
  unattended?: boolean
  /** 已执行次数 */
  executionCount?: number
  maxRetries?: number
  retryInterval?: number
}

/**
 * 定时任务执行日志
 */
export interface ScheduledTaskLog {
  id: string
  taskId: string
  sessionId?: string | null
  status: TaskLogStatus
  error?: string | null
  startedAt: string
  finishedAt?: string | null
}

/**
 * Cron 预设项
 */
export interface CronPreset {
  label: string
  value: string
}

/**
 * 创建任务请求
 */
export interface CreateTaskRequest {
  name: string
  prompt: string
  scheduleType: 'cron' | 'once'
  cronExpression?: string
  executeAt?: string
  targetMode: TargetMode
  targetSessionId?: string
  outputMode?: 'independent' | 'merged'
  agentId?: string
  modelId?: string
  settings?: Record<string, unknown>
  workspacePath?: string
  attachments?: Record<string, string[]>
  enabled?: boolean
  expiresAt?: string
  unattended?: boolean
  maxRetries?: number
  retryInterval?: number
}

/**
 * 更新任务请求
 */
export interface UpdateTaskRequest {
  name?: string
  prompt?: string
  scheduleType?: 'cron' | 'once'
  cronExpression?: string
  executeAt?: string | null
  targetMode?: TargetMode
  targetSessionId?: string | null
  outputMode?: 'independent' | 'merged'
  agentId?: string | null
  modelId?: string | null
  settings?: Record<string, unknown> | null
  workspacePath?: string | null
  attachments?: Record<string, string[]> | null
  enabled?: boolean
  expiresAt?: string | null
  unattended?: boolean
  maxRetries?: number
  retryInterval?: number
}

/**
 * 任务列表响应
 */
export type ScheduledTaskListResponse = PaginatedResponse<ScheduledTask>

/**
 * 任务日志列表响应
 */
export type ScheduledTaskLogListResponse = PaginatedResponse<ScheduledTaskLog>
