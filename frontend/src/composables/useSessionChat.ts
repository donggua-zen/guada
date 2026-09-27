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
   * 生成会话标题（幂等：hasGeneratedTitle 保证每组件实例至多一次）。
   * 「是否首轮完成」的判断在调用方（回合制：恰好一个可见回合且有 assistant 回复），
   * 本函数不再接收消息列表自行判长度——旧扁平 messages 数组已死。
   */
  async function generateTitleIfNeeded(
    sessionId: string,
    currentSession: Ref<Session | null>,
  ) {
    if (!hasGeneratedTitle.value) {
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
