/**
 * 流式响应处理 Composable
 * 负责处理 SSE 流式响应的所有逻辑
 */

import { reactive, shallowReactive } from 'vue'

export function useStreamResponse(sessionStore, apiService) {
  // 流式响应状态
  const streamingState = reactive({
    isStreaming: false,
    sessionId: null,
    currentMessageId: null
  })

  /**
   * 处理新消息创建
   * @param {Object} response - 流式响应数据
   * @param {string} sessionId - 会话 ID
   * @param {string} userMessageId - 用户消息 ID
   * @returns {Object} { message, contentIndex }
   */
  function handleNewMessage(response, sessionId, userMessageId) {
    const { message_id, turns_id, content_id, model_name } = response
    const time = new Date().toISOString()

    // 查找是否已存在该消息
    let existingMessage = sessionStore.getMessages(sessionId).find(
      msg => msg.id === message_id
    )

    if (!existingMessage) {
      // 创建新消息 (使用 shallowReactive 减少响应式深度)
      existingMessage = reactive({
        id: message_id,
        role: 'assistant',
        contents: [],
        parent_id: userMessageId,
        current_turns_id: turns_id,
        state: {
          is_streaming: true
        },
        created_at: time
      })
      sessionStore.getMessages(sessionId).push(existingMessage)
    }

    existingMessage.current_turns_id = turns_id

    // 创建新内容块
    const newContent = reactive({
      id: content_id,
      content: null,
      reasoning_content: null,
      turns_id: turns_id,
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
      is_streaming: true
    }

    return {
      message: existingMessage,
      contentIndex: existingMessage.contents.length - 1
    }
  }

  /**
   * 处理思考事件
   * @param {Object} content - 内容块
   * @param {string} thinkingContent - 思考内容
   */
  function handleThink(content, thinkingContent) {
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
   * @param {Object} content - 内容块
   */
  function handleThinkEnd(content) {
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
   * @param {Object} content - 内容块
   * @param {Array} toolCalls - 工具调用列表
   */
  function handleToolCall(content, toolCalls) {
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
        tc => tc.index === index
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
   * @param {Object} content - 内容块
   * @param {Array} toolCallsResponse - 工具调用响应列表
   */
  function handleToolCallsResponse(content, toolCallsResponse) {
    if (!content.additional_kwargs) {
      content.additional_kwargs = {}
    }
    content.additional_kwargs.tool_calls_response = toolCallsResponse
  }

  /**
   * 处理文本内容
   * @param {Object} content - 内容块
   * @param {string} responseContent - 文本内容
   */
  function handleText(content, responseContent) {
    content.content = responseContent
  }

  /**
   * 处理流式完成事件
   * @param {Object} response - 完成响应数据
   * @param {Object} message - 消息对象
   * @param {number} contentIndex - 内容索引
   * @param {string} assistantMessageId - 助手消息 ID
   */
  function handleStreamFinish(response, message, contentIndex, assistantMessageId) {
    if (!message || contentIndex === undefined) {
      return
    }

    const content = message.contents[contentIndex]

    // 保存 usage 信息到 meta_data.usage
    if (response.usage) {
      content.meta_data = {
        ...content.meta_data,
        usage: response.usage  // ✅ 修复：将 usage 保存在 meta_data.usage 中
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
   * @param {Error} error - 错误对象
   * @param {Object} message - 消息对象
   * @param {number} contentIndex - 内容索引
   * @param {string} assistantMessageId - 助手消息 ID
   */
  function handleStreamCatchError(error, message, contentIndex, assistantMessageId) {
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
   * @param {string} sessionId - 会话 ID
   * @param {Object} message - 消息对象
   * @param {number} contentIndex - 内容索引
   */
  function cleanupStreaming(sessionId, message, contentIndex) {
    streamingState.isStreaming = false
    streamingState.sessionId = null
    streamingState.currentMessageId = null

    if (message) {
      message.state.is_streaming = false
      message.state.is_thinking = false

      // 清理计时器，防止内存泄漏
      const content = message.contents[contentIndex]
      if (content?._thinkingTimer) {
        clearInterval(content._thinkingTimer)
        content._thinkingTimer = null
      }

      if (content) {
        content.updated_at = new Date().toISOString()
      }
    }

    sessionStore.setSessionIsStreaming(sessionId, false)
  }

  /**
   * 处理完整的流式响应
   * @param {string} streamingSessionId - 会话 ID
   * @param {string} userMessageId - 用户消息 ID
   * @param {'regenerate'|null} regenerationMode - 重新生成模式
   * @param {string|null} assistantMessageId - 助手消息 ID
   */
  async function processStream(streamingSessionId, userMessageId, regenerationMode = null, assistantMessageId = null) {
    sessionStore.setSessionIsStreaming(streamingSessionId, true)
    streamingState.isStreaming = true
    streamingState.sessionId = streamingSessionId

    let message = null
    let contentIndex = 0
    let assistantMessageIdResult = null
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
            usage: response.usage  // ✅ 实时更新 usage
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
          assistantMessageIdResult = response.message_id
          
          // ✅ 修复：仅在第一个 create 事件时更新时间戳，避免工具调用多轮次导致重复更新
          if (!hasUpdatedActiveTime) {
            sessionStore.updateSessionLastActiveTime(streamingSessionId, new Date().toISOString())
            hasUpdatedActiveTime = true
          }
          
          continue
        }

        if (response.type === 'think') {
          thinkingContent += response.msg
          handleThink(message.contents[contentIndex], thinkingContent)
          continue
        }

        // 思考结束后重置状态
        if (message.contents[contentIndex]?.state.is_thinking && response.type !== 'think') {
          handleThinkEnd(message.contents[contentIndex])
        }

        // 处理工具调用（增量更新）
        if (response.type === 'tool_call') {
          handleToolCall(message.contents[contentIndex], response.tool_calls)
          continue
        }

        // 处理工具调用结果（一次性接收）
        if (response.type === 'tool_calls_response') {
          handleToolCallsResponse(message.contents[contentIndex], response.tool_calls_response)
          continue
        }

        // 处理文本内容
        if (response.type === 'text') {
          responseContent = responseContent + response.msg
          handleText(message.contents[contentIndex], responseContent)
          continue
        }
      }
    } catch (error) {
      handleStreamCatchError(error, message, contentIndex, assistantMessageIdResult)
      throw error // 重新抛出错误，由调用者处理
    } finally {
      cleanupStreaming(streamingSessionId, message, contentIndex)
    }
  }

  return {
    streamingState,
    processStream,
    handleNewMessage,
    handleThink,
    handleThinkEnd,
    handleToolCall,
    handleToolCallsResponse,
    handleText,
    handleStreamFinish,
    handleStreamCatchError,
    cleanupStreaming
  }
}
