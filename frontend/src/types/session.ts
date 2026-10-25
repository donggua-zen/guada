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

/** 排队消息入队时冻结的发送设置（补发时作为回合级覆盖，不写回会话设置） */
export interface QueuedMessageSettingsSnapshot {
    /** 形如 {providerId}:{modelName} */
    modelId?: string
    thinkingEffort?: string
    maxTokensLimit?: number | null
    /** 安全档位（后端 settings.sandboxMode） */
    mode?: string
    planEnabled?: boolean
}

/**
 * 排队消息项（UI 视图）。
 *
 * M3 起队列所有权在后端：本结构是 UserQueueSnapshotItem 的本地投影，
 * 不再由前端增删改，只能通过 store.applyQueueSnapshot 整块替换。
 */
export interface QueuedMessage {
    id: string
    content: string
    /** 发送契约形态（FileRef） */
    files: FileRef[]
    knowledgeBaseIds?: string[]
    createdAt: number
    /** queued=排队中；running=正在启动/已进入回合；failed=启动失败等用户处理 */
    status: 'queued' | 'running' | 'failed'
    /** 启动失败原因（status=failed 时有值） */
    error?: string
    /** 入队时的编辑重发目标回合 */
    replaceTurnId?: string
    /** 入队时冻结的发送设置 */
    settingsSnapshot?: QueuedMessageSettingsSnapshot
}

/** 后端回合级设置覆盖（与 backend TurnSettingsOverride 同构） */
export interface UserQueueSettingsOverride {
    modelId?: string
    thinkingEffort?: string
    maxTokensLimit?: number | null
    sandboxMode?: string
    planEnabled?: boolean
}

/** 服务端队列快照项（GET /sessions/:id/queue 与 queue_updated 事件） */
export interface UserQueueSnapshotItem {
    id: string
    content: string
    files: FileRef[]
    knowledgeBaseIds?: string[]
    replaceTurnId?: string
    settingsOverride?: UserQueueSettingsOverride
    status: 'queued' | 'running' | 'failed'
    error?: string
    createdAt: string
}

/** 服务端队列全量快照（epoch 变化 = 后端重启，revision 用于乱序丢弃） */
export interface UserQueueSnapshot {
    sessionId: string
    epoch: string
    revision: number
    paused: { reason: QueuePauseReason; at: string } | null
    promotionId: string | null
    isProcessing: boolean
    items: UserQueueSnapshotItem[]
}

/**
 * 队列暂停原因：用户停止/出错/手动暂停后保留队列但不再自动补发，等用户显式继续。
 * 与 ZCode 的 pauseReason、本项目后端 ChatRunner 的"user_cancel 不自动重开"对齐。
 */
export type QueuePauseReason = 'stopped' | 'error' | 'manual'

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

/** 计划状态：待审批 / 已批准 / 已拒绝 */
export type SessionPlanStatus = 'pending' | 'approved' | 'rejected'

/** 计划历史条目（GET /sessions/:id/plans；计划身份 = 提交它的 ExitPlanMode toolCallId） */
export interface SessionPlanItem {
    planId: string
    /** 所属回合（可在对话里定位；回合被删除的条目不返回） */
    turnId: string | null
    /** 列表标题：计划首个 Markdown 标题，缺省取首个非空行 */
    title: string
    /** 计划正文（Markdown 全文） */
    content: string
    status: SessionPlanStatus
    /** 提交时间（Unix 毫秒） */
    createdAt: number
    /** 已落盘文件的工作区相对路径（未落盘为 null） */
    path: string | null
}

/** 一次挂起中的交互（会话级统一交互卡队列的元素） */
export interface PendingAsk {
    /** 临时凭证 id（uuid，应答提交时回传匹配等待者） */
    requestId: string
    /** 卡片分类：approval=审批（ask 特例）/ ask=询问 */
    kind: 'approval' | 'ask'
    /** 卡片类型（显式分类；旧帧可能缺省，消费方按需回退） */
    cardKind?: import('./stream/event-chunk.types').AskCardKind
    /** 卡片标题（如"进行文档处理"） */
    title?: string
    toolCallId?: string
    toolName?: string
    /** 问题单（前端分页收集答案） */
    questions: import('./stream/event-chunk.types').AskQuestion[]
}

