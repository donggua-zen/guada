/**
 * API 服务层类型定义
 * 用于 ApiService 的完整类型支持
 */

import type { FileRefType } from './stream/content-block.types'

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
    username: string
    nickname?: string | null
    avatarUrl?: string | null
    wallpaperUrl?: string | null
    /** 是否已设密码（未设则免登录） */
    passwordSet?: boolean
}

// ========== 设置管理类型 ==========

/**
 * 全局设置
 */
export interface GlobalSettings {
    [key: string]: any
}

// ── 分组设置（GET/PUT /settings/:group 的已知键；写侧为局部 patch，键可选） ──

/** appearance 分组：外观/壁纸/主题预设 */
export interface AppearanceGroupSettings {
    wallpaperUrl?: string | null
    sidebarOpacity?: number
    contentOpacity?: number
    floatWidgetEnabled?: boolean
    floatWidgetOpacity?: number
    lightThemePreset?: string
    darkThemePreset?: string
}

/** system 分组：工作目录/上传子目录/知识库存储/对话引擎参数 */
export interface SystemGroupSettings {
    workspaceBaseDir?: string
    chatUploadSubdir?: string
    kbStorageRoot?: string
    maxToolIterations?: number
    /** 后端以 ms 存储 */
    llmRequestTimeoutMs?: number
    /** 后端以 ms 存储 */
    llmIdleTimeoutMs?: number
}

/** ocr 分组：OCR 提供方与密钥 */
export interface OcrGroupSettings {
    provider?: string
    umiHost?: string
    umiPort?: number
    baiduApiKey?: string
    baiduSecretKey?: string
    ocrMode?: string
}

/** search 分组：联网搜索提供方与各 provider 的密钥 */
export interface SearchGroupSettings {
    provider?: string
    bocha?: { apiKey?: string }
    tavily?: { apiKey?: string }
    metaso?: { apiKey?: string }
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
    /** 显示名（完整文件名，含扩展名） */
    name: string
    /** 引用锚点：按 refType 解释（store → 全局附件目录；workspace → 会话工作目录） */
    url: string
    /** 预览路径（图片缩略图），仅图片有值 */
    previewUrl?: string
    /** 扩展名（不带点） */
    fileExtension?: string
    /** 引用形态（见 content-block.types.ts FileRefType） */
    refType?: FileRefType
}

// ========== 重置密码类型 ==========


