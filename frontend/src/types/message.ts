/**
 * 消息相关类型定义
 */

import type { ISODateString } from './common'

/**
 * 消息角色类型（与后端协议对齐）
 */
export type MessageRole = 'user' | 'assistant' | 'tool' | 'event'

/**
 * 消息状态
 */
export interface MessageState {
    isStreaming: boolean
    isThinking?: boolean
}

/**
 * 文件附件（投影层产物，源自块 attachment FileRef）
 * name/url/type/size 与 FileRef.name/url/mediaType/bytes 对应；
 * ext/displayName/previewUrl 为展示便捷字段。
 */
export interface FileAttachment {
    /** 展示 key（新数据 = 存储 url；旧数据 = attachmentId） */
    id?: string
    name: string
    /** 相对存储路径（uploads/...）或绝对 URL */
    url?: string
    /** MIME 类型（FileRef.mediaType） */
    type?: string
    /** 扩展名（不带点） */
    ext?: string
    /** 字节数 */
    size?: number
    /** 展示用绝对化后的存储路径 */
    absoluteUrl?: string
    /** 预览路径（图片缩略图） */
    previewUrl?: string
    file?: File
    [key: string]: any
}

/**
 * 消息内容块
 */
export interface MessageContent {
    id: string
    content: string | null
    reasoningContent?: string | null
    turnsId?: string
    additionalKwargs?: Record<string, any>
    metadata?: Record<string, any>
    createdAt?: ISODateString
    updatedAt?: ISODateString
    /** 思考跳动锚点（本地收包时钟，仅展示层流式期间使用） */
    thinkingStartedAt?: number | null
    /** 思考时长 ms（由 reasoning 块的 timing 派生；历史加载来自持久化 timing） */
    thinkingDurationMs?: number | null
    /** 内容级状态（思考展开/计时等渲染用；与回合级工作态正交） */
    state: MessageState
    isCurrent?: boolean
    files?: FileAttachment[]
    /** 块级注入标记（与后端 TextBlock.origin 同构）：'system' = 系统注入，渲染层跳过 */
    origin?: 'system'
    /** KB 引用明细（kb-ref 块 → chips 渲染数据源；正文不渲染序列化文本） */
    kbRefs?: Array<{ id: string; name: string; description?: string }>
}

/**
 * 消息对象（id 为后端真实消息 id）
 */
export interface Message {
    id: string
    role: MessageRole
    contents: MessageContent[]
    parentId?: string
    createdAt?: ISODateString
    files?: FileAttachment[]
    index?: number
    totalDurationMs?: number | null
    /**
     * 轮次级元数据（来自后端 Turn.metadata / 三层适配层）：
     * finishReason / errorDetail / modelName / totalDurationMs / compactInfo / hidden / shadowed 等
     */
    metadata?: Record<string, any>
}

/**
 * 回合瞬态状态（纯前端视图态，不落库、不进协议）
 */
export interface TurnState {
    /** 是否工作中：turn_start/turn_resume 置位，turn_end 复位 */
    isWorking?: boolean
    /**
     * 工作时长秒表锚点（turn_start 置位时记录本地时钟，纯前端瞬态）：
     * 流式期间 useElapsedTicker 从该锚点跳动展示已耗时；
     * 回合结束以服务端 turn.metadata.totalDurationMs 为准覆盖（本地锚点不再参与）。
     */
    startedAt?: number
    /**
     * LLM 流重试瞬态（回合级，与 isWorking 同层；retry 事件标记，重试成功输出或 turn_end 清除）。
     * 不落库、不进消息 metadata——纯流式期间的瞬态视图态。
     */
    retry?: {
        retryReason: 'timeout' | 'rate_limited' | 'network_error'
        retryAttempt: number
        retryMaxAttempts: number
        retryDelayMs: number
        message?: string
    }
}

/**
 * 消息束：回合内一条后端消息（一次输入 / 一次 LLM 调用 / 一次注入）。
 * 消息级字段（role/kind/source/metadata/usage）只挂在此处一次，不再逐块复制；
 * 块级只保留块自身内容（展示/流式寻址经 bundle.blocks 内索引）。
 * 与后端三层模型 Turn → Message → ContentBlock 对齐（前端以 bundle 承载 Message 层）。
 */
export interface MessageBundle {
    /** 后端消息 id（编辑/审批/继续执行/删除 API 锚点） */
    messageId: string
    /** 协议角色（user/assistant/tool/event），消息级单一真相 */
    role: MessageRole
    /** 逻辑归属（后端 Message.kind：'user' 真实用户 / 'model' 模型工作流注入） */
    kind?: 'user' | 'model'
    /**
     * 消息来源（后端 Message.source）——判断"是不是人说的话"的单一真相。
     * kind='user' 才是人类真实输入；其余（plugin/model/tool/sub_agent/...）
     * 为注入或产出，不作为用户消息展示。
     */
    source?: { kind: string; [key: string]: any }
    /** 消息级元数据：usage/finishReason/referencedKbs/hidden/compactInfo 等 */
    metadata: Record<string, any>
    createdAt?: ISODateString
    /** 块级内容（展示派生时引用收集，不复制） */
    blocks: TurnContent[]
    /** 流式/折叠期瞬态标记（不落库） */
    state?: { isStreaming?: boolean; isThinking?: boolean }
}

/**
 * 回合内内容块。
 * role/messageId 为创建时一次性写入的不可变戳记（引用收集/展示过滤用，不参与流式更新）；
 * 消息级可变元数据（usage/source/kind/hidden）一律读所属 MessageBundle，不落在块上。
 */
export interface TurnContent extends MessageContent {
    /** 消息级戳记（折叠器创建块时从 bundle 写入一次，之后不变） */
    role: MessageRole
    messageId: string
    blockIndex?: number
    /** @deprecated 消息级字段已归 MessageBundle；保留仅兼容旧遍历消费（新代码读 bundle） */
    source?: { kind: string; [key: string]: any }
    /** @deprecated 消息级字段已归 MessageBundle；保留仅兼容旧遍历消费（新代码读 bundle） */
    kind?: 'user' | 'model'
}

/**
 * 回合外壳（直接对应后端 Turn：一次输入回合 = user + assistant/tool 消息）
 * 结构：turn → messages（MessageBundle[]）→ blocks（TurnContent[]）。
 * 折叠器产出 bundle（消息级权威），渲染层按需从 bundle 引用收集块做展示派生。
 */
export interface Turn {
    id: string
    /** 'turn' 对话回合 / 'event' 事件类消息外壳（command/compaction 等） */
    kind: 'turn' | 'event'
    metadata: Record<string, any>
    visible: boolean
    /** 消息束（取代旧平铺 blocks：一条后端消息 = 一个 bundle） */
    messages: MessageBundle[]
    /** 回合瞬态视图态（历史加载的回合无此字段 = 非工作态） */
    state?: TurnState
}

/**
 * 消息对（用于 UI 展示）
 */
export type MessagePair = [Message] | [Message, Message]
