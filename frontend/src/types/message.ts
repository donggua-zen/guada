/**
 * 消息相关类型定义
 */

import type { ISODateString } from './common'

/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant'

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
    thinkingStartedAt?: number | null
    thinkingDurationMs?: number | null
    state: MessageState
    _thinkingTimer?: number
    isCurrent?: boolean
}

/**
 * 消息对象
 */
export interface Message {
    id: string
    role: MessageRole
    contents: MessageContent[]
    parentId?: string
    currentTurnsId?: string
    state: MessageState
    createdAt?: ISODateString
    files?: FileAttachment[]
    index?: number
}

/**
 * 消息对（用于 UI 展示）
 */
export type MessagePair = [Message] | [Message, Message]
