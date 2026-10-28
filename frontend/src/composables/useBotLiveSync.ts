/**
 * Bot 工作台实时同步
 *
 * 全局 SSE 已有会话/机器人事件，但 useSessionEvents 有意跳过 sessionType=bot
 * （主会话 store 不承载 bot 语义，bot 列表由 /bot-admin/chat-groups 聚合）。
 * 这里做页面级订阅，把「新会话出现 / 会话置顶 / 机器人状态变化」从 20s 轮询
 * 降到亚秒级：
 * - session_created / session_updated / session_deleted、bot 回合流状态
 *   → 防抖重拉 chat-groups（事件只做唤醒，聚合仍以服务端为准）
 * - bot_status_changed → 就地 patch 实例状态 + 防抖重拉
 * - bot_changed（增删改/排序）→ 重拉实例 + 防抖重拉
 * - SSE 重连成功 → 补拉一次（断线期间的事件不会重放）
 */

import { apiService } from "@/services/ApiService";
import type {
  SessionEvent,
  SessionEventType,
} from "@/services/modules/SessionEventsService";
import { useBotStore } from "@/stores/bot";
import type { BotInstance } from "@/types/bot";

/** 合并一轮对话产生的多条会话事件（created + running + completed） */
const SESSIONS_DEBOUNCE_MS = 400;
/** 机器人状态事件密度更高（每次重连尝试一条），单独放宽 */
const BOTS_DEBOUNCE_MS = 800;
/** 拖拽排序挂起时的重试间隔 */
const SUSPENDED_RETRY_MS = 1000;

const BOT_STATUS_VALUES = new Set<BotInstance["status"]>([
  "stopped",
  "running",
  "error",
  "connecting",
]);

function normalizeStatus(
  value: string | undefined,
): BotInstance["status"] | undefined {
  return value && BOT_STATUS_VALUES.has(value as BotInstance["status"])
    ? (value as BotInstance["status"])
    : undefined;
}

export interface BotStatusPayload {
  botId?: string;
  runtimeStatus?: string;
  status?: string;
  lastError?: string | null;
  reason?: string;
}

export interface BotLiveSyncOptions {
  /** 会话列表需要重拉（新会话/新消息/删除/置顶） */
  onSessionsChanged: () => void;
  /** 拖拽排序进行中：挂起后台刷新，结束后补一次 */
  isSuspended?: () => boolean;
  /** bot_status_changed 原始负载（用于同步当前打开会话的头部状态） */
  onBotStatus?: (payload: BotStatusPayload) => void;
}

export function useBotLiveSync(options: BotLiveSyncOptions) {
  const botStore = useBotStore();
  const unsubscribers: Array<() => void> = [];

  let sessionsTimer: ReturnType<typeof setTimeout> | undefined;
  let botsTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const suspended = () => options.isSuspended?.() === true;

  function flushSessions() {
    sessionsTimer = undefined;
    if (disposed) return;
    // 拖拽排序期间列表不能被后台刷新重排，结束后再补一次
    if (suspended()) {
      sessionsTimer = setTimeout(flushSessions, SUSPENDED_RETRY_MS);
      return;
    }
    options.onSessionsChanged();
  }

  function scheduleSessions() {
    if (disposed || sessionsTimer) return;
    sessionsTimer = setTimeout(
      flushSessions,
      suspended() ? SUSPENDED_RETRY_MS : SESSIONS_DEBOUNCE_MS,
    );
  }

  async function flushBots() {
    botsTimer = undefined;
    if (disposed) return;
    try {
      await botStore.loadBotInstances({ silent: true });
    } catch {
      // 后台同步失败静默：下一次事件或兜底轮询会再同步
    }
    scheduleSessions();
  }

  function scheduleBots() {
    if (disposed || botsTimer) return;
    botsTimer = setTimeout(() => void flushBots(), BOTS_DEBOUNCE_MS);
  }

  function subscribe(
    type: SessionEventType,
    handler: (event: SessionEvent) => void,
  ) {
    unsubscribers.push(apiService.onSessionEvent(type, handler));
  }

  subscribe("session_created", (event) => {
    if (event.payload?.session?.sessionType !== "bot") return;
    scheduleSessions();
  });

  subscribe("session_updated", (event) => {
    // 其他窗口置顶/重命名：bot 会话的更新被全局订阅器跳过，这里补上
    if (event.payload?.session?.sessionType !== "bot") return;
    scheduleSessions();
  });

  subscribe("session_deleted", () => {
    // 事件未携带 sessionType（删除是低频动作），直接重拉由服务端收敛
    scheduleSessions();
  });

  subscribe("stream_status_changed", (event) => {
    // bot 回合 running/终态：新消息置顶与新会话首次出现都在这里兜住
    if (event.payload?.sessionType !== "bot") return;
    scheduleSessions();
  });

  subscribe("bot_status_changed", (event) => {
    const payload = (event.payload ?? {}) as BotStatusPayload;
    if (payload.botId) {
      botStore.applyRuntimeStatus(payload.botId, {
        runtimeStatus: payload.runtimeStatus,
        status: normalizeStatus(payload.status),
        lastError: payload.lastError,
      });
    }
    options.onBotStatus?.(payload);
    scheduleSessions();
  });

  subscribe("bot_changed", () => {
    // 增删改/排序：实例列表与分组都要重新对齐
    scheduleBots();
  });

  unsubscribers.push(
    apiService.onConnected?.(() => {
      // 断线期间的状态/CRUD 事件不会重放，重连后补拉；
      // flushBots 完成时会顺带排一次分组刷新，避免同一轮拉两次
      scheduleBots();
    }) ?? (() => {}),
  );

  function cleanup() {
    disposed = true;
    if (sessionsTimer) clearTimeout(sessionsTimer);
    if (botsTimer) clearTimeout(botsTimer);
    sessionsTimer = undefined;
    botsTimer = undefined;
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    unsubscribers.length = 0;
  }

  return { cleanup };
}
