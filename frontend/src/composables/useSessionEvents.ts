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
import { NEW_SESSION_ID } from "@/constants";
import { t } from "@/locales";
import { useSessionStore } from "@/stores/session";
import { useAuthStore } from "@/stores/auth";
import { apiService } from "@/services/ApiService";
import { streamReceiver } from "@/services/modules/StreamReceiver";
import { projectChunk, resetSessionTurnsTransientState } from "@/services/modules/streamProjector";
import { usePopup } from "@/composables/usePopup";
import { emitSessionResync } from "@/utils/sessionResync";
import type { UserQueueSnapshot } from "@/types/session";

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

  /**
   * SSE 重连后校准当前会话：
   * 息屏/断网期间回合可能已经结束（stopStream 删了缓冲，重连补发不会包含终态），
   * 此时本地仍标记 isStreaming=true → 复位流状态并请求聊天区重载历史。
   * 仍在前台运行的流由服务端补发缓冲 + hub 去重接管，不触发重载。
   */
  async function resyncCurrentSessionIfNeeded() {
    const sessionId = currentSessionId.value;
    if (!sessionId) return;
    const state = sessionStore.getSessionState(sessionId);
    if (!state?.isStreaming) return;
    try {
      const server = await apiService.fetchSession(sessionId);
      if (server && server.isStreaming === false) {
        sessionStore.syncStreamingState(sessionId, false);
        resetSessionTurnsTransientState(sessionStore, sessionId);
        sessionStore.clearSessionPendingAsks(sessionId);
        emitSessionResync(sessionId);
      }
    } catch {
      /* 补拉失败静默：下一次重连再试 */
    }
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
    // 后端进程标识（streamBootId）：变化 = 后端重启，旧进程的内存等待表已清空。
    let lastStreamBootId: string | undefined;

    unsubscribers.push(
      // subscribeAll 已声明 HubStreamEvent（WireStreamEvent），chunk 按判别联合收窄
      streamReceiver.subscribeAll((chunk) => {
        const sid = chunk.sessionId;
        if (!sid) return;

        // 后端重启：清掉上一个进程残留的待批状态（本帧若恰是 ask_requested，
        // 紧随其后的 projectChunk 会重新写入；新进程仍待批的 ask 由补发帧重建）。
        // 注意不能改成"每次建连就清"：同进程重连（网络闪断）时补发会被 hub 按
        // streamSeq 去重丢弃，状态无法重建，清了就把仍可应答的卡片弄丢。
        if (
          chunk.streamBootId &&
          lastStreamBootId &&
          chunk.streamBootId !== lastStreamBootId
        ) {
          sessionStore.clearAllPendingAsks();
        }
        if (chunk.streamBootId) lastStreamBootId = chunk.streamBootId;

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

    // === （重）建连补拉：挂起中的交互卡 ===
    //
    // ask_requested 是流帧：页面刷新 / SSE 丢帧后前端拿不到它，而历史重放刻意不重建待答卡片
    // （无从判断该 ask 是否仍在等待）→ 卡片不回来、后端无超时 → 回合永久挂住。
    // 这里每次（重）建连直接读后端等待表补一刀。**只 upsert、不清空**：同进程重连时补发帧
    // 会被 hub 按 streamSeq 去重丢弃，清空会把仍可应答的卡片弄丢（与 streamBootId 分支同一约束）。
    unsubscribers.push(
      apiService.onConnected?.(() => {
        void apiService
          .fetchPendingAsks()
          .then((res) => {
            for (const ask of res?.pending ?? []) {
              if (!ask?.sessionId || !ask.requestId) continue;
              sessionStore.upsertSessionPendingAsk(ask.sessionId, {
                requestId: ask.requestId,
                kind: ask.kind,
                cardKind: ask.cardKind,
                title: ask.title,
                toolCallId: ask.toolCallId,
                toolName: ask.toolName,
                questions: ask.questions ?? [],
              });
            }
          })
          .catch(() => {
            /* 补拉失败静默：不影响主流程，下一次建连再试 */
          });

        // 队列补偿：断线期间可能错过 queue_updated；重连后补拉当前会话。
        // 各会话计数由连接补发的 queues_snapshot 恢复。
        if (currentSessionId.value) {
          void refreshQueue(currentSessionId.value);
        }

        // 状态校准：息屏期间回合可能已结束，补发不会包含终态 → 主动核对并重载历史
        void resyncCurrentSessionIfNeeded();
      }) ?? (() => {}),
    );

    // === 连接被判死（polyfill CLOSED，常见于 token 过期 401）===
    // 交给既有鉴权流程：401 → logout/跳登录；网络错误则保留登录态。
    // 延迟到回调里再取 store：node 单测环境没有 localStorage，避免初始化即崩。
    unsubscribers.push(
      apiService.onSessionEventsFatal(() => {
        void useAuthStore().checkAuth();
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
              params: { sessionId: NEW_SESSION_ID },
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

    // === 用户输入队列事件（M3：服务端权威） ===
    unsubscribers.push(
      apiService.onSessionEvent("queue_updated", (event) => {
        const snapshot = event.payload as unknown as UserQueueSnapshot;
        if (snapshot?.items) {
          sessionStore.applyQueueSnapshot(event.sessionId, snapshot);
        }
      }),
    );

    unsubscribers.push(
      apiService.onSessionEvent("queues_snapshot", (event) => {
        const counts = (event.payload?.counts ?? {}) as Record<string, number>;
        sessionStore.setQueueCounts(counts);
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
          // 会话级交互卡兜底：流已终止 → 不可能仍有等待中的 ask（ask 阻塞期间流保持 running），
          // 防 SSE 掉线期间错过 ask_resolved 后卡片残留。
          sessionStore.clearSessionPendingAsks(sessionId);
        }

        // 子代理/机器人:tab 状态由 ChatPage watch store 派生,不处理侧边栏/队列/会话对象
        if (isSubOrBot) return;

        // 主会话:侧边栏"工作中"(后端确认 running 才显示)
        sessionStore.setSidebarFlag(sessionId, "working", status === "running");

        // 流开始即置顶：本方窗口发起的流同样要续期「最近活跃」时间。
        // 侧边栏按 lastActiveAt 降序排序(见 stores/session.ts getSessionsByGroup)，
        // 而自身事件会在下方 source 过滤处被忽略、走不到末尾的更新时间——不在此处补一刀，
        // 给老会话发消息后它就不会被顶到列表最前(发送链路 ChatPanel.handleSendMessage
        // 只调 apiService.chat，本地不写 lastActiveAt；后端只落库不发事件)。
        // 仅 running 置顶；终态不改序(避免流结束后会话又跳回顶部)。
        if (status === "running") {
          sessionStore.updateSessionLastActiveTime(sessionId, event.timestamp);
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

        // 非自身事件：续期最近活跃。此处必须保留（running 已在 source 过滤前置顶，
        // 但对"事件携带新会话、本地刚由 payload.session 建对象"的非自身场景，
        // 置顶要发生在对象落库之后，故这里不再按状态区分——同值重复写无副作用）。
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
   * 补拉指定会话的队列快照。
   *
   * 用于打开会话 / SSE 重连：后端不重放历史 queue_updated，
   * 错过时以本次全量快照为准（revision/epoch 会丢弃更旧的响应）。
   */
  async function refreshQueue(sessionId: string): Promise<void> {
    try {
      const snapshot = await apiService.fetchSessionQueue(sessionId);
      if (snapshot) {
        sessionStore.applyQueueSnapshot(sessionId, snapshot);
      }
    } catch {
      /* 补拉失败静默：队列事件/下一次重连会再同步 */
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

  return { init, cleanup, refreshQueue };
}
