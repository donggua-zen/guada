import { ref, type Ref } from "vue";
import { useSessionStore } from "@/stores/session";
import type { Session } from "@/types/session";

export function useSessionChat(
  sessionStore: ReturnType<typeof useSessionStore>,
  apiService: any,
) {

  const hasGeneratedTitle = ref(false);

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
    hasGeneratedTitle,
    resetTitleFlag,
    generateTitleIfNeeded,
  };
}