export interface SessionState {
    turns: Turn[]  // 回合外壳列表（后端 getTurns 直连，渲染用）
    isStreaming: boolean
    isCompressing: boolean
    /** 统一流状态(发送中/运行中/结束),取代分散的 isStreaming + sidebar.working */
    streamStatus: StreamStatus
    /** 流类型：chat=对话回合；maintenance=维护任务（手动压缩伪流，buffer 无回合历史） */
    streamKind?: 'chat' | 'maintenance'
    /**
     * 会话级统一交互卡**队列**（审批/询问共用，对齐 DSH：sessionId 唯一锚点，不挂回合
     * ——ask_requested 事件按 requestId 入队，ask_resolved 只摘对应那一个）。
     *
     * 为什么是队列而不是单个槽位：一个助手消息里的多个工具调用是**并发**执行的
     * （tool-executor 是 10 并发 worker pool），每个都可能触发审批。单槽会让后一个
     * 覆盖前一个 → 被覆盖的等待者永远没人应答 → 后端无超时 → 整个回合永久挂住。
     *
     * key = requestId；`Record` 保留插入顺序，即"到达顺序"（展示取队首）。
     */
    pendingAsks?: Record<string, PendingAsk>
    /**
     * 计划模式（协作状态，正交于安全档位）。事实源是会话设置；
     * 本字段是 UI 投影——用户从界面开关时乐观写入，模型经 ExitPlanMode 审批通过后
     * 由 plan_mode_changed 流帧写入（此时前端是唯一知情方）。
     */
    planEnabled?: boolean
    /**
     * 计划历史缓存（计划模式产物：由转录构建的列表，含待审/已批/被拒状态）。
     * 刷新触发：会话切换、plan_mode_changed 帧、turn_end（批准/拒绝/修订各路径兜底）；
     * 消费方：计划面板、起始页入口、审批卡「查看完整计划」。
     */
    plans?: SessionPlanItem[]
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
    /**
     * 队列暂停原因：停止/出错/手动后队列保留但不自动补发（避免"一按停止就自动发下一条"）。
     * null/undefined = 正常自动消费。
     */
    queuePaused?: QueuePauseReason | null
    /** 服务端"立即发送"目标（快照投影；UI 显示"即将发送"） */
    queuePromotionId?: string | null
    /** 队列快照 epoch（后端进程标识）与 revision（乱序丢弃） */
    queueEpoch?: string
    queueRevision?: number
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
    /**
     * 工作目录比较键（后端归一化派生列）。
     * 侧栏「目录」模式用它匹配 ProjectGroup.pathKey —— 前端不再自行归一化。
     */
    workspaceKey?: string | null
    groupId?: string | null         // 会话分组ID
    archived?: boolean               // 是否已归档
    pinned?: boolean                 // 是否置顶（侧边栏顶部「已置顶」分区）
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
 * 更新会话请求数据（后端 updateSession 白名单：modelId/settings/title/groupId/agentId/pinned，
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
    /** 是否置顶 */
    pinned?: boolean
}

/**
 * 会话分组
 */
export interface SessionGroup {
    id: string
    name: string
    sortOrder: number
    /** 自定义图标 key；null/缺省 = 默认文件夹 */
    icon?: string | null
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
 * 目录分组（侧栏「目录」模式）。
 *
 * 实体由后端物化（可重命名/排序/取消注册），成员关系派生：
 * `session.workspaceKey === group.pathKey`。`kind = 'general'` 是前端合成的
 * 虚拟「通用」桶（空路径 + 未注册目录 + 自动生成目录 + public），无后端实体。
 */
export interface ProjectGroup {
    id: string
    name: string
    /** 目录绝对路径；虚拟通用桶为 null */
    path: string | null
    /** 归一化比较键；虚拟通用桶为 null */
    pathKey: string | null
    sortOrder: number
    /** 用户改过显示名（bootstrap 不会覆盖） */
    isOverridden: boolean
    /** 自定义图标 key；null/缺省 = 默认文件夹 */
    icon?: string | null
    kind: 'workspace' | 'general'
}

/** 侧栏目录模式响应：groups + 各桶前 N 条会话 */
export interface SidebarProjectSessionsResponse {
    groupBy: 'workspace'
    groups: Array<Omit<ProjectGroup, 'kind'> & { kind: 'workspace' }>
    generalGroup: { id: string; kind: 'general' }
    groupSessions: SidebarGroupSessions[]
}

/** 分组统计（手工分组与目录分组共用形状；仅 web 会话） */
export interface GroupStats {
    total: number
    active: number
    archived: number
    pinned: number
}

/** 归档手工分组结果（skipped = 流式输出中被跳过的会话数） */
export interface ArchiveSessionGroupResult {
    success: boolean
    archived: number
    skipped: number
    sessionIds: string[]
}

/** 归档项目结果（skipped = 流式输出中被跳过的会话数；sessionIds = 成功归档的 id） */
export interface ArchiveProjectGroupResult {
    success: boolean
    archived: number
    skipped: number
    sessionIds: string[]
}

/** 删除项目结果（sessionIds 供前端精确清理本地会话缓存） */
export interface DeleteProjectGroupResult {
    success: boolean
    deleted: number
    sessionIds: string[]
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
