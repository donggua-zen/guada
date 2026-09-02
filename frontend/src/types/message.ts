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
 * 文件附件
 */
export interface FileAttachment {
    id?: string
    name: string
    url?: string
    type?: string
    size?: number
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
 * 回合内内容块（二级结构：turn → block，跳过 Message 容器级）。
 * 在 MessageContent（展示基类）基础上补 role/messageId：
 * - role：折叠器按事件源打标（user_message→'user'；assistant 块→'assistant'；tool-result 块→'tool'；compaction 占位→'event'）
 * - messageId：所属后端消息 id（编辑/审批/继续执行 API 锚点）
 * - blockIndex：消息内块序号（assistant 流式寻址 (messageId, index) 用；展示无关）
 * - source/kind：消息来源与逻辑归属（后端 Message.source / Message.kind 透传）
 */
export interface TurnContent extends MessageContent {
    role: MessageRole
    messageId: string
    blockIndex?: number
    /**
     * 消息来源（后端 Message.source）——判断"是不是人说的话"的单一真相。
     * kind='user' 才是人类真实输入；其余（plugin/model/tool/sub_agent/...）
     * 为注入或产出，不作为用户消息展示。
     * 流式投影与历史加载两条路径都需补全，避免前端靠"取第一个 user 块"隐式规避。
     */
    source?: { kind: string; [key: string]: any }
    /** 逻辑归属（后端 Message.kind：'user' 真实用户 / 'model' 模型工作流） */
    kind?: 'user' | 'model'
}

/**
 * 回合外壳（直接对应后端 Turn：一次输入回合 = user + assistant/tool 消息）
 * 二级结构：contents 直接平铺该回合全部块（role 区分 user/assistant/tool/event），
 * 不再经 Message 容器——折叠器直接产出块，渲染直接消费块（消除组装→拆分）。
 */
export interface Turn {
    id: string
    /** 'turn' 对话回合 / 'event' 事件类消息外壳（command/compaction 等） */
    kind: 'turn' | 'event'
    metadata: Record<string, any>
    visible: boolean
    blocks: TurnContent[]
    /** 回合瞬态视图态（历史加载的回合无此字段 = 非工作态） */
    state?: TurnState
}

/**
 * 消息对（用于 UI 展示）
 */
export type MessagePair = [Message] | [Message, Message]
