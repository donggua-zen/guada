/**
 * 消息工具函数 TypeScript 版本
 */

import { shallowReactive, type ShallowReactive } from 'vue'

/**
 * 消息接口定义
 */
export interface Message {
    id: string
    role: 'user' | 'assistant'
    contents: MessageContent[]
    parent_id?: string
    current_turns_id?: string
    state: {
        is_streaming: boolean
        is_thinking?: boolean
    }
    created_at?: string
    files?: FileAttachment[]
    index?: number
}

/**
 * 消息内容接口
 */
export interface MessageContent {
    id: string
    content: string | null
    reasoning_content?: string | null
    turns_id?: string
    additional_kwargs?: Record<string, any>
    meta_data?: Record<string, any>
    created_at?: string
    updated_at?: string
    thinking_started_at?: number | null
    thinking_duration_ms?: number | null
    state: {
        is_streaming: boolean
        is_thinking: boolean
    }
    _thinkingTimer?: number
    is_current?: boolean
}

/**
 * 文件附件接口
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
 * 消息对类型
 */
export type MessagePair = [Message] | [Message, Message]

/**
 * 消息配对：将用户消息和助手消息配对
 * @param messages - 消息列表
 * @returns 配对后的消息数组
 */
export function pairMessages(messages: Message[]): MessagePair[] {
    const pairs: MessagePair[] = []
    let i = 0

    while (i < messages.length) {
        const current = messages[i]

        // 为每条消息设置索引（用于显示）
        current.index = i

        if (current.role === 'user') {
            const next = messages[i + 1]

            // 检查下一条是否存在、是 assistant、且 parent_id 匹配
            if (
                next &&
                next.role === 'assistant' &&
                next.parent_id === current.id
            ) {
                next.index = i + 1
                pairs.push([current, next])
                i += 2
                continue
            }

            // 无法配对，单独成组
            pairs.push([current])
            i += 1
        } else {
            // 当前是 assistant（孤立答案）
            pairs.push([current])
            i += 1
        }
    }

    return pairs
}

/**
 * 获取当前内容索引（已废弃）
 * @deprecated 已废弃，直接使用 message.current_turns_id 和 turns 过滤
 */
export function getCurrentIndex(messageContents: MessageContent[]): number {
    console.warn('getCurrentIndex 已废弃，请使用 message.current_turns_id')
    if (!messageContents?.length) return 0
    const currentIndex = messageContents.findIndex(content => content.is_current)
    return currentIndex !== -1 ? currentIndex : 0
}

/**
 * 获取当前版本的内容数组
 * @param message - 消息对象
 * @returns 当前版本的内容数组（过滤后的 turns）
 */
export function getCurrentTurns(message: Message): MessageContent[] {
    if (!message?.contents) return []

    // 如果是 assistant 消息，根据 current_turns_id 过滤
    if (message.role === 'assistant' && message.current_turns_id) {
        const matchedContents = message.contents.filter(
            content => content.turns_id === message.current_turns_id
        )

        return matchedContents
    }

    // User 消息或没有 current_turns_id 的情况：返回所有内容
    return message.contents
}

/**
 * 获取当前内容的版本号集合
 * @param message - 消息对象
 * @returns 所有唯一的 turns_id 集合
 */
export function getContentVersions(message: Message): string[] {
    if (!message?.contents) return []

    const versions = new Set<string>()
    message.contents.forEach(content => {
        if (content.turns_id) {
            versions.add(content.turns_id)
        }
    })

    return Array.from(versions)
}

/**
 * 创建浅响应式消息对象
 * @param data - 消息数据
 * @returns 浅响应式消息对象
 */
export function createShallowMessage(data: Message): ShallowReactive<Message> {
    return shallowReactive({
        ...data,
        contents: data.contents?.map(c => shallowReactive(c)) || [],
        state: shallowReactive(data.state || {}),
        files: data.files || []
    })
}

/**
 * 判断是否允许重新发送消息
 * @param message - 消息对象
 * @param index - 消息索引
 * @param activeMessages - 所有消息列表
 * @returns 是否允许重新发送
 */
export function allowReSendMessage(
    message: Message,
    index: number,
    activeMessages: Message[]
): boolean {
    if (message.role !== 'user') return false
    // 最后一条 user 消息允许重新再发送栏中编辑
    return index >= activeMessages.length - 2
}

/**
 * 格式化思考时长
 * @param ms - 毫秒数
 * @returns 格式化后的时长
 */
export function formatDuration(ms: number | null | undefined): string {
    if (!ms) return ''
    const seconds = ms / 1000
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = (seconds % 60).toFixed(1)
    return `${minutes}分${remainingSeconds}秒`
}
