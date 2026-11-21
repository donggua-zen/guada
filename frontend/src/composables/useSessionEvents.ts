/**
 * 全局会话事件管理 Composable
 *
 * 统一管理所有 SSE 会话事件的监听与分发：
 * - session_created / session_deleted / session_updated → 同步 sessionStore
 * - stream_started / stream_finished → 更新侧边栏 working 状态 + 队列消费
 * - sub_agent_create / sub_agent_ended → 由 ChatPage 单独监听（仅聊天页需要）
 *
 * 应在 MainLayout.vue 中调用（始终挂载，不会因路由切换而卸载）。
 */

import { ref, type Ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { NEW_SESSION_ID } from "@/constants";
import { t } from "@/locales";
import { useSessionStore } from "@/stores/session";
import { useSessionGroupStore } from "@/stores/sessionGroup";
import { useAuthStore } from "@/stores/auth";
import { apiService } from "@/services/ApiService";
import { streamReceiver } from "@/services/modules/StreamReceiver";
import { projectChunk, resetSessionTurnsTransientState } from "@/services/modules/streamProjector";
import { toast } from '@/components/ui/toastService';
import { emitSessionResync } from "@/utils/sessionResync";
import type { UserQueueSnapshot } from "@/types/session";

export function useSessionEvents() {
  const sessionStore = useSessionStore();
  const router = useRouter();
  const route = useRoute();
  ;

  const windowHidden = ref(false);
  const unsubscribers: Array<() => void> = [];

  // 当前会话 ID（从路由参数获取，与 GlobalSidebar 保持一致）
  const currentSessionId: Ref<string | undefined> = ref(undefined);

  function updateCurrentSessionId() {
    const sid = route.params.sessionId;
    const next = Array.isArray(sid) ? sid[0] : sid;

    // 红点语义 = 一次性通知（阅后即焚）：进入会话即视为已读，不跟踪是否真的处理了
    // （用户可能刻意忽略待答卡，持续亮红点会与真正的未读事件混淆）。
    // 集中在此处理，覆盖侧边栏点击之外的编程式导航（通知跳转等），避免"已进入会话但 unread 残留"。
    if (next) {
      sessionStore.setSidebarFlag(next, "unread", false);
    }

    currentSessionId.value = next;
  }

  // === 流状态校准（后台断线后终态事件不可补发，恢复时以服务端为准） ===
  //
  // 息屏/断网期间回合可能已结束：终态帧（stream_status_changed: completed）只在完成
  // 那一刻对在线连接广播一次，stopStream 随即删除缓冲 → 重连补发（buildCatchupEvents
  // 只重放仍在运行的流）不含已完成会话的任何帧。本地若仍自认 isStreaming=true 就会
  // 永久卡 running（补拉判断 server.isStreaming 曾因详情端点不注入该字段而永不生效）。
  // 借鉴 zcode 的"恢复即查状态"：恢复时对本地所有 running 会话探测服务端真实状态，
  // 已终态则复位瞬态并重载历史，不等事件。

  /** 每会话最后收到流帧的时间（watchdog 判静默用） */
  const lastStreamChunkAt = new Map<string, number>();
  /** watchdog 轮询间隔（仅前台运行；后台浏览器本就可能暂停 timer） */
  const STREAM_WATCHDOG_INTERVAL_MS = 10_000;
  /** 流静默超过该时长 → 主动探测一次服务端状态（LLM 长思考也可能静默，探测无害） */
  const STREAM_SILENCE_PROBE_AFTER_MS = 60_000;
  /** 同一会话两次探测的最小间隔（长思考静默期间不至于每 10s 打一次 status 接口） */
  const STREAM_PROBE_MIN_INTERVAL_MS = 60_000;

  let streamWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** 正在探测的会话代数，旧响应不能覆盖探测期间已开启的新回合 */
  const probeGeneration = new Map<string, number>();
  const lastProbeAt = new Map<string, number>();
  /** 已知终态的历史需要重新拉取；ChatPanel 挂载时也会消费该标记 */
  const staleSessionHistory = new Set<string>();

  function markSessionHistoryStale(sessionId: string): void {
    staleSessionHistory.add(sessionId);
    const state = sessionStore.getSessionState(sessionId);
    state.loaded = false;
    emitSessionResync(sessionId);
  }

  function isSessionHistoryStale(sessionId: string): boolean {
    return staleSessionHistory.has(sessionId);
  }

  function clearSessionHistoryStale(sessionId: string): void {
    staleSessionHistory.delete(sessionId);
  }

  async function probeStreamingSession(sessionId: string): Promise<void> {
    const generation = (probeGeneration.get(sessionId) ?? 0) + 1;
    probeGeneration.set(sessionId, generation);
    try {
      const status = await apiService.getStreamStatus(sessionId);
      if (probeGeneration.get(sessionId) !== generation) return;
      if (status?.isRunning !== false) return;
      if (!sessionStore.sessionIsStreaming(sessionId)) return;
      // 状态端点只说明流已停止；有会话快照时用持久化 closeReason 保留失败态。
      let finalStatus: "completed" | "error" = "completed";
      try {
        const session = await apiService.fetchSession(sessionId);
        if (probeGeneration.get(sessionId) !== generation) return;
        if (session?.closeReason && session.closeReason !== "completed") {
          finalStatus = "error";
        }
      } catch {
        // status 仍是权威的运行态；详情暂时不可用时按 completed 收敛。
      }
      if (probeGeneration.get(sessionId) !== generation) return;
      if (!sessionStore.sessionIsStreaming(sessionId)) return;
      sessionStore.syncStreamingState(sessionId, false);
      sessionStore.setStreamStatus(sessionId, finalStatus);
      resetSessionTurnsTransientState(sessionStore, sessionId);
      sessionStore.clearSessionPendingAsks(sessionId);
      markSessionHistoryStale(sessionId);
    } catch {
      /* 探测失败静默：下一个触发点（重连/切前台/watchdog）再试 */
    }
  }

  /** 对本地所有 running 会话校准（重连/切回前台触发，覆盖侧栏 working 残留） */
  function resyncStreamingSessions(): void {
    for (const sid of sessionStore.streamingSessionIds()) {
      void probeStreamingSession(sid);
    }
  }

  /** watchdog：前台时段轮询，本地 running 且长时间无流帧 → 探测服务端状态 */
  function startStreamWatchdog() {
    if (streamWatchdogTimer) return;
    streamWatchdogTimer = setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      for (const sid of sessionStore.streamingSessionIds()) {
        // 刚发起、从未收到帧的会话同样按静默处理：若服务端已注册流则 isRunning=true，探测无害
        if (now - (lastStreamChunkAt.get(sid) ?? 0) < STREAM_SILENCE_PROBE_AFTER_MS) {
          continue;
        }
        if (now - (lastProbeAt.get(sid) ?? 0) < STREAM_PROBE_MIN_INTERVAL_MS) {
          continue;
        }
        lastProbeAt.set(sid, now);
        void probeStreamingSession(sid);
      }
    }, STREAM_WATCHDOG_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    windowHidden.value = document.hidden;
    // 回到前台即视为已读（阅后即焚）；只清当前会话，其他会话的未读保留。
    // 隐藏时不做任何补亮：已看过的待答卡不重复提醒，避免红点与真正的未读混淆。
    if (!document.hidden) {
      if (currentSessionId.value) {
        sessionStore.setSidebarFlag(currentSessionId.value, "unread", false);
      }
      // 切回前台即校准：覆盖"连接假活"（socket 看似 OPEN 实际半开，既不会触发
      // onConnected 重连补拉，也可能未达 15s 强制重建阈值）——借鉴 zcode 的
      // visible/resume 恢复先探测原状态再收敛。
      resyncStreamingSessions();
    }
  }

  function init() {
    // 初始可见性（后台启动/最小化启动时直接进隐藏态，避免误判为"正在看"）
    windowHidden.value = document.hidden === true;
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

        // 记录最后流帧时间（watchdog 判静默用；hub 已按 streamSeq 去重）
        lastStreamChunkAt.set(sid, Date.now());

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

        // 审批/询问到达 = 有人在等你操作：非当前会话或窗口隐藏时置未读。
        // 桌面任务栏红点由 useTrayStats 轮询 unread 派生（与侧边栏蓝点/待答胶囊同源）；
        // 当前会话且窗口可见时不置——用户直接看到交互卡，不打扰。
        // 同值幂等：SSE 补发/重放重复触发无副作用。
        if (
          chunk.type === "ask_requested" &&
          (sid !== currentSessionId.value || windowHidden.value)
        ) {
          sessionStore.setSidebarFlag(sid, "unread", true);
        }
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
              // 断线/刷新期间到达的待答卡同样要点亮红点（非当前会话或窗口隐藏）
              if (
                ask.sessionId !== currentSessionId.value ||
                windowHidden.value
              ) {
                sessionStore.setSidebarFlag(ask.sessionId, "unread", true);
              }
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

        resyncStreamingSessions();
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
          // 其它窗口/定时任务在全新目录建会话时，后端会把写时注册的目录分组
          // 一起广播；先补进分组缓存，否则本窗口会先把会话归到「通用」桶。
          if (session.projectGroup) {
            useSessionGroupStore().upsertProjectGroup(session.projectGroup);
          }
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

        // 只有后端明确返回了持久化值，才更新排序字段；event.timestamp 只是事件时间。
        if (payload?.session?.lastActiveAt) {
          sessionStore.updateSessionLastActiveTime(
            sessionId,
            payload.session.lastActiveAt,
          );
        }

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

        // 仅使用后端刚写入 SQLite 的活跃时间，不用事件时间推导排序状态。
        if (status === "running" && payload?.lastActiveAt) {
          sessionStore.updateSessionLastActiveTime(
            sessionId,
            payload.lastActiveAt,
          );
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

        // 新会话对象已由后端快照合并；排序只接受明确的权威 lastActiveAt。
        if (payload?.lastActiveAt) {
          sessionStore.updateSessionLastActiveTime(
            sessionId,
            payload.lastActiveAt,
          );
        }

        if (
          sessionId !== currentSessionId.value ||
          windowHidden.value
        ) {
          sessionStore.setSidebarFlag(sessionId, "unread", true);
        }
      }),
    );

    // 流静默 watchdog：覆盖 onConnected/visibilitychange 之外的丢终态路径
    // （如半开连接期间事件静默丢失）。探测无害化设计，详见 probeStreamingSession。
    startStreamWatchdog();
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
    if (streamWatchdogTimer) {
      clearInterval(streamWatchdogTimer);
      streamWatchdogTimer = null;
    }
    lastStreamChunkAt.clear();
    lastProbeAt.clear();
    probeGeneration.clear();
    staleSessionHistory.clear();
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    unsubscribers.length = 0;
  }

  return {
    init,
    cleanup,
    refreshQueue,
    isSessionHistoryStale,
    clearSessionHistoryStale,
  };
}
