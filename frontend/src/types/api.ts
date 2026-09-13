/**
 * API 相关类型定义
 */

import type { PaginatedResponse } from './common'
import type { Character, CharacterListResponse } from './character'
import type { Session, SessionListResponse } from './session'
import type { Message } from './message'

/**
 * wire 兼容开关（对齐 DSH 的 compat 块；与后端 ThinkingCompatConfig 同构）
 */
export interface ThinkingCompatConfig {
    /** 开关字段的 wire 拼法；缺省 = openai */
    thinkingFormat?: string
    /** 强度值是否上 wire；缺省 = 该 format 的默认 */
    supportsReasoningEffort?: boolean
    /** 助手消息必须携带 reasoning_content（DeepSeek 系跨轮回传） */
    requiresReasoningContentOnAssistantMessages?: boolean
    chatTemplateArgs?: Record<string, unknown>
    chatTemplateKwargs?: Record<string, unknown>
    /** Responses 协议是否请求加密推理内容回传 */
    includeEncryptedReasoning?: boolean
}

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
    /** 思考档位菜单（能力与档位是同一份数据；空数组 = 不能思考） */
    thinkingEfforts?: string[]
    /** 档位 → wire 值映射（仅在有映射时返回） */
    thinkingEffortsMap?: Record<string, string>
    /** 生效的思考请求拼法（模型条目 > 实例级 > 类型卡；必有值，缺省 openai） */
    thinkingFormat?: string
    /** 生效的"强度值是否上 wire"（必有值） */
    supportsReasoningEffort?: boolean
    /** 生效的思考能力（supportsThinking 解析值；菜单空 = 不能思考） */
    supportsThinking?: boolean
    /** 条目级档位覆盖（false = 显式无档位；缺省 = 档位来自继承链） */
    thinkingEffortsOverride?: false | string[]
    /** 条目级思考能力覆盖（缺省 = 来自继承链；切回继承时发 null 清除） */
    supportsThinkingOverride?: boolean
    /** 条目级 compat 覆盖（缺省 = 来自继承链；切回继承时发 null 清除） */
    compatOverride?: ThinkingCompatConfig
    config?: {
        inputCapabilities?: string[]
        outputCapabilities?: string[]
        features?: string[]
        contextWindow?: number | null
        maxOutputTokens?: number | null
        customParameters?: Record<string, any>
    }
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
    /** 实例级 wire 兼容开关覆盖（缺省 = 继承类型卡） */
    compat?: ThinkingCompatConfig
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
    url?: string | null
    type?: string | null
    description?: string | null
    headers?: Record<string, any> | null
    command?: string | null
    args?: string[] | null
    env?: Record<string, string> | null
    cwd?: string | null
    tools: McpTool[]
    isActive: boolean
    enabled?: boolean
    createdAt?: string
    updatedAt?: string
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
    createMessage: Message
    updateMessage: Message
    deleteTurn: { success: boolean }

    // 认证相关
    login: { accessToken: string; user: User }
    getProfile: User
    updateProfile: User
    checkUsername: { available: boolean }

    // MCP 服务器相关
    fetchMcpServers: PaginatedResponse<McpServer>
    fetchMcpServer: McpServer
    createMcpServer: McpServer
    updateMcpServer: McpServer
    deleteMcpServer: { success: boolean }
}
