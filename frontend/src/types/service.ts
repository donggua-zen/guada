/**
 * API 服务层类型定义
 * 用于 ApiService 的完整类型支持
 */

import type { PaginatedResponse } from './common'
import type { Model, ModelProvider, McpServer } from './api'
import type { Character, CharacterListResponse } from './character'
import type { Session, SessionListResponse } from './session'
import type { Message } from './message'

// ========== 流式响应类型 ==========

/**
 * 流式事件类型联合
 */
export type StreamEvent =
    | StreamCreateEvent
    | StreamThinkEvent
    | StreamToolCallEvent
    | StreamToolCallsResponseEvent  // 新增
    | StreamTextEvent
    | StreamFinishEvent
    | StreamCompressionStartEvent
    | StreamCompressionErrorEvent

/**
 * 创建消息事件
 */
export interface StreamCreateEvent {
    type: 'create'
    messageId: string
    turnsId: string
    contentId: string
    modelName: string
}

/**
 * 思考事件
 */
export interface StreamThinkEvent {
    type: 'think'
    msg: string
}

/**
 * 工具调用事件
 */
export interface StreamToolCallEvent {
    type: 'tool_call'
    toolCalls: ToolCall[]  // 驼峰式
    displayMessages?: string[]  // 工具调用的展示文案数组
}

/**
 * 工具调用结果事件（一次性返回）
 */
export interface StreamToolCallsResponseEvent {
    type: 'tool_calls_response'
    toolCallsResponse: any[]  // 驼峰式
    usage?: TokenUsage
}

/**
 * 工具调用对象
 */
export interface ToolCall {
    id?: string
    index: number
    type: 'function'
    name: string
    arguments?: string
    displayMessage?: string  // 展示文案
}

/**
 * 文本内容事件
 */
export interface StreamTextEvent {
    type: 'text'
    msg: string
}

/**
 * 完成事件
 */
export interface StreamFinishEvent {
    type: 'finish'
    usage?: TokenUsage
    finishReason: string  // 驼峰式
    error?: string
}

/**
 * 压缩开始事件
 */
export interface StreamCompressionStartEvent {
    type: 'compression_start'
    msg: string
}

/**
 * 压缩错误事件
 */
export interface StreamCompressionErrorEvent {
    type: 'compression_error'
    msg: string
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    promptCacheHitTokens?: number
    promptCacheMissTokens?: number
}

// ========== 认证相关类型 ==========

/**
 * 登录请求
 */
export interface LoginRequest {
    username: string
    password: string
}

/**
 * 登录响应
 */
export interface LoginResponse {
    accessToken: string
    tokenType: string
    user: User
}

/**
 * 用户信息
 */
export interface User {
    id: string
    username: string
    nickname?: string
    avatarUrl?: string
    isActive: boolean
    createdAt?: string
    updatedAt?: string
}

// ========== 子账户管理类型 ==========

/**
 * 子账户信息
 */
export interface Subaccount {
    id: string
    username: string
    email?: string
    isActive: boolean
    createdAt?: string
    updatedAt?: string
}

// ========== 设置管理类型 ==========

/**
 * 全局设置
 */
export interface GlobalSettings {
    [key: string]: any
}

// ========== 文件上传类型 ==========

/**
 * 上传文件响应
 */
export interface UploadResponse {
    id: string
    name: string
    url: string
    size: number
    type?: string
}

// ========== 重置密码类型 ==========

/**
 * 重置密码检查响应
 */
export interface ResetPasswordCheckResponse {
    needs_reset: boolean
}

/**
 * 重置密码请求
 */
export interface ResetPasswordRequest {
    old_password?: string
    new_password: string
    token?: string
}


