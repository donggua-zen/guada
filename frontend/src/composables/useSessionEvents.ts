/**
 * 全局会话事件管理 Composable
 *
 * 统一管理所有 SSE 会话事件的监听与分发：
 * - session_created / session_deleted / session_updated → 同步 sessionStore
 * - stream_started / stream_finished → 更新侧边栏 working 状态 + 队列消费
 * - sub_agent_create / sub_agent_closed → 由 ChatPage 单独监听（仅聊天页需要）
 *
 * 应在 MainLayout.vue 中调用（始终挂载，不会因路由切换而卸载）。
 */

import { ref, type Ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { apiService } from "@/services/ApiService";

export function useSessionEvents() {
  const sessionStore = useSessionStore();
  const router = useRouter();
  const route = useRoute();

  const windowHidden = ref(false);
  const unsubscribers: Array<() => void> = [];

  // 当前会话 ID（从路由参数获取，与 GlobalSidebar 保持一致）
  const currentSessionId: Ref<string | undefined> = ref(undefined);

  function updateCurrentSessionId() {
    const sid = route.params.sessionId;
    currentSessionId.value = Array.isArray(sid) ? sid[0] : sid;
  }

  function handleVisibilityChange() {
    windowHidden.value = document.hidden;
    if (!document.hidden && currentSessionId.value) {
      sessionStore.setSidebarFlag(currentSessionId.value, "unread", false);
    }
  }

  function init() {
    // 路由变化时更新当前会话 ID
    updateCurrentSessionId();
    const stopRouteWatch = router.afterEach(() => updateCurrentSessionId());
    unsubscribers.push(stopRouteWatch);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // === 会话 CRUD 事件 ===

    unsubscribers.push(
      apiService.onSessionEvent("session_created", (event) => {
        if (event.source === apiService.getClientId()) return;
        const { payload } = event;
        if (
          payload?.session?.sessionType === "sub_agent" ||
          payload?.session?.sessionType === "bot"
        )
          return;
        if (payload?.session) {
          const session = payload.session;
          if (!sessionStore.getSession(session.id)) {
            sessionStore.setSession(session);
          }
        }
      }),
    );

    unsubscribers.push(
      apiService.onSessionEvent("session_deleted", (event) => {
        if (event.source === apiService.getClientId()) return;
        const { sessionId } = event;
        sessionStore.removeSession(sessionId);
        sessionStore.clearSidebarState(sessionId);

        if (currentSessionId.value === sessionId) {
          const remainingSessions = Array.from(
            sessionStore.sessionsMap.values(),
          );
          if (remainingSessions.length > 0) {
            router.replace({
              name: "Chat",
              params: { sessionId: remainingSessions[0].id },
            });
          } else {
            router.replace({
              name: "Chat",
              params: { sessionId: "new-session" },
            });
          }
        }
      }),
    );

    unsubscribers.push(
      apiService.onSessionEvent("session_updated", (event) => {
        if (event.source === apiService.getClientId()) return;
        const { sessionId, payload } = event;
        if (
          payload?.session?.sessionType === "sub_agent" ||
          payload?.session?.sessionType === "bot"
        )
          return;

        if (payload?.session) {
          const existing = sessionStore.getSession(sessionId);
          if (existing) {
            Object.assign(existing, payload.session);
          } else {
            sessionStore.setSession(payload.session);
          }
        }

        sessionStore.updateSessionLastActiveTime(sessionId, event.timestamp);

        if (
          sessionId !== currentSessionId.value ||
          windowHidden.value
        ) {
          sessionStore.setSidebarFlag(sessionId, "unread", true);
        }
      }),
    );

    // === 流式状态事件 ===

    unsubscribers.push(
      apiService.onSessionEvent("stream_started", (event) => {
        const { sessionId, payload } = event;
        if (
          payload?.session?.sessionType === "sub_agent" ||
          payload?.session?.sessionType === "bot"
        )
          return;

        // 标记会话为工作中（任何流开始都显示工作状态，包括自身发起）
        sessionStore.setSidebarFlag(sessionId, "working", true);

        // 忽略自身发起的流
        if (event.source === apiService.getClientId()) return;

        if (payload?.session) {
          const existing = sessionStore.getSession(sessionId);
          if (existing) {
            Object.assign(existing, payload.session);
          } else {
            sessionStore.setSession(payload.session);
          }
        }

        sessionStore.updateSessionLastActiveTime(sessionId, event.timestamp);

        if (
          sessionId !== currentSessionId.value ||
          windowHidden.value
        ) {
          sessionStore.setSidebarFlag(sessionId, "unread", true);
        }
      }),
    );

    unsubscribers.push(
      apiService.onSessionEvent("stream_finished", (event) => {
        const { sessionId, payload } = event;
        if (
          payload?.sessionType === "sub_agent" ||
          payload?.sessionType === "bot"
        )
          return;

        sessionStore.setSidebarFlag(sessionId, "working", false);

        if (
          sessionId !== currentSessionId.value ||
          windowHidden.value
        ) {
          sessionStore.setSidebarFlag(sessionId, "unread", true);
        }

        if (sessionStore.getQueueLength(sessionId) > 0) {
          drainQueue(sessionId);
        }
      }),
    );
  }

  /**
   * 消费指定会话的队列
   *
   * 统一用 fire-and-forget (POST /chat/send) 发送。
   * 活动会话：后端 stream_started 事件到达后 ChatPage 自动 subscribeToActiveStream
   *   （POST /chat/send 的 source.clientId=null，不会被 ChatPage 的"忽略自身发起"逻辑过滤）
   * 非活动会话：后台运行，用户切回时从后端重新读取消息
   */
  async function drainQueue(targetSessionId: string) {
    while (sessionStore.getQueueLength(targetSessionId) > 0) {
      const item = sessionStore.peekQueue(targetSessionId);
      if (!item) break;

      sessionStore.updateQueuedMessage(targetSessionId, item.id, {
        status: "sending",
      });

      try {
        await apiService.sendMessage({
          sessionId: targetSessionId,
          content: item.content,
          fileIds: item.files.map((f: any) => f.id),
          knowledgeBaseIds: item.knowledgeBaseIds,
        });
        // 成功：出队
        sessionStore.dequeueMessage(targetSessionId);
        return; // 等下一次 stream_finished 触发
      } catch (error) {
        const errMsg = (error as Error).message || "";
        if (
          errMsg.includes("SessionBusyError") ||
          errMsg.includes("SESSION_BUSY")
        ) {
          sessionStore.updateQueuedMessage(targetSessionId, item.id, {
            status: "queued",
          });
          return; // 等下一次 stream_finished
        }
        // 其他错误：出队避免死循环
        sessionStore.dequeueMessage(targetSessionId);
        console.error("[useSessionEvents] 队列消息发送失败:", errMsg);
      }
    }
  }

  /**
   * 尝试立即消费指定会话的队列（用于会话切换时恢复）
   * 供 ChatPanel 调用
   */
  async function tryDrainQueue(sessionId: string) {
    if (
      sessionStore.getQueueLength(sessionId) > 0 &&
      !sessionStore.sessionIsStreaming(sessionId)
    ) {
      await drainQueue(sessionId);
    }
  }

  function cleanup() {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    unsubscribers.length = 0;
  }

  return { init, cleanup, drainQueue, tryDrainQueue };
}
