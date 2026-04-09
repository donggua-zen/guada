/**
 * 会话相关类型定义
 */

import type { ISODateString, DeepPartial } from './common'
// 注意：不要重新导出 Message，避免循环依赖
import type { Character } from './character'

/**
 * 会话设置
 */
export interface SessionSettings {
    isDeepThinking?: boolean
    thinkingEnabled?: boolean
    maxMemoryLength?: number
    systemPrompt?: string
    [key: string]: any
}

/**
 * 输入消息状态
 */
export interface InputMessageState {
    content: string
    files: any[]
    knowledgeBaseIds?: string[]
    isWaiting: boolean
}

/**
 * 会话状态（用于 Store）
 */
export interface SessionState {
    messages: any[]  // 使用 any 避免循环导入
    isStreaming: boolean
    inputMessage: InputMessageState
    scrollPosition: number
    lastUpdated: number
    settings: SessionSettings
    title?: string
}

/**
 * 会话模型配置
 */
export interface SessionModel {
    id: string
    modelName: string
    providerId?: string
}

/**
 * 会话对象
 */
export interface Session {
    id: string
    title: string
    character: Character
    characterId: string
    modelId: string
    model?: SessionModel
    userId: string
    settings: SessionSettings
    createdAt: ISODateString
    updatedAt: ISODateString
    lastActiveAt?: ISODateString
    avatarUrl?: string
}

/**
 * 创建会话请求数据
 */
export interface CreateSessionRequest {
    characterId: string
    modelId?: string
    title?: string
    settings?: Partial<SessionSettings>
}

/**
 * 更新会话请求数据
 */
export interface UpdateSessionRequest {
    title?: string
    modelId?: string
    settings?: Partial<SessionSettings>
}

/**
 * 会话列表响应
 */
export interface SessionListResponse {
    items: Session[]
    total: number
    page: number
    pageSize: number
}
