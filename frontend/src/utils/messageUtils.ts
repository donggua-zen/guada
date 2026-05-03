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
    parentId?: string
    currentTurnsId?: string
    state: {
        isStreaming: boolean
        isThinking?: boolean
    }
    createdAt?: string
    files?: FileAttachment[]
    index?: number
}

/**
 * 消息内容接口
 */
export interface MessageContent {
    id: string
    role?: 'user' | 'assistant' | 'tool'
    content: string | null
    reasoningContent?: string | null
    turnsId?: string
    additionalKwargs?: Record<string, any>
    metadata?: {
        toolCalls?: Array<{
            id?: string
            name?: string
            arguments?: any
            args?: any
            [key: string]: any
        }>
        toolCallId?: string
        [key: string]: any
    }
    createdAt?: string
    updatedAt?: string
    thinkingStartedAt?: number | null
    thinkingDurationMs?: number | null
    state: {
        isStreaming: boolean
        isThinking: boolean
    }
    _thinkingTimer?: number
    isCurrent?: boolean
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

            // 检查下一条是否存在、是 assistant、且 parentId 匹配
            if (
                next &&
                next.role === 'assistant' &&
                next.parentId === current.id
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
 * @deprecated 已废弃，直接使用 message.currentTurnsId 和 turns 过滤
 */
export function getCurrentIndex(messageContents: MessageContent[]): number {
    console.warn('getCurrentIndex 已废弃，请使用 message.currentTurnsId')
    if (!messageContents?.length) return 0
    const currentIndex = messageContents.findIndex(content => content.isCurrent)
    return currentIndex !== -1 ? currentIndex : 0
}

/**
 * 预处理消息内容：聚合工具调用和响应
 * 
 * 后端数据结构变更适配：
 * - 工具调用信息位于 assistant 消息的 metadata.toolCalls
 * - 工具响应作为独立的 tool 角色消息存在，通过 metadata.toolCallId 关联
 * 
 * 此函数将 tool 消息的响应内容聚合到对应的 assistant 消息的 additionalKwargs.toolCallsResponse 中
 * 
 * @param contents - 原始消息内容数组
 * @returns 经过预处理的消息内容数组（过滤掉 tool 角色，聚合到 assistant）
 */
function preprocessToolCalls(contents: MessageContent[]): MessageContent[] {
    if (!contents || contents.length === 0) {
        return contents
    }

    // 过滤掉无效的 content（null/undefined）
    const validContents = contents.filter(content => content != null)
    if (validContents.length === 0) {
        return []
    }

    // 分离 assistant 和 tool 消息
    const assistantContents: MessageContent[] = []
    const toolContents: MessageContent[] = []

    validContents.forEach(content => {
        if (content.role === 'tool') {
            toolContents.push(content)
        } else {
            assistantContents.push(content)
        }
    })

    // 如果没有 tool 消息，直接返回
    if (toolContents.length === 0) {
        return validContents
    }

    // 构建 toolCallId -> toolContent 的映射
    const toolResponseMap = new Map<string, MessageContent>()
    toolContents.forEach(toolContent => {
        const toolCallId = toolContent.metadata?.toolCallId
        if (toolCallId) {
            toolResponseMap.set(toolCallId, toolContent)
        }
    })

    // 处理每个 assistant 消息，聚合工具响应
    const processedContents = assistantContents.map(assistantContent => {
        // 从 metadata.toolCalls 获取工具调用列表
        const toolCalls = assistantContent.metadata?.toolCalls

        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return assistantContent
        }

        // 确保 additionalKwargs 存在
        if (!assistantContent.additionalKwargs) {
            assistantContent.additionalKwargs = {}
        }

        // 将 metadata.toolCalls 映射到 additionalKwargs.toolCalls（保持兼容性）
        assistantContent.additionalKwargs.toolCalls = toolCalls

        // 根据 toolCallId 聚合同步的工具响应
        const toolResponses: any[] = []
        toolCalls.forEach((toolCall: any) => {
            const toolCallId = toolCall.id
            if (toolCallId && toolResponseMap.has(toolCallId)) {
                const toolContent = toolResponseMap.get(toolCallId)!
                // 将 tool 消息的内容作为响应
                toolResponses.push({
                    content: toolContent.content,
                    ...toolContent.metadata
                })
            } else {
                // 没有对应的响应
                toolResponses.push(null)
            }
        })

        // 存储聚合后的工具响应
        assistantContent.additionalKwargs.toolCallsResponse = toolResponses

        return assistantContent
    })

    return processedContents
}

/**
 * 获取当前版本的内容数组
 * @param message - 消息对象
 * @returns 当前版本的内容数组（过滤后的 turns）
 */
export function getCurrentTurns(message: Message): MessageContent[] {
    if (!message?.contents) return []

    // 过滤掉无效的 content
    const validContents = message.contents.filter(content => content != null)
    if (validContents.length === 0) return []

    // 如果是 assistant 消息，根据 currentTurnsId 过滤
    if (message.role === 'assistant' && message.currentTurnsId) {
        const matchedContents = validContents.filter(
            content => content.turnsId === message.currentTurnsId
        )

        // 对过滤后的内容进行工具调用预处理
        return preprocessToolCalls(matchedContents)
    }

    // User 消息或没有 currentTurnsId 的情况：返回所有内容
    return preprocessToolCalls(validContents)
}

/**
 * 获取当前内容的版本号集合
 * @param message - 消息对象
 * @returns 所有唯一的 turnsId 集合
 */
export function getContentVersions(message: Message): string[] {
    if (!message?.contents) return []

    const versions = new Set<string>()
    message.contents.forEach(content => {
        if (content.turnsId) {
            versions.add(content.turnsId)
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

/**
 * 从消息内容中提取标题
 * @param message - 消息对象
 * @returns 提取的标题文本
 */
export function extractMessageTitle(message: Message): string {
    // 优先使用 metadata 中的 title 字段(如果后端提供)
    if (message.contents?.[0]?.metadata?.title) {
        return message.contents[0].metadata.title
    }

    // 从内容中提取第一行或前50字符
    const content = message.contents?.[0]?.content || ''
    if (!content) return '未命名消息'

    // 去除 Markdown 标记和空白
    const cleanContent = content
        .replace(/^#+\s+/gm, '')  // 移除标题标记
        .replace(/\*\*|__|\*|_/g, '')  // 移除加粗/斜体
        .split('\n')[0]  // 取第一行
        .trim()

    // 限制长度
    return cleanContent.length > 50
        ? cleanContent.substring(0, 47) + '...'
        : cleanContent || '未命名消息'
}
