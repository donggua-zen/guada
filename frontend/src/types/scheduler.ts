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
  userId: string
  name: string
  prompt: string
  scheduleType: 'cron' | 'once'
  cronExpression: string
  executeAt?: string | null
  targetMode: TargetMode
  targetSessionId?: string | null
  characterId?: string | null
  modelId?: string | null
  settings?: Record<string, any> | null
  enabled: boolean
  maxExecutions?: number | null
  executionCount?: number
  maxRetries?: number
  retryInterval?: number
  lastRunAt?: string | null
  nextRunAt?: string | null
  createdAt: string
  updatedAt: string
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
  cronExpression: string
  targetMode: TargetMode
  targetSessionId?: string
  characterId?: string
  modelId?: string
  settings?: Record<string, any>
  enabled?: boolean
  maxExecutions?: number
  maxRetries?: number
  retryInterval?: number
}

/**
 * 更新任务请求
 */
export interface UpdateTaskRequest {
  name?: string
  prompt?: string
  cronExpression?: string
  targetMode?: TargetMode
  targetSessionId?: string | null
  characterId?: string | null
  modelId?: string | null
  settings?: Record<string, any> | null
  enabled?: boolean
  maxExecutions?: number
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
