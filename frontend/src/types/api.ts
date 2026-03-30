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
    model_name: string
    provider_id: string
    provider_name?: string
    is_active: boolean
    context_window?: number
    max_tokens?: number
    description?: string
    created_at?: string
    updated_at?: string
}

/**
 * 模型提供商
 */
export interface ModelProvider {
    id: string
    name: string
    api_base?: string
    api_key_set: boolean
    is_active: boolean
    created_at?: string
    updated_at?: string
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
    is_active: boolean
    created_at?: string
    updated_at?: string
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

/**
 * 认证令牌
 */
export interface AuthToken {
    access_token: string
    token_type: string
    expires_in?: number
}

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
    login: { access_token: string; user: User }
    register: { access_token: string; user: User }
    getProfile: User
    updateProfile: User
    
    // MCP 服务器相关
    fetchMcpServers: PaginatedResponse<McpServer>
    fetchMcpServer: McpServer
    createMcpServer: McpServer
    updateMcpServer: McpServer
    deleteMcpServer: { success: boolean }
}
