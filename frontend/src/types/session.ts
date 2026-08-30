/**
 * 会话相关类型定义
 */

import type { ISODateString, DeepPartial } from './common'
import type { Turn } from './message'
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
/**
 * 会话流状态(统一订阅器写入,UI 按此迁移)
 * - idle:无流
 * - pending:已发送,等待后端 running(发送中)
 * - running:后端已确认流开始
 * - completed:正常结束
 * - error:出错/取消
 */
export type StreamStatus = "idle" | "pending" | "running" | "completed" | "error";

export interface SessionState {
    messages: any[]  // 使用 any 避免循环导入
    turns: Turn[]  // 回合外壳列表（后端 getTurns 直连，渲染用）
    isStreaming: boolean
    isCompressing: boolean
    /** 统一流状态(发送中/运行中/结束),取代分散的 isStreaming + sidebar.working */
    streamStatus: StreamStatus
    /**
     * 会话级统一交互卡（审批/询问/迭代暂停继续共用，对齐 DSH：sessionId 唯一锚点，不挂回合
     * ——ask_requested 事件标记，ask_resolved / turn_end 清除）。全局卡在输入区上方展示。
     */
    pendingAsk?: {
        /** 临时凭证 id（uuid，应答提交时回传匹配等待者） */
        requestId: string
        /** 卡片分类：approval=审批（ask 特例）/ ask=询问 / continue=迭代暂停继续 */
        kind: 'approval' | 'ask' | 'continue'
        /** 卡片标题（如"进行文档处理"） */
        title?: string
        toolCallId?: string
        toolName?: string
        /** 问题单（前端分页收集答案） */
        questions: import('./stream/event-chunk.types').AskQuestion[]
    }
    /** 会话内容缓存已加载标记:二次打开时不再向后端拉取,仅靠订阅增量补新 */
    loaded?: boolean
    /** 历史是否还有更早回合(分页游标状态,按会话记忆;组件级单例 ref 切会话会串) */
    turnsHasMore?: boolean
    /**
     * 事件数组（前端自折叠的数据源）：已加载事件页（领域事件）+ live 追加事件（仅终态事件，delta 不记录）。
     * 树 = fold(eventLog)；load-more 前插旧页后全量 re-fold。
     */
    eventLog?: Array<
      import("@/types/stream").WireStreamEvent | import("@/types/stream/domain-event.types").DomainEvent
    >
    /** 分页游标：下一页事件页的 beforeSeq（页首前一 seq）；null = 无更早内容 */
    eventCursor?: number | null
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
