/**
 * 流式响应处理 Composable
 * 负责处理 SSE 流式响应的所有逻辑
 */

import { reactive, shallowReactive } from 'vue'

// 类型定义
interface StreamingState {
  isStreaming: boolean
  sessionId: string | null
  currentMessageId: string | null
}

interface ContentState {
  isStreaming: boolean
  isThinking: boolean
}

interface MessageContent {
  id: string
  content: string | null
  reasoningContent: string | null
  turnsId: string
  additionalKwargs: any
  metaData: Record<string, any>
  createdAt: string
  updatedAt: string
  thinkingStartedAt: number | null
  thinkingDurationMs: number | null
  state: ContentState
  _thinkingTimer?: ReturnType<typeof setInterval> | null
}

interface Message {
  id: string
  role: string
  contents: MessageContent[]
  parentId: string
  currentTurnsId: string
  state: ContentState
  createdAt: string
  [key: string]: any
}

interface StreamResponse {
  type: string
  messageId?: string
  turnsId?: string
  contentId?: string
  modelName?: string
  msg?: string
  toolCalls?: any[]
  toolCallsResponse?: any[]
  usage?: any
  finishReason?: string
  error?: string
}

export function useStreamResponse(sessionStore: any, apiService: any) {
  // 流式响应状态
  const streamingState = reactive<StreamingState>({
    isStreaming: false,
    sessionId: null,
    currentMessageId: null
  })

  /**
   * 处理新消息创建
   */
  function handleNewMessage(
    response: StreamResponse,
    sessionId: string,
    userMessageId: string
  ): { message: Message; contentIndex: number } {
    const { messageId, turnsId, contentId, modelName } = response
    const time = new Date().toISOString()

    // 查找是否已存在该消息
    let existingMessage = sessionStore.getMessages(sessionId).find(
      (msg: Message) => msg.id === messageId
    )

    if (!existingMessage) {
      // 创建新消息 (使用 shallowReactive 减少响应式深度)
      existingMessage = reactive<Message>({
        id: messageId!,
        role: 'assistant',
        contents: [],
        parentId: userMessageId,
        sessionId,
        currentTurnsId: turnsId!,
        state: {
          isStreaming: true,
          isThinking: false
        },
        createdAt: time
      })
      sessionStore.getMessages(sessionId).push(existingMessage)
    }

    existingMessage.currentTurnsId = turnsId!

    // 创建新内容块
    const newContent = reactive<MessageContent>({
      id: contentId!,
      content: null,
      reasoningContent: null,
      turnsId: turnsId!,
      additionalKwargs: [],
      metaData: { modelName },
      createdAt: time,
      updatedAt: time,
      thinkingStartedAt: null,
      thinkingDurationMs: null,
      state: {
        isStreaming: true,
        isThinking: false
      }
    })

    existingMessage.contents.push(newContent)
    existingMessage.state = {
      isStreaming: true,
      isThinking: false
    }

    return {
      message: existingMessage,
      contentIndex: existingMessage.contents.length - 1
    }
  }

  /**
   * 处理思考事件
   */
  function handleThink(content: MessageContent, thinkingContent: string): void {
    // 首次收到 think 事件，记录开始时间并启动计时器
    if (!content.state.isThinking) {
      content.state.isThinking = true
      content.thinkingStartedAt = Date.now()

      // 启动实时计时器，每 100ms 更新一次
      content._thinkingTimer = setInterval(() => {
        if (content.thinkingStartedAt) {
          content.thinkingDurationMs = Date.now() - content.thinkingStartedAt
        }
      }, 100)
    }

    content.reasoningContent = thinkingContent
  }

  /**
   * 处理思考结束
   */
  function handleThinkEnd(content: MessageContent): void {
    if (content.state.isThinking) {
      content.state.isThinking = false

      // 停止计时器并计算最终时长
      if (content._thinkingTimer) {
        clearInterval(content._thinkingTimer)
        content._thinkingTimer = null
      }

      if (content.thinkingStartedAt) {
        content.thinkingDurationMs = Date.now() - content.thinkingStartedAt
      }
    }
  }

  /**
   * 处理工具调用（增量更新）
   */
  function handleToolCall(content: MessageContent, toolCalls: any[]): void {
    // 初始化 additionalKwargs
    if (!content.additionalKwargs) {
      content.additionalKwargs = {}
    }
    if (!content.additionalKwargs.toolCalls) {
      content.additionalKwargs.toolCalls = []
    }

    // 累加增量的 toolCalls
    for (const toolCall of toolCalls) {
      const index = toolCall.index

      // 查找是否已存在该索引的工具调用
      let existingToolCall = content.additionalKwargs.toolCalls.find(
        (tc: any) => tc.index === index
      )

      if (!existingToolCall) {
        // 如果是新的工具调用，添加到列表
        content.additionalKwargs.toolCalls.push({
          id: toolCall.id,
          index: toolCall.index,
          type: toolCall.type,
          name: toolCall.name,
          arguments: toolCall.arguments || ''
        })
      } else {
        // 如果已存在，累加参数字符串
        if (toolCall.arguments !== null && toolCall.arguments !== undefined) {
          existingToolCall.arguments += toolCall.arguments
        }
      }
    }
  }

  /**
   * 处理工具调用响应
   */
  function handleToolCallsResponse(content: MessageContent, toolCallsResponse: any[]): void {
    if (!content.additionalKwargs) {
      content.additionalKwargs = {}
    }
    content.additionalKwargs.toolCallsResponse = toolCallsResponse
  }

  /**
   * 处理文本内容
   */
  function handleText(content: MessageContent, responseContent: string): void {
    content.content = responseContent
  }

  /**
   * 处理流式完成事件
   */
  function handleStreamFinish(
    response: StreamResponse,
    message: Message | null,
    contentIndex: number | undefined,
    assistantMessageId: string | null
  ): void {
    if (!message || contentIndex === undefined) {
      return
    }

    const content = message.contents[contentIndex]

    // 保存 usage 信息到 metaData.usage
    if (response.usage) {
      content.metaData = {
        ...content.metaData,
        usage: response.usage
      }
    }

    // 保存 finishReason
    if (response.finishReason) {
      content.metaData = {
        ...content.metaData,
        finishReason: response.finishReason
      }
    }

    // 处理错误情况
    if (response.finishReason === 'error') {
      console.error('Error in stream:', response.error)
      content.metaData = {
        ...content.metaData,
        error: response.error,
        finishReason: response.finishReason
      }
      content.state.isStreaming = false
      content.state.isThinking = false
      return
    }

    // 正常结束，更新状态
    content.state.isStreaming = false
    content.state.isThinking = false
  }

  /**
   * 处理流式响应错误
   */
  function handleStreamCatchError(
    error: Error,
    message: Message | null,
    contentIndex: number | undefined,
    assistantMessageId: string | null
  ): void {
    if (error.name !== 'AbortError') {
      console.error('Error during streaming:', error)
      if (message && contentIndex !== undefined) {
        message.contents[contentIndex].content = error.message
      }
      if (!assistantMessageId) {
        // 这里不直接调用 notify，由调用者处理
        throw error
      }
    }
  }

  /**
   * 清理流式响应状态
   */
  function cleanupStreaming(
    sessionId: string,
    message: Message | null,
    contentIndex: number
  ): void {
    streamingState.isStreaming = false
    streamingState.sessionId = null
    streamingState.currentMessageId = null

    if (message) {
      const msgState = message.state;
      msgState.isStreaming = false
      msgState.isThinking = false

      // 清理计时器，防止内存泄漏
      const content = message.contents[contentIndex]
      if (content?._thinkingTimer) {
        clearInterval(content._thinkingTimer)
        content._thinkingTimer = null
      }

      if (content && message) {
        content.updatedAt = new Date().toISOString()
      }
    }

    sessionStore.setSessionIsStreaming(sessionId, false)
  }

  /**
   * 处理完整的流式响应
   */
  async function processStream(
    streamingSessionId: string,
    userMessageId: string,
    regenerationMode: 'regenerate' | null = null,
    assistantMessageId: string | null = null
  ): Promise<void> {
    sessionStore.setSessionIsStreaming(streamingSessionId, true)
    streamingState.isStreaming = true
    streamingState.sessionId = streamingSessionId

    let message: Message | null = null
    let contentIndex = 0
    let assistantMessageIdResult: string | null = null
    // 修复：添加标志位，确保一次流式会话只更新一次时间戳
    let hasUpdatedActiveTime = false

    try {
      let responseContent = ''
      let thinkingContent = ''

      for await (const response of apiService.chat(
        streamingSessionId,
        userMessageId,
        regenerationMode,
        assistantMessageId
      )) {
        // 修复：实时检测并保存 usage，不等待 finish 事件
        // 这样即使被取消或发生异常，已接收到的 usage 也不会丢失
        if (response.usage && message && contentIndex !== undefined) {
          const content = message.contents[contentIndex]
          content.metaData = {
            ...content.metaData,
            usage: response.usage
          }
        }

        if (response.type === 'finish') {
          handleStreamFinish(response, message, contentIndex, assistantMessageIdResult)
          responseContent = ''
          thinkingContent = ''
          continue
        }

        if (response.type === 'create') {
          const result = handleNewMessage(response, streamingSessionId, userMessageId)
          message = result.message
          contentIndex = result.contentIndex
          assistantMessageIdResult = response.message_id!

          // 修复：仅在第一个 create 事件时更新时间戳，避免工具调用多轮次导致重复更新
          if (!hasUpdatedActiveTime) {
            sessionStore.updateSessionLastActiveTime(streamingSessionId, new Date().toISOString())
            hasUpdatedActiveTime = true
          }

          continue
        }

        if (response.type === 'think') {
          thinkingContent += response.msg
          if (message) handleThink(message.contents[contentIndex], thinkingContent)
          continue
        }

        // 思考结束后重置状态
        if (message?.contents[contentIndex]?.state.isThinking && response.type !== 'think') {
          handleThinkEnd(message.contents[contentIndex])
        }

        // 处理工具调用（增量更新）
        if (response.type === 'tool_call') {
          handleToolCall(message!.contents[contentIndex], response.toolCalls)  // 驼峰式
          continue
        }

        // 处理工具调用结果（一次性接收）
        if (response.type === 'tool_calls_response') {
          handleToolCallsResponse(message!.contents[contentIndex], response.toolCallsResponse)  // 驼峰式
          continue
        }

        // 处理文本内容
        if (response.type === 'text') {
          responseContent = responseContent + response.msg
          handleText(message!.contents[contentIndex], responseContent)
          continue
        }
      }
    } catch (error) {
      handleStreamCatchError(error as Error, message, contentIndex, assistantMessageIdResult)
      throw error // 重新抛出错误，由调用者处理
    } finally {
      cleanupStreaming(streamingSessionId, message, contentIndex)
    }
  }

  return {
    streamingState,
    processStream,
  }
}
