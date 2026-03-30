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
    is_streaming: boolean
    is_thinking?: boolean
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
    reasoning_content?: string | null
    turns_id?: string
    additional_kwargs?: Record<string, any>
    meta_data?: Record<string, any>
    created_at?: ISODateString
    updated_at?: ISODateString
    thinking_started_at?: number | null
    thinking_duration_ms?: number | null
    state: MessageState
    _thinkingTimer?: number
    is_current?: boolean
}

/**
 * 消息对象
 */
export interface Message {
    id: string
    role: MessageRole
    contents: MessageContent[]
    parent_id?: string
    current_turns_id?: string
    state: MessageState
    created_at?: ISODateString
    files?: FileAttachment[]
    index?: number
}

/**
 * 消息对（用于 UI 展示）
 */
export type MessagePair = [Message] | [Message, Message]
