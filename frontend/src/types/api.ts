/**
 * API 相关类型定义
 */

import type { PaginatedResponse } from './common'
import type { Character, CharacterListResponse } from './character'
import type { Session, SessionListResponse } from './session'
import type { Message } from './message'

/**
 * 模型对象
 */
export interface Model {
    id: string
    modelName: string
    modelType: string
    providerId: string
    providerName?: string
    isActive: boolean
    contextWindow?: number
    maxOutputTokens?: number
    description?: string
    isFavorite?: boolean
    createdAt?: string
    updatedAt?: string
}

/**
 * 模型提供商
 */
export interface ModelProvider {
    id: string
    name: string
    provider?: string  // 供应商标识符 (siliconflow, openai, custom 等)
    protocol?: string  // 协议类型 (openai, openai-response, gemini, anthropic)
    apiBase?: string
    apiUrl?: string
    apiKey?: string
    apiKeySet: boolean
    isActive: boolean
    avatarUrl?: string
    attributes?: any
    createdAt?: string
    updatedAt?: string
    models?: Model[]
}

/**
 * 供应商模板
 */
export interface ProviderTemplate {
    id: string
    name: string
    protocol?: string  // 协议类型
    avatarUrl?: string
    defaultApiUrl?: string
    description?: string
    attributes?: any
}

/**
 * MCP 服务器工具
 */
export interface McpTool {
    name: string
    description?: string
    inputSchema?: Record<string, any>
    enabled: boolean
}

/**
 * MCP 服务器
 */
export interface McpServer {
    id: string
    name: string
    command: string
    args?: string[]
    env?: Record<string, string>
    tools: McpTool[]
    isActive: boolean
    createdAt?: string
    updatedAt?: string
}

/**
 * 用户信息
 */
export interface User {
    id: string
    username: string
    nickname?: string
    email?: string
    phone?: string
    avatarUrl?: string
    role?: 'primary' | 'subaccount'  // 用户角色：主账户或子账户
    isActive: boolean
    createdAt?: string
    updatedAt?: string
}

/**
 * 认证令牌
 */
export interface AuthToken {
    accessToken: string
    tokenType?: string
    expiresIn?: number
}

/**
 * 登录请求
 */
export interface LoginRequest {
    type: 'phone' | 'email'
    username: string
    password: string
}

/**
 * API 响应类型集合
 */
export interface ApiResponses {
    // 模型相关
    fetchModels: PaginatedResponse<Model>
    fetchRemoteModels: Model[]

    // 角色相关
    fetchCharacters: CharacterListResponse
    fetchCharacter: Character
    createCharacter: Character
    updateCharacter: Character
    deleteCharacter: { success: boolean }

    // 会话相关
    fetchSessions: SessionListResponse
    fetchSession: Session
    createSession: Session
    updateSession: Session
    deleteSession: { success: boolean }

    // 消息相关
    fetchSessionMessages: PaginatedResponse<Message>
    createMessage: Message
    updateMessage: Message
    deleteMessage: { success: boolean }

    // 认证相关
    login: { accessToken: string; user: User }
    getProfile: User
    updateProfile: User

    // MCP 服务器相关
    fetchMcpServers: PaginatedResponse<McpServer>
    fetchMcpServer: McpServer
    createMcpServer: McpServer
    updateMcpServer: McpServer
    deleteMcpServer: { success: boolean }
}
