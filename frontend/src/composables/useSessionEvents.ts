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
import { t } from "@/locales";
import { useSessionStore } from "@/stores/session";
import { apiService } from "@/services/ApiService";
import { streamReceiver } from "@/services/modules/StreamReceiver";
import { projectChunk, resetSessionTurnsTransientState } from "@/services/modules/streamProjector";
import { usePopup } from "@/composables/usePopup";

export function useSessionEvents() {
  const sessionStore = useSessionStore();
  const router = useRouter();
  const route = useRoute();
  const { toast } = usePopup();

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

    // === 接收链路常驻(与发送分离) ===
    // 应用启动即建立:唯一 receiver 常驻消费全局 SSE 所有会话事件,
    // 按 sessionId 路由 → 有缓存写缓存 / 无缓存暂存 finish 后事件。
    // 与发送链路(handleSendMessage → apiService.chat)完全独立。
    unsubscribers.push(
      // subscribeAll 已声明 HubStreamEvent（WireStreamEvent），chunk 按判别联合收窄
      streamReceiver.subscribeAll((chunk) => {
        const sid = chunk.sessionId;
        if (!sid) return;
        // 压缩失败/取消：瞬态提示（成功由对话区结果卡承载，不额外打扰）
        if (chunk.type === "compression_error") {
          if (chunk.cancelled) {
            toast.info(t("chat.memo.compressCancelled"));
          } else {
            toast.error(
              t("chat.memo.compressFailedDetail", {
                message: chunk.error || chunk.message || "",
              }),
            );
          }
        }
        projectChunk(sessionStore, sid, chunk);
      }),
    );

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
      apiService.onSessionEvent("stream_status_changed", (event) => {
        const { sessionId, payload } = event;
        const status = payload?.status;
        const sessionType = payload?.sessionType ?? payload?.session?.sessionType;
        const isSubOrBot = sessionType === "sub_agent" || sessionType === "bot";

        // 统一写流状态(子 Agent 也写——概览"子代理"区/侧边栏标签据此派生运行状态)
        sessionStore.setStreamStatus(
          sessionId,
          status === "running" ? "running" : status === "completed" ? "completed" : "error",
        );

        // isStreaming 由实际流状态驱动(修复:旧订阅模式曾盲置 true 且不置回,
        // 导致打开每个会话都显示流式当中):running → true,completed/error → false。
        sessionStore.setSessionIsStreaming(sessionId, status === "running");

        // 流类型（chat=对话回合；maintenance=维护任务如手动压缩伪流）：
        // loadSession 据此决定是否跳过事件页拉取（maintenance 流 buffer 无回合历史）
        sessionStore.setSessionStreamKind(
          sessionId,
          payload?.kind === "maintenance" ? "maintenance" : "chat",
        );

        // 回合级瞬态兜底复位（必须在 isSubOrBot return 之前）：流终止(completed/user_cancel/error)时,
        // 即使 turn_end 事件因连接中断丢失,也确保回合不卡在"正在流式中"。会话级 isStreaming
        // 已在上面统一复位(输入框恢复),子代理/bot 的回合级瞬态若不在此一并复位,
        // 其 TurnItem 会与输入框状态脱节——永久显示流式中、动画不消失。
        if (status !== "running") {
          resetSessionTurnsTransientState(sessionStore, sessionId);
        }

        // 子代理/机器人:tab 状态由 ChatPage watch store 派生,不处理侧边栏/队列/会话对象
        if (isSubOrBot) return;

        // 主会话:侧边栏"工作中"(后端确认 running 才显示)
        sessionStore.setSidebarFlag(sessionId, "working", status === "running");

        // 流结束后自动消费队列——放在 source 过滤之前：
        // 队列是本窗口 store 的本地状态,任何本窗可见的流完成都应尝试消费
        // (自身流完成触发单窗口排队补发;他窗流完成触发多窗口补发)。
        // 修复:原先在 source 过滤之后,自身流完成时被跳过 → 单窗口排队卡死。
        if (status !== "running" && sessionStore.getQueueLength(sessionId) > 0) {
          drainQueue(sessionId);
        }

        // 忽略自身发起的流(不更新会话对象/未读标记)
        if (event.source === apiService.getClientId()) return;

        if (status === "running") {
          if (payload?.session) {
            const existing = sessionStore.getSession(sessionId);
            if (existing) {
              Object.assign(existing, payload.session);
            } else {
              sessionStore.setSession(payload.session);
            }
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
  }

  /**
   * 消费指定会话的队列
   *
   * 统一用 fire-and-forget (POST /chat/stream) 发送。
   * 活动会话：流完成事件触发 drainQueue（排在 source 过滤前,自身流完成也会消费队列）；
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
        await apiService.chat({
          sessionId: targetSessionId,
          regenerationMode: "overwrite",
          userMessage: {
            content: item.content,
            files: item.files,
            knowledgeBaseIds: item.knowledgeBaseIds,
          },
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

  return { init, cleanup, drainQueue };
}
