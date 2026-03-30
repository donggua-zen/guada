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
    | StreamTextEvent
    | StreamFinishEvent

/**
 * 创建消息事件
 */
export interface StreamCreateEvent {
    type: 'create'
    message_id: string
    turns_id: string
    content_id: string
    model_name: string
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
    tool_calls: ToolCall[]
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
    msg: string
}

/**
 * 完成事件
 */
export interface StreamFinishEvent {
    type: 'finish'
    usage?: TokenUsage
    finish_reason: string
    error?: string
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
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
 * 注册请求
 */
export interface RegisterRequest {
    username: string
    password: string
    email?: string
}

/**
 * 登录响应
 */
export interface LoginResponse {
    access_token: string
    token_type: string
    user: User
}

/**
 * 用户信息
 */
export interface User {
    id: string
    username: string
    email?: string
    avatar_url?: string
    is_active: boolean
    created_at?: string
    updated_at?: string
}

// ========== 子账户管理类型 ==========

/**
 * 子账户信息
 */
export interface Subaccount {
    id: string
    username: string
    email?: string
    is_active: boolean
    created_at?: string
    updated_at?: string
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

// ========== API 服务接口定义 ==========

/**
 * ApiService 接口
 * 定义所有 API 方法的签名
 */
export interface IApiService {
    // 模型管理
    fetchModels(): Promise<PaginatedResponse<Model>>
    fetchRemoteModels(provider_id: string): Promise<Model[]>
    createModel(data: any): Promise<Model>
    updateModel(modelId: string, data: any): Promise<Model>
    deleteModel(modelId: string): Promise<boolean>

    // 提供商管理
    createProvider(data: any): Promise<any>
    deleteProvider(providerId: string): Promise<boolean>
    updateProvider(providerId: string, data: any): Promise<any>

    // 角色管理
    fetchCharacters(type?: 'private' | 'public'): Promise<CharacterListResponse>
    fetchCharacter(characterId: string): Promise<Character>
    createCharacter(data: any): Promise<Character>
    updateCharacter(characterId: string, data: any): Promise<Character>
    deleteCharacter(characterId: string): Promise<{ success: boolean }>

    // 会话管理
    createSession(data: any): Promise<Session>
    deleteSession(sessionId: string): Promise<{ success: boolean }>
    fetchSession(sessionId: string): Promise<Session>
    fetchSessions(): Promise<SessionListResponse>
    fetchSessionMessages(sessionId: string): Promise<PaginatedResponse<Message>>
    importMessages(sessionId: string, messages: any[]): Promise<any>
    createMessage(
        sessionId: string,
        content: string,
        files?: any[],
        replaceMessageId?: string | null
    ): Promise<Message>
    fetchTokenStatistics(sessionId: string): Promise<any>
    clearSessionMessages(sessionId: string): Promise<boolean>
    updateSession(sessionId: string, data: any): Promise<Session>
    generateSessionTitle(sessionId: string): Promise<{ title: string; skipped?: boolean }>

    // 消息管理
    deleteMessage(messageId: string): Promise<{ success: boolean }>
    updateMessage(messageId: string, data: any): Promise<Message>
    setMessageCurrentContent(messageId: string, contentId: string): Promise<any>

    // 流式聊天
    chat(
        sessionId: string,
        messageId: string,
        regeneration_mode?: string | null,
        assistant_message_id?: string | null,
        enableReasoning?: boolean
    ): AsyncGenerator<StreamEvent, void, unknown>
    cancelResponse(sessionId: string): Promise<void>
    abortCurrentRequest(): void

    // 文件上传
    uploadAvatar(uid: string, file: File, type?: 'character' | 'session'): Promise<UploadResponse>
    uploadUserAvatar(file: File): Promise<UploadResponse>
    uploadFile(sessionId: string, file: File): Promise<UploadResponse>
    copyMessageFile(messageId: string, fileId: string): Promise<any>
    webSearch(messageId: string): Promise<any>

    // 认证
    login(credentials: LoginRequest): Promise<LoginResponse>
    register(data: RegisterRequest): Promise<LoginResponse>
    getProfile(): Promise<User>
    updateProfile(data: any): Promise<User>
    changePassword(oldPassword: string, newPassword: string): Promise<any>
    checkResetPassword(): Promise<ResetPasswordCheckResponse>
    resetPrimayPassword(data: ResetPasswordRequest): Promise<any>

    // 子账户管理
    createSubaccount(data: any): Promise<Subaccount>
    updateSubaccount(subaccountId: string, data: any): Promise<Subaccount>
    deleteSubaccount(subaccountId: string): Promise<boolean>
    fetchSubaccounts(): Promise<Subaccount[]>

    // 设置管理
    fetchSettings(): Promise<GlobalSettings>
    updateSettings(data: any): Promise<GlobalSettings>

    // MCP 服务器管理
    fetchMcpServers(): Promise<PaginatedResponse<McpServer>>
    fetchMcpServer(serverId: string): Promise<McpServer>
    fetchMcpServerById(serverId: string): Promise<McpServer>
    createMcpServer(data: any): Promise<McpServer>
    updateMcpServer(serverId: string, data: any): Promise<McpServer>
    deleteMcpServer(serverId: string): Promise<boolean>
    toggleMcpServer(serverId: string, enabled: boolean): Promise<McpServer>
    refreshMcpTools(serverId: string): Promise<McpServer>
    getMcpServers(): Promise<PaginatedResponse<McpServer>>

    // 工具方法
    debounce<T extends (...args: any[]) => any>(func: T, delay: number): T
}
