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
  is_streaming: boolean
  is_thinking: boolean
}

interface MessageContent {
  id: string
  content: string | null
  reasoning_content: string | null
  turns_id: string
  additional_kwargs: any
  meta_data: Record<string, any>
  created_at: string
  updated_at: string
  thinking_started_at: number | null
  thinking_duration_ms: number | null
  state: ContentState
  _thinkingTimer?: ReturnType<typeof setInterval> | null
}

interface Message {
  id: string
  role: string
  contents: MessageContent[]
  parent_id: string
  current_turns_id: string
  state: ContentState
  created_at: string
  [key: string]: any
}

interface StreamResponse {
  type: string
  message_id?: string
  turns_id?: string
  content_id?: string
  model_name?: string
  msg?: string
  tool_calls?: any[]
  tool_calls_response?: any[]
  usage?: any
  finish_reason?: string
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
    const { message_id, turns_id, content_id, model_name } = response
    const time = new Date().toISOString()

    // 查找是否已存在该消息
    let existingMessage = sessionStore.getMessages(sessionId).find(
      (msg: Message) => msg.id === message_id
    )

    if (!existingMessage) {
      // 创建新消息 (使用 shallowReactive 减少响应式深度)
      existingMessage = reactive<Message>({
        id: message_id!,
        role: 'assistant',
        contents: [],
        parent_id: userMessageId,
        current_turns_id: turns_id!,
        state: {
          is_streaming: true,
          is_thinking: false
        },
        created_at: time
      })
      sessionStore.getMessages(sessionId).push(existingMessage)
    }

    existingMessage.current_turns_id = turns_id!

    // 创建新内容块
    const newContent = reactive<MessageContent>({
      id: content_id!,
      content: null,
      reasoning_content: null,
      turns_id: turns_id!,
      additional_kwargs: [],
      meta_data: { model_name },
      created_at: time,
      updated_at: time,
      thinking_started_at: null,
      thinking_duration_ms: null,
      state: {
        is_streaming: true,
        is_thinking: false
      }
    })

    existingMessage.contents.push(newContent)
    existingMessage.state = {
      is_streaming: true,
      is_thinking: false
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
    if (!content.state.is_thinking) {
      content.state.is_thinking = true
      content.thinking_started_at = Date.now()

      // 启动实时计时器，每 100ms 更新一次
      content._thinkingTimer = setInterval(() => {
        if (content.thinking_started_at) {
          content.thinking_duration_ms = Date.now() - content.thinking_started_at
        }
      }, 100)
    }

    content.reasoning_content = thinkingContent
  }

  /**
   * 处理思考结束
   */
  function handleThinkEnd(content: MessageContent): void {
    if (content.state.is_thinking) {
      content.state.is_thinking = false

      // 停止计时器并计算最终时长
      if (content._thinkingTimer) {
        clearInterval(content._thinkingTimer)
        content._thinkingTimer = null
      }

      if (content.thinking_started_at) {
        content.thinking_duration_ms = Date.now() - content.thinking_started_at
      }
    }
  }

  /**
   * 处理工具调用（增量更新）
   */
  function handleToolCall(content: MessageContent, toolCalls: any[]): void {
    // 初始化 additional_kwargs
    if (!content.additional_kwargs) {
      content.additional_kwargs = {}
    }
    if (!content.additional_kwargs.tool_calls) {
      content.additional_kwargs.tool_calls = []
    }

    // 累加增量的 tool_calls
    for (const toolCall of toolCalls) {
      const index = toolCall.index

      // 查找是否已存在该索引的工具调用
      let existingToolCall = content.additional_kwargs.tool_calls.find(
        (tc: any) => tc.index === index
      )

      if (!existingToolCall) {
        // 如果是新的工具调用，添加到列表
        content.additional_kwargs.tool_calls.push({
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
    if (!content.additional_kwargs) {
      content.additional_kwargs = {}
    }
    content.additional_kwargs.tool_calls_response = toolCallsResponse
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

    // 保存 usage 信息到 meta_data.usage
    if (response.usage) {
      content.meta_data = {
        ...content.meta_data,
        usage: response.usage
      }
    }

    // 保存 finish_reason
    if (response.finish_reason) {
      content.meta_data = {
        ...content.meta_data,
        finish_reason: response.finish_reason
      }
    }

    // 处理错误情况
    if (response.finish_reason === 'error') {
      console.error('Error in stream:', response.error)
      content.meta_data = {
        ...content.meta_data,
        error: response.error,
        finish_reason: response.finish_reason
      }
      content.state.is_streaming = false
      content.state.is_thinking = false
      return
    }

    // 正常结束，更新状态
    content.state.is_streaming = false
    content.state.is_thinking = false
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
      msgState.is_streaming = false
      msgState.is_thinking = false

      // 清理计时器，防止内存泄漏
      const content = message.contents[contentIndex]
      if (content?._thinkingTimer) {
        clearInterval(content._thinkingTimer)
        content._thinkingTimer = null
      }

      if (content && message) {
        content.updated_at = new Date().toISOString()
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
    // ✅ 修复：添加标志位，确保一次流式会话只更新一次时间戳
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
        // ✅ 修复：实时检测并保存 usage，不等待 finish 事件
        // 这样即使被取消或发生异常，已接收到的 usage 也不会丢失
        if (response.usage && message && contentIndex !== undefined) {
          const content = message.contents[contentIndex]
          content.meta_data = {
            ...content.meta_data,
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

          // ✅ 修复：仅在第一个 create 事件时更新时间戳，避免工具调用多轮次导致重复更新
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
        if (message?.contents[contentIndex]?.state.is_thinking && response.type !== 'think') {
          handleThinkEnd(message.contents[contentIndex])
        }

        // 处理工具调用（增量更新）
        if (response.type === 'tool_call') {
          handleToolCall(message!.contents[contentIndex], response.tool_calls)
          continue
        }

        // 处理工具调用结果（一次性接收）
        if (response.type === 'tool_calls_response') {
          handleToolCallsResponse(message!.contents[contentIndex], response.tool_calls_response)
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
