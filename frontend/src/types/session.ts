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
    thinking_enabled?: boolean
    max_memory_length?: number
    system_prompt?: string
    [key: string]: any
}

/**
 * 输入消息状态
 */
export interface InputMessageState {
    content: string
    files: any[]
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
    model_name: string
    provider_id?: string
}

/**
 * 会话对象
 */
export interface Session {
    id: string
    title: string
    character: Character
    character_id: string
    model_id: string
    model?: SessionModel
    user_id: string
    settings: SessionSettings
    created_at: ISODateString
    updated_at: ISODateString
    last_active_at?: ISODateString
    avatar_url?: string
}

/**
 * 创建会话请求数据
 */
export interface CreateSessionRequest {
    character_id: string
    model_id?: string
    title?: string
    settings?: Partial<SessionSettings>
}

/**
 * 更新会话请求数据
 */
export interface UpdateSessionRequest {
    title?: string
    model_id?: string
    settings?: Partial<SessionSettings>
}

/**
 * 会话列表响应
 */
export interface SessionListResponse {
    items: Session[]
    total: number
    page: number
    page_size: number
}
