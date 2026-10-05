/**
 * 会话相关类型定义
 */

import type { ISODateString } from './common'
import type { Turn } from './message'
// 注意：不要重新导出 Message，避免循环依赖
import type { Agent } from './agent'
import type { FileRef, FileRefType } from './stream/content-block.types'

/**
 * 会话设置
 */
export interface SessionSettings {
    thinkingEffort?: string // 思考强度级别：'none' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
    systemPrompt?: string
    /** 计划模式（协作状态，正交于 sandboxMode；开启后后端强制只读） */
    planEnabled?: boolean
    /** 后端 session.settings 为开放字典（attachments/referencedKbs/sandboxMode/maxTokensLimit 等按需写入） */
    [key: string]: unknown
}

/**
 * 附件视图对象（输入框 / 排队消息 / 编辑回填共用）。
 *
 * 是三种前端形态的字段并集，消费方（toPayloadFileRef）按「有没有引用锚点」分派：
 * - 上传响应 / 编辑回填的投影：有 url（+ refType），即 UploadResponse / FileRef 契约
 * - Electron 非图片附件：有 localPath 无 url
 * - 新选未上传的：只有 file（原始 File）与展示字段
 * 全部字段可选，便于三种形态互转与渐进回填。
 */
export interface ChatFileView {
    /** 展示名（历史 FileRef 为 name；ChatFile 卡片为 fileName/displayName） */
    name?: string
    fileName?: string
    displayName?: string
    /** MIME 类型（FileRef 契约字段） */
    mediaType?: string
    /** MIME 类型别名（FileAttachment 历史形态用 type） */
    type?: string
    bytes?: number
    fileSize?: number
    size?: number
    /** 引用锚点：上传响应 / 历史 FileRef 的存储引用 */
    url?: string
    previewUrl?: string
    fileExtension?: string
    ext?: string
    /** Electron 本机绝对路径（非图片附件，不经上传） */
    localPath?: string
    /** 引用形态；缺省由消费方按来源推断（localPath → 'local'，否则 'store'） */
    refType?: FileRefType
    /** 待上传的原始 File（新选附件才有） */
    file?: File
    /** 以下为 ChatInput 附件卡片字段 */
    id?: number | string
    fileType?: 'image' | 'file'
    isPasted?: boolean
    originalContent?: string
    uploadProgress?: number
    uploadStatus?: 'queued' | 'uploading' | 'uploaded' | 'failed'
    uploadError?: string
}

/**
 * 输入消息状态
 */
export interface InputMessageState {
    content: string
    files: ChatFileView[]
    knowledgeBaseIds?: string[]
    isWaiting: boolean
}

/**
 * 排队消息项（流式期间用户发送的消息进入队列）
 */
export interface QueuedMessage {
    id: string              // 前端生成的唯一 ID
    content: string         // 消息文本
    /** 已是发送契约形态：enqueue 前经 prepareNewMessage 上传并映射为 FileRef（唯一入队路径 ChatPanel.handleSendMessage） */
    files: FileRef[]
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
    turns: Turn[]  // 回合外壳列表（后端 getTurns 直连，渲染用）
    isStreaming: boolean
    isCompressing: boolean
    /** 统一流状态(发送中/运行中/结束),取代分散的 isStreaming + sidebar.working */
    streamStatus: StreamStatus
    /** 流类型：chat=对话回合；maintenance=维护任务（手动压缩伪流，buffer 无回合历史） */
    streamKind?: 'chat' | 'maintenance'
    /**
     * 会话级统一交互卡（审批/询问共用，对齐 DSH：sessionId 唯一锚点，不挂回合
     * ——ask_requested 事件标记，ask_resolved / turn_end 清除）。全局卡在输入区上方展示。
     */
    pendingAsk?: {
        /** 临时凭证 id（uuid，应答提交时回传匹配等待者） */
        requestId: string
        /** 卡片分类：approval=审批（ask 特例）/ ask=询问 */
        kind: 'approval' | 'ask'
        /** 卡片标题（如"进行文档处理"） */
        title?: string
        toolCallId?: string
        toolName?: string
        /** 问题单（前端分页收集答案） */
        questions: import('./stream/event-chunk.types').AskQuestion[]
    }
    /**
     * 计划模式（协作状态，正交于安全档位）。事实源是会话设置；
     * 本字段是 UI 投影——用户从界面开关时乐观写入，模型经 ExitPlanMode 审批通过后
     * 由 plan_mode_changed 流帧写入（此时前端是唯一知情方）。
     */
    planEnabled?: boolean
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
    lastUpdated: number
    settings: SessionSettings
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
    agent: Agent
    agentId: string
    /** null = 未绑定模型（后端允许） */
    modelId: string | null
    model?: SessionModel
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

    // === 子代理冻结标记（仅子会话使用；非空 = 已结束仅供回放） ===
    closedAt?: string | null  // 冻结时间（ISO 字符串）
    closeReason?: string | null  // 结束原因：completed / error / closed
    // ==================================

    // === 子会话列表（后端注入） ===
    subSessions?: Session[]
    // ==================================
}

/**
 * 创建会话请求数据
 */
export interface CreateSessionRequest {
    agentId: string
    modelId?: string
    title?: string
    settings?: Partial<SessionSettings>
    /** 自定义工作目录；null → 后端自动生成临时目录 */
    workspacePath?: string | null
    groupId?: string
    avatarUrl?: string
}

/**
 * 更新会话请求数据（后端 updateSession 白名单：modelId/settings/title/groupId/agentId，
 * 工作目录路径明确不允许经此接口更新）
 */
export interface UpdateSessionRequest {
    title?: string
    /** null = 清除模型绑定（后端 assertResolvableModelRef 对 null 直接放行） */
    modelId?: string | null
    settings?: Partial<SessionSettings>
    /** null = 移出分组（后端按 !== undefined 透传） */
    groupId?: string | null
    agentId?: string
}

/**
 * 会话分组
 */
export interface SessionGroup {
    id: string
    name: string
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
 * 搜索响应（渐进扫描游标分页）
 * cursor 为后端扫描进度游标（不透明透传）；前端自动循环拉取直到 hasMore=false
 */
export interface SearchSessionResponse {
    items: SearchSessionResult[]
    hasMore: boolean
    nextCursor: string | null
    /** 扫描进度（已扫描 / 总会话数，驱动"正在扫描 x/y"文案） */
    progress?: { scanned: number; total: number }
}
