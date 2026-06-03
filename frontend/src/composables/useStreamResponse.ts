/**
 * 流式响应处理 Composable
 * 负责处理 SSE 流式响应的所有逻辑
 */

import { reactive, shallowReactive } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { usePopup } from "@/composables/usePopup";

// 类型定义
interface StreamingState {
  isStreaming: boolean;
  sessionId: string | null;
  currentMessageId: string | null;
}

interface ContentState {
  isStreaming: boolean;
  isThinking: boolean;
}

interface MessageContent {
  id: string;
  role: string;
  content: string | null;
  reasoningContent: string | null;
  turnsId: string;
  additionalKwargs: any;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  thinkingStartedAt: number | null;
  thinkingDurationMs: number | null;
  state: ContentState;
  _thinkingTimer?: ReturnType<typeof setInterval> | null;
}

interface Message {
  id: string;
  role: string;
  contents: MessageContent[];
  parentId: string;
  currentTurnsId: string;
  state: ContentState;
  createdAt: string;
  [key: string]: any;
}

interface StreamResponse {
  type: string;
  messageId?: string;
  turnsId?: string;
  contentId?: string;
  modelName?: string;
  msg?: string;
  toolCalls?: any[];
  toolCallsResponse?: any[];
  usage?: any;
  finishReason?: string;
  error?: string;
  parentId?: string;
}

