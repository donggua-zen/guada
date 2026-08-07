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
    thinkingEffort?: string // 思考强度级别：'none' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
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
 * 排队消息项（流式期间用户发送的消息进入队列）
 */
export interface QueuedMessage {
    id: string              // 前端生成的唯一 ID
    content: string         // 消息文本
    files: any[]            // 已上传的文件对象列表
    knowledgeBaseIds?: string[]
    createdAt: number       // 创建时间戳
    status: 'queued' | 'sending'  // 状态
}

/**
 * 会话状态（用于 Store）
 */
export interface SessionState {
    messages: any[]  // 使用 any 避免循环导入
    isStreaming: boolean
    isCompressing: boolean
    inputMessage: InputMessageState
    scrollPosition: number
    lastUpdated: number
    settings: SessionSettings
    title?: string
    messageQueue: QueuedMessage[]  // 排队消息列表
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
    
    // === Bot 会话专用字段 ===
    sessionType?: string      // "web" | "bot"
    botId?: string            // Bot 实例ID
    platform?: string         // 来源平台: 'qq', 'wechat'
    externalId?: string       // 外部会话标识,格式: "platform:type:nativeId"
    workspacePath?: string | null  // 自定义工作目录路径
    groupId?: string | null         // 会话分组ID
    archived?: boolean               // 是否已归档
    // ==================================

    // === 侧边栏状态字段（后端注入或前端维护） ===
    isStreaming?: boolean     // 是否正在流式响应（后端注入）
    // ==================================

    // === 子会话列表（后端注入） ===
    subSessions?: Session[]
    // ==================================
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
 * 会话分组
 */
export interface SessionGroup {
    id: string
    name: string
    userId: string
    sortOrder: number
    createdAt: ISODateString
    updatedAt: ISODateString
}

/**
 * 会话列表响应
 */
export interface SessionListResponse {
    items: Session[]
    total: number
    page: number
    pageSize: number
    hasMore?: boolean
}

/**
 * 侧边栏批量加载响应：一次请求返回所有分组 + 各分组前 N 条会话
 */
export interface SidebarGroupSessions {
    groupId: string | null
    items: Session[]
    total: number
    hasMore: boolean
}

export interface SidebarSessionsResponse {
    groups: SessionGroup[]
    groupSessions: SidebarGroupSessions[]
}

/**
 * 搜索结果项（扩展 Session，附带匹配信息）
 */
export interface SearchSessionResult extends Session {
    matchType: 'title' | 'content'
    matchSnippet?: string
}

/**
 * 搜索响应（游标分页）
 */
export interface SearchSessionResponse {
    items: SearchSessionResult[]
    hasMore: boolean
    nextCursor: string | null
}
