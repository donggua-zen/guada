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
 * 子 Agent 开始事件
 */
export interface StreamSubAgentStartEvent {
    type: 'sub_agent_start'
    subSessionId: string
    name: string
}

/**
 * 子 Agent 完成事件
 */
export interface StreamSubAgentFinishEvent {
    type: 'sub_agent_finish'
    subSessionId: string
    status: 'completed' | 'error'
    result?: string
    error?: string
}

/**
 * 流式事件类型联合
 */
export type StreamEvent =
    | StreamTurnStartEvent
    | StreamThinkEvent
    | StreamToolCallEvent
    | StreamToolCallsResponseEvent
    | StreamTextEvent
    | StreamFinishEvent
    | StreamTurnEndEvent
    | StreamCompressionStartEvent
    | StreamCompressionErrorEvent
    | StreamSubAgentStartEvent       // 新增
    | StreamSubAgentFinishEvent      // 新增

/**
 * 回合开始事件(规范化后替代原 create)
 */
export interface StreamTurnStartEvent {
    type: 'turn_start'
    messageId: string
    turnsId: string
    modelName: string
}

/**
 * 思考事件
 */
export interface StreamThinkEvent {
    type: 'think'
    reasoningContent: string
}

/**
 * 工具调用事件
 */
export interface StreamToolCallEvent {
    type: 'tool_call'
    toolCalls: ToolCall[]  // 驼峰式
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
}

/**
 * 文本内容事件
 */
export interface StreamTextEvent {
    type: 'text'
    content: string
}

/**
 * 完成事件（每轮 LLM 调用结束）
 */
export interface StreamFinishEvent {
    type: 'finish'
    usage?: TokenUsage
    finishReason: string
    error?: string
}

/**
 * 轮次结束事件（整个 ReAct 循环结束）
 * 携带归一化结束原因 + 最终 content
 */
export interface StreamTurnEndEvent {
    type: 'turn_end'
    content?: string
    reasoningContent?: string
    usage?: TokenUsage
    finishReason: string
    error?: string
    messageId?: string
    contextStats?: {
        usedTokens: number
        effectiveContextWindow: number
    }
}

/**
 * 压缩开始事件
 */
export interface StreamCompressionStartEvent {
    type: 'compression_start'
    content: string
}

/**
 * 压缩错误事件
 */
export interface StreamCompressionErrorEvent {
    type: 'compression_error'
    content: string
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
 * 头像/壁纸上传响应（仅含展示用绝对 URL）
 */
export interface ResourceUploadResponse {
    /** 完整资源 URL（后端已绝对化） */
    url: string
}

/**
 * 会话文件上传响应（FileRef self-contained 契约）
 * 与后端 FileService.buildFileMeta / conversation.types.ts FileRef 同构，
 * 发消息时原样放入 userMessage.files，事件落盘时内嵌进块 attachment。
 */
export interface UploadResponse {
    /** MIME 类型（image/png、text/plain 等） */
    mediaType: string
    /** 字节数 */
    bytes: number
    /** 显示名 */
    name: string
    /** 相对存储路径（uploads/...，展示时绝对化） */
    url: string
    /** 预览路径（图片缩略图） */
    previewUrl?: string
    /** 扩展名（不带点） */
    fileExtension?: string
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
    username?: string
    password: string
}