export function useStreamResponse(sessionStore: any, apiService: any) {
  const { toast } = usePopup();

  // ============================================
  // 内容缓冲与防抖 flush 机制
  // 将消抖从 MarkdownContent 组件迁移到数据层
  // 注意：content 是顺序出现的，一个完整结束后才会开始下一个，
  // 因此全局只需一个缓冲区和防抖函数即可
  // ============================================
  interface ContentBuffer {
    content: string;
    reasoningContent: string;
  }

  // 当前内容缓冲区（全局只有一个，因为 content 不会交错）
  let contentBuffer: ContentBuffer | null = null;
  let currentBufferContentId: string | null = null;

  // 全局防抖 flush 函数
  const debouncedFlush = useDebounceFn(
    (message: Message, contentIndex: number) => {
      flushContent(message, contentIndex);
    },
    50,
  );

  /**
   * 将缓冲区的内容 flush 到响应式数据中
   */
  function flushContent(message: Message, contentIndex: number) {
    if (!contentBuffer || !message) return;

    const content = message.contents[contentIndex];
    if (!content) return;

    content.content = contentBuffer.content;
    content.reasoningContent = contentBuffer.reasoningContent;
  }

  /**
   * 强制 flush 并清理缓冲区（流结束时调用）
   */
  function forceFlushContent(message: Message, contentIndex: number) {
    flushContent(message, contentIndex);
    clearContentBuffer();
  }

  /**
   * 清理缓冲区
   */
  function clearContentBuffer() {
    contentBuffer = null;
    currentBufferContentId = null;
  }

  /**
   * 处理新消息创建
   */
  function handleNewMessage(
    response: StreamResponse,
    sessionId: string,
  ): { message: Message; contentIndex: number } {
    const { messageId, turnsId, contentId, modelName } = response;
    const time = new Date().toISOString();

    // 创建新内容块
    const newContent = reactive<MessageContent>({
      id: contentId!,
      role: "assistant",
      content: null,
      reasoningContent: null,
      turnsId: turnsId!,
      additionalKwargs: [],
      metadata: { modelName },
      createdAt: time,
      updatedAt: time,
      thinkingStartedAt: null,
      thinkingDurationMs: null,
      state: {
        isStreaming: true,
        isThinking: false,
      },
    });

    // 查找是否已存在该消息
    let existingMessage = sessionStore
      .getMessages(sessionId)
      .find((msg: Message) => msg.id === messageId);

    if (!existingMessage) {
      // 创建新消息 (使用 shallowReactive 减少响应式深度)
      existingMessage = reactive<Message>({
        id: messageId!,
        role: "assistant",
        contents: [newContent],
        parentId: response.parentId || "",
        sessionId,
        currentTurnsId: turnsId!,
        state: {
          isStreaming: true,
          isThinking: false,
        },
        createdAt: time,
      });
      sessionStore.getMessages(sessionId).push(existingMessage);
    } else {
      console.log("Message already exists, pushing new content");
      existingMessage.contents.push(newContent);
      existingMessage.currentTurnsId = turnsId!;
      existingMessage.state = {
        isStreaming: true,
        isThinking: false,
      };
    }

    return {
      message: existingMessage,
      contentIndex: existingMessage.contents.length - 1,
    };
  }

  /**
   * 处理 update 事件（断点恢复模式）
   * 复用已有消息和内容块，更新流式状态
   */
  function handleUpdateMessage(
    response: StreamResponse,
    streamingSessionId: string,
  ): { message: Message; contentIndex: number } | null {
    const existingMessage = sessionStore
      .getMessages(streamingSessionId)
      .find((msg: Message) => msg.id === response.messageId);

    if (!existingMessage) {
      console.error("Message not found:", response.messageId);
      throw new Error("Message not found");
    }

    // 查找对应的内容块
    const existingContentIndex = existingMessage.contents.findIndex(
      (c: MessageContent) => c.id === response.contentId,
    );

    if (existingContentIndex < 0) {
      console.error("Content not found:", response.contentId);
      throw new Error("Content not found");
    }

    // 更新消息状态为流式中
    existingMessage.state = {
      isStreaming: true,
      isThinking: false,
    };

    return {
      message: existingMessage,
      contentIndex: existingContentIndex,
    };
  }

  /**
   * 处理思考事件
   */
  function handleThink(
    content: MessageContent,
    thinkingContent: string,
    message: Message,
    contentIndex: number,
  ): void {
    // 首次收到 think 事件，记录开始时间并启动计时器
    if (!content.state.isThinking) {
      content.state.isThinking = true;
      content.thinkingStartedAt = Date.now();

      // 启动实时计时器，每 100ms 更新一次
      content._thinkingTimer = setInterval(() => {
        if (content.thinkingStartedAt) {
          content.thinkingDurationMs = Date.now() - content.thinkingStartedAt;
        }
      }, 100);
    }

    // 流式期间：写入缓冲区，通过防抖 flush 更新
    if (!contentBuffer || currentBufferContentId !== content.id) {
      contentBuffer = {
        content: content.content || "",
        reasoningContent: "",
      };
      currentBufferContentId = content.id;
    }
    contentBuffer.reasoningContent = thinkingContent;
    debouncedFlush(message, contentIndex);
  }

  /**
   * 处理思考结束
   */
  function handleThinkEnd(content: MessageContent): void {
    if (content.state.isThinking) {
      content.state.isThinking = false;

      // 停止计时器并计算最终时长
      if (content._thinkingTimer) {
        clearInterval(content._thinkingTimer);
        content._thinkingTimer = null;
      }

      if (content.thinkingStartedAt) {
        content.thinkingDurationMs = Date.now() - content.thinkingStartedAt;
      }
    }
  }

  /**
   * 处理工具调用（增量更新）
   */
  function handleToolCall(
    content: MessageContent,
    toolCalls: any[],
    displayMessages?: any[],
  ): void {
    // 初始化 metadata
    if (!content.metadata) {
      content.metadata = {};
    }
    if (!content.metadata.toolCalls) {
      content.metadata.toolCalls = [];
    }

    // 累加增量的 toolCalls
    for (const toolCall of toolCalls) {
      const index = toolCall.index;

      // 查找是否已存在该索引的工具调用
      let existingToolCall = content.metadata.toolCalls.find(
        (tc: any) => tc.index === index,
      );

      if (!existingToolCall) {
        // 如果是新的工具调用，添加到列表
        // 需要找到 toolCall 在 toolCalls 数组中的局部索引
        const localIndex = toolCalls.findIndex((tc) => tc.index === index);
        const displayMessage = displayMessages?.[localIndex] || null;

        content.metadata.toolCalls.push({
          id: toolCall.id,
          index: toolCall.index,
          type: toolCall.type,
          name: toolCall.name,
          arguments: toolCall.arguments || "",
          metadata: {
            displayMessage: displayMessage, // 存储结构化的展示信息到 metadata
          },
        });
      } else {
        // 如果已存在，累加参数字符串
        if (toolCall.arguments !== null && toolCall.arguments !== undefined) {
          existingToolCall.arguments += toolCall.arguments;
        }
        // 更新展示文案（如果提供）
        if (displayMessages?.[index]) {
          // 确保 metadata 存在
          if (!existingToolCall.metadata) {
            existingToolCall.metadata = {};
          }
          existingToolCall.metadata.displayMessage = displayMessages[index];
        } else if (displayMessages) {
          // displayMessages 数组可能只包含当前 chunk 中的工具
          // 需要找到 toolCall 在 toolCalls 数组中的局部索引
          const localIndex = toolCalls.findIndex((tc) => tc.index === index);
          if (localIndex !== -1 && displayMessages[localIndex]) {
            if (!existingToolCall.metadata) {
              existingToolCall.metadata = {};
            }
            existingToolCall.metadata.displayMessage =
              displayMessages[localIndex];
          }
        }
      }
    }
  }

  /**
   * 处理工具调用响应
   */
  function handleToolCallsResponse(
    content: MessageContent,
    toolCallsResponse: any[],
    displayMessages?: any[],
  ): void {
    if (!content.metadata) {
      content.metadata = {};
    }
    content.metadata.toolCallsResponse = toolCallsResponse;

    // 更新展示文案为完成状态
    if (displayMessages && content.metadata.toolCalls) {
      for (let i = 0; i < content.metadata.toolCalls.length; i++) {
        if (displayMessages[i]) {
          // 确保 metadata 存在
          if (!content.metadata.toolCalls[i].metadata) {
            content.metadata.toolCalls[i].metadata = {};
          }
          content.metadata.toolCalls[i].metadata.displayMessage =
            displayMessages[i];
        }
      }
    }
  }

  /**
   * 处理文本内容
   */
  function handleText(
    content: MessageContent,
    responseContent: string,
    message: Message,
    contentIndex: number,
  ): void {
    // 流式期间：写入缓冲区，通过防抖 flush 更新
    if (!contentBuffer || currentBufferContentId !== content.id) {
      contentBuffer = {
        content: "",
        reasoningContent: content.reasoningContent || "",
      };
      currentBufferContentId = content.id;
    }
    contentBuffer.content = responseContent;
    debouncedFlush(message, contentIndex);
  }

  /**
   * 处理流式完成事件
   */
  function handleStreamFinish(
    response: StreamResponse,
    message: Message | null,
    contentIndex: number | undefined,
    assistantMessageId: string | null,
  ): void {
    if (!message || contentIndex === undefined) {
      return;
    }

    const content = message.contents[contentIndex];

    // 保存 usage 信息到 metadata.usage
    if (response.usage) {
      content.metadata = {
        ...content.metadata,
        usage: response.usage,
      };
    }

    // 保存 finishReason
    if (response.finishReason) {
      content.metadata = {
        ...content.metadata,
        finishReason: response.finishReason,
      };
    }

    // 处理错误情况
    if (response.finishReason === "error") {
      console.error("Error in stream:", response.error);
      content.metadata = {
        ...content.metadata,
        error: response.error,
        finishReason: response.finishReason,
      };
      // 错误时也要强制 flush，确保内容同步
      forceFlushContent(message, contentIndex);
      content.state.isStreaming = false;
      content.state.isThinking = false;
      return;
    }

    // 正常结束，强制 flush 缓冲区内容并清理
    forceFlushContent(message, contentIndex);

    // 更新状态
    content.state.isStreaming = false;
    content.state.isThinking = false;
  }

  /**
   * 处理流式响应错误
   */
  function handleStreamCatchError(
    error: Error,
    message: Message | null,
    contentIndex: number | undefined,
    assistantMessageId: string | null,
  ): void {
    if (error.name !== "AbortError") {
      console.error("Error during streaming:", error);
      if (message && contentIndex !== undefined) {
        message.contents[contentIndex].content = error.message;
      }
      if (!assistantMessageId) {
        // 这里不直接调用 notify，由调用者处理
        throw error;
      }
    }
  }

  /**
   * 清理流式响应状态
   */
  function cleanupStreaming(
    sessionId: string,
    message: Message | null,
    contentIndex: number,
  ): void {
    if (message) {
      const msgState = message.state;
      msgState.isStreaming = false;
      msgState.isThinking = false;

      // 清理计时器，防止内存泄漏
      const content = message.contents[contentIndex];
      if (content?._thinkingTimer) {
        clearInterval(content._thinkingTimer);
        content._thinkingTimer = null;
      }

      // 强制 flush 并清理缓冲区
      if (content) {
        forceFlushContent(message, contentIndex);
      }

      content.state.isStreaming = false;
      content.state.isThinking = false;

      if (content && message) {
        content.updatedAt = new Date().toISOString();
      }
    }

    sessionStore.setSessionIsStreaming(sessionId, false);
  }

  /**
   * 处理流式事件循环（所有流式场景共用）
   */
  async function processStreamLoop(
    streamingSessionId: string,
    regenerationMode: "regenerate" | "resume" | "subscribe" | null,
    assistantMessageId: string | null,
    userMessage?: {
      id?: string;
      content?: string;
      files?: string[];
      replaceMessageId?: string;
      knowledgeBaseIds?: string[];
    },
    lastContentId?: string | null,
  ): Promise<void> {
    sessionStore.setSessionIsStreaming(streamingSessionId, true);

    let message: Message | null = null;
    let contentIndex = 0;
    let assistantMessageIdResult: string | null = null;
    // 修复：添加标志位，确保一次流式会话只更新一次时间戳
    let hasUpdatedActiveTime = false;

    try {
      let responseContent = "";
      let thinkingContent = "";

      const chatParams: any = {
        sessionId: streamingSessionId,
        regenerationMode,
        assistantMessageId,
        lastContentId,
      };
      if (userMessage) {
        chatParams.userMessage = userMessage;
      }

      for await (const response of apiService.chat(chatParams)) {
        // 修复：实时检测并保存 usage，不等待 finish 事件
        // 这样即使被取消或发生异常，已接收到的 usage 也不会丢失
        if (response.usage && message && contentIndex !== undefined) {
          const content = message.contents[contentIndex];
          content.metadata = {
            ...content.metadata,
            usage: response.usage,
          };
        }

        if (response.type === "finish") {
          handleStreamFinish(
            response,
            message,
            contentIndex,
            assistantMessageIdResult,
          );
          responseContent = "";
          thinkingContent = "";
          continue;
        }

        if (response.type === "user_message") {
          // 后端广播的用户消息，添加到消息列表
          const userMsg = response.message;
          if (userMsg) {
            // 避免重复添加已存在的消息
            const exists = sessionStore
              .getMessages(streamingSessionId)
              .some((msg: Message) => msg.id === userMsg.id);
            if (!exists) {
              sessionStore.addMessage(streamingSessionId, userMsg);
            }
          }
          continue;
        }

        if (response.type === "create") {
          const result = handleNewMessage(response, streamingSessionId);
          message = result.message;
          contentIndex = result.contentIndex;
          assistantMessageIdResult = response.messageId!;

          // 修复：仅在第一个 create 事件时更新时间戳，避免工具调用多轮次导致重复更新
          if (!hasUpdatedActiveTime) {
            sessionStore.updateSessionLastActiveTime(
              streamingSessionId,
              new Date().toISOString(),
            );
            hasUpdatedActiveTime = true;
          }

          continue;
        }

        // 【断点恢复】处理 update 事件（resume 模式下更新已有消息）
        if (response.type === "update") {
          const result = handleUpdateMessage(response, streamingSessionId);
          if (result) {
            message = result.message;
            contentIndex = result.contentIndex;
            assistantMessageIdResult = response.messageId!;

            if (!hasUpdatedActiveTime) {
              sessionStore.updateSessionLastActiveTime(
                streamingSessionId,
                new Date().toISOString(),
              );
              hasUpdatedActiveTime = true;
            }
          }
          continue;
        }

        if (response.type === "think") {
          thinkingContent += response.msg;
          if (message)
            handleThink(
              message.contents[contentIndex],
              thinkingContent,
              message,
              contentIndex,
            );
          continue;
        }

        // 思考结束后重置状态
        if (
          message?.contents[contentIndex]?.state.isThinking &&
          response.type !== "think"
        ) {
          handleThinkEnd(message.contents[contentIndex]);
        }

        // 处理工具调用（增量更新）
        if (response.type === "tool_call") {
          handleToolCall(
            message!.contents[contentIndex],
            response.toolCalls,
            response.displayMessages,
          ); // 驼峰式
          continue;
        }

        // 处理工具调用结果（一次性接收）
        if (response.type === "tool_calls_response") {
          handleToolCallsResponse(
            message!.contents[contentIndex],
            response.toolCallsResponse,
            response.displayMessages,
          ); // 驼峰式
          continue;
        }

        // 处理文本内容
        if (response.type === "text") {
          responseContent = responseContent + response.msg;
          handleText(
            message!.contents[contentIndex],
            responseContent,
            message!,
            contentIndex,
          );
          continue;
        }

        // 处理压缩开始事件
        if (response.type === "compression_start") {
          sessionStore.setSessionIsCompressing(streamingSessionId, true);
          toast.info(response.msg || "正在优化对话历史...");
          continue;
        }

        // 处理压缩错误事件
        if (response.type === "compression_error") {
          sessionStore.setSessionIsCompressing(streamingSessionId, false);
          toast.error(response.msg || "自动压缩失败");
          continue;
        }
      }
    } catch (error) {
      handleStreamCatchError(
        error as Error,
        message,
        contentIndex,
        assistantMessageIdResult,
      );
      // 如果是会话忙碌错误，不抛出异常，由调用者处理通知
      if ((error as Error).message.includes("SessionBusyError")) {
        return;
      }
      throw error; // 重新抛出错误，由调用者处理
    } finally {
      cleanupStreaming(streamingSessionId, message, contentIndex);
    }
  }

  /**
   * 处理完整的流式响应（用于 regenerate / continue / subscribe 等场景）
   *
   * 与 processStreamWithCreate 的区别：
   * - 不创建新消息，只接收已有流的广播事件
   * - subscribe 模式下如果无活跃流，后端返回 NO_ACTIVE_STREAM 错误
   */
  async function processStream(
    streamingSessionId: string,
    regenerationMode: "regenerate" | "resume" | "subscribe" | null = null,
    assistantMessageId: string | null = null,
    userMessageId?: string | null,
    lastContentId?: string | null,
  ): Promise<void> {
    const userMessage = userMessageId ? { id: userMessageId } : undefined;
    await processStreamLoop(
      streamingSessionId,
      regenerationMode,
      assistantMessageId,
      userMessage,
      lastContentId,
    );
  }

  /**
   * 处理完整的流式响应（合并消息创建和流式启动）
   *
   * 后端会在启动流时自动创建消息，实现原子性。
   */
  async function processStreamWithCreate(
    streamingSessionId: string,
    content: string,
    fileIds: string[],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[],
  ): Promise<void> {
    await processStreamLoop(streamingSessionId, null, null, {
      content,
      files: fileIds,
      replaceMessageId: replaceMessageId || undefined,
      knowledgeBaseIds,
    });
  }

  return {
    processStream,
    processStreamWithCreate,
  };
}
