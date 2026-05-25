import { ref, type Ref } from "vue";
import { useSessionStore } from "@/stores/session";
import type { Session } from "@/types/session";

export function useSessionChat(
  sessionStore: ReturnType<typeof useSessionStore>,
  apiService: any,
) {
  const currentSessionId = ref<string | null>(null);
  const isLoading = ref(false);
  const hasGeneratedTitle = ref(false);

  /**
   * 加载会话配置和消息
   */
  async function loadSession(sessionId: string): Promise<Session> {
    const sessionData = await apiService.fetchSession(sessionId);
    await loadMessages(sessionId);
    return sessionData;
  }

  /**
   * 加载会话消息
   */
  async function loadMessages(sessionId: string) {
    const originalMessages = sessionStore.getMessages(sessionId);
    const streamingMessage = originalMessages.find(
      (message) => message.state?.isStreaming,
    );

    const sessionMessages = await apiService.fetchSessionMessages(sessionId);

    // 如果有正在流式输出的消息，需要保留本地状态
    // 避免从 API 重新加载后流式状态被重置导致显示异常
    if (streamingMessage) {
      const streamingIndex = sessionMessages.items.findIndex(
        (msg: any) => msg.id === streamingMessage.id,
      );
      if (streamingIndex >= 0) {
        sessionMessages.items[streamingIndex] = streamingMessage;
      }
    }

    // 处理历史消息的思考时长回填
    sessionMessages.items.forEach(
      (message: { id: string; contents: any[] }) => {
        if (message.contents && Array.isArray(message.contents)) {
          message.contents.forEach((content) => {
            if (content.meta_data?.thinking_duration_ms) {
              content.thinking_duration_ms =
                content.meta_data.thinking_duration_ms;
            }
          });
        }
      },
    );

    sessionStore.setMessages(sessionId, sessionMessages.items);
  }

  /**
   * 重置标题生成标记
   */
  function resetTitleFlag() {
    hasGeneratedTitle.value = false;
  }

  /**
   * 检查是否需要生成标题
   */
  async function generateTitleIfNeeded(
    sessionId: string,
    messages: any[],
    currentSession: Ref<Session | null>,
  ) {
    if (messages.length === 2 && !hasGeneratedTitle.value) {
      hasGeneratedTitle.value = true;

      try {
        const result = await apiService.generateSessionTitle(sessionId);
        if (!result.skipped && result.title && currentSession.value) {
          currentSession.value.title = result.title;
          sessionStore.updateSessionTitle(sessionId, result.title);
        }
      } catch (error) {
        console.error("生成会话标题失败:", error);
      }
    }
  }

  return {
    currentSessionId,
    isLoading,
    hasGeneratedTitle,
    loadSession,
    loadMessages,
    resetTitleFlag,
    generateTitleIfNeeded,
  };
}
