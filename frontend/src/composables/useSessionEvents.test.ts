import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "@/stores/session";

/**
 * useSessionEvents 统一订阅器测试
 *
 * 覆盖"多窗口同步 / 统一状态订阅器"核心:
 * - stream_status_changed 是全局唯一订阅点,收到事件写 sessionStore.streamStatus
 * - running → streamStatus=running + 侧边栏 working=true
 * - completed/error → streamStatus 终态 + working=false
 * - 子 Agent/bot:写 streamStatus(供 ChatPage watch 派生 tab),但不改侧边栏 working
 * - 忽略自身发起的流(不更新会话对象/未读),但仍标记 working
 * - 兜底清理会话级交互卡:流终止(非 running)清 pendingAsk;streamBootId 变化(后端重启)全清;
 *   同 bootId 的补发(断线重连)不清——仍可应答的卡片必须存活
 */

// init() 里 document.addEventListener("visibilitychange") —— node 环境无 document,提供最小 mock
vi.stubGlobal("document", {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// 捕获 apiService.onSessionEvent 注册的 handler,供测试手动触发
const registeredHandlers = new Map<string, (event: any) => void>();
// 捕获 (重)建连监听,供测试手动触发补拉
const connectHandlers: Array<() => void> = [];

vi.mock("@/services/ApiService", () => ({
  apiService: {
    getClientId: () => "client-self",
    onSessionEvent: (type: string, handler: (event: any) => void) => {
      registeredHandlers.set(type, handler);
      return () => registeredHandlers.delete(type);
    },
    onConnected: (cb: () => void) => {
      connectHandlers.push(cb);
      return () => {};
    },
    fetchPendingAsks: vi.fn(async () => ({ pending: [] })),
    fetchSessionQueue: vi.fn(async () => ({
      sessionId: "s1",
      epoch: "epoch-1",
      revision: 0,
      paused: null,
      promotionId: null,
      isProcessing: false,
      items: [],
    })),
    getStreamStatus: vi.fn(async () => ({
      isRunning: false,
      subscriberCount: 0,
      bufferedEventCount: 0,
    })),
    chat: vi.fn(),
  },
}));

vi.mock("@/composables/usePopup", () => ({
  usePopup: () => ({
    toast: { info: vi.fn(), error: vi.fn(), loading: vi.fn() },
    notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ afterEach: () => () => {}, replace: vi.fn() }),
  useRoute: () => ({ params: { sessionId: "s1" } }),
}));

import { useSessionEvents } from "./useSessionEvents";
import { apiService } from "@/services/ApiService";
import type { UserQueueSnapshot } from "@/types/session";

/** 服务端队列快照工厂 */
function queueSnapshot(
  sessionId: string,
  overrides: Partial<UserQueueSnapshot> = {},
): UserQueueSnapshot {
  return {
    sessionId,
    epoch: "epoch-1",
    revision: 1,
    paused: null,
    promotionId: null,
    isProcessing: false,
    items: [
      {
        id: "a",
        content: "A",
        files: [],
        status: "queued" as const,
        createdAt: "2026-10-25T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}
import { streamEventHub } from "@/services/modules/StreamEventHub";

function emitSessionEvent(type: string, event: Record<string, any>) {
  const handler = registeredHandlers.get(type);
  expect(handler).toBeDefined();
  handler!(event);
}

function emitStreamStatus(payload: Record<string, any>, source?: string) {
  const handler = registeredHandlers.get("stream_status_changed");
  expect(handler).toBeDefined();
  handler!({ sessionId: payload.sessionId, payload, timestamp: "2026-08-24T00:00:00Z", source });
}

describe("useSessionEvents 统一订阅器", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    registeredHandlers.clear();
    connectHandlers.length = 0;
    vi.clearAllMocks();
    vi.mocked(apiService.fetchPendingAsks).mockResolvedValue({ pending: [] });
    vi.mocked(apiService.fetchSessionQueue).mockResolvedValue(
      queueSnapshot("s1", { items: [], revision: 0 }),
    );
    vi.mocked(apiService.getStreamStatus).mockResolvedValue({
      isRunning: false,
      subscriberCount: 0,
      bufferedEventCount: 0,
    });
    vi.mocked(apiService.chat).mockResolvedValue({ ok: true });
  });

  it("init 注册 stream_status_changed 唯一订阅", () => {
    useSessionEvents().init();
    expect(registeredHandlers.has("stream_status_changed")).toBe(true);
  });

  it("streamBootId 变化(后端重启):清空残留待批状态(旧进程内存等待表已消失)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    // 旧进程的流事件：建立 bootId 基线
    streamEventHub.route({
      type: "turn_start", sessionId: "boot-s1", turnId: "T1",
      streamSeq: 1, streamBootId: "boot-A",
    } as any);

    store.upsertSessionPendingAsk("boot-s1", { requestId: "req1", kind: "approval", questions: [] });

    // 新进程事件（bootId 变化）→ 残留待批被清
    streamEventHub.route({
      type: "turn_start", sessionId: "boot-s1", turnId: "T2",
      streamSeq: 1, streamBootId: "boot-B",
    } as any);

    expect(store.sessionPendingAsk("boot-s1")).toBeUndefined();
  });

  it("同 bootId 的补发(断线重连):不清待批状态(卡片仍可应答)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    streamEventHub.route({
      type: "turn_start", sessionId: "boot-s2", turnId: "T1",
      streamSeq: 1, streamBootId: "boot-C",
    } as any);

    store.upsertSessionPendingAsk("boot-s2", { requestId: "req1", kind: "approval", questions: [] });

    // 同进程的后续事件（重连补发的连续帧）：不得触发全清
    streamEventHub.route({
      type: "turn_start", sessionId: "boot-s2", turnId: "T2",
      streamSeq: 2, streamBootId: "boot-C",
    } as any);

    expect(store.sessionPendingAsk("boot-s2")?.requestId).toBe("req1");
  });

  it("（重）建连补拉挂起中的交互卡:刷新/丢帧后卡片自愈，且只补写不清空", async () => {
    useSessionEvents().init();
    const store = useSessionStore();

    // 本地已有一个后端不再持有的待答（例如已被别处应答但帧丢了）：补拉不得清掉它
    store.upsertSessionPendingAsk("s-local", { requestId: "local-1", kind: "approval", questions: [] });

    vi.mocked(apiService.fetchPendingAsks).mockResolvedValue({
      pending: [
        {
          sessionId: "s1",
          requestId: "r1",
          kind: "approval",
          cardKind: "write-approval",
          title: "写文件",
          toolCallId: "c1",
          questions: [],
        },
      ],
    });

    for (const cb of connectHandlers) cb();
    // 等 then 链跑完
    await Promise.resolve();
    await Promise.resolve();

    expect(store.peekSessionPendingAsk("s1")?.requestId).toBe("r1");
    expect(store.peekSessionPendingAsk("s1")?.title).toBe("写文件");
    expect(store.peekSessionPendingAsk("s1")?.cardKind).toBe("write-approval");
    // 补写语义：本地既有的仍保留（清空会把仍可应答的卡片弄丢）
    expect(store.peekSessionPendingAsk("s-local")?.requestId).toBe("local-1");
  });

  it("running 事件:streamStatus=running + 侧边栏 working=true", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "running" });

    expect(store.getSessionState("s1").streamStatus).toBe("running");
    expect(store.getSidebarState("s1").working).toBe(true);
  });

  it("completed 事件:streamStatus=completed + working=false", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "completed" });

    expect(store.getSessionState("s1").streamStatus).toBe("completed");
    expect(store.getSidebarState("s1").working).toBe(false);
  });

  it("error 事件:streamStatus=error + working=false", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "error" });

    expect(store.getSessionState("s1").streamStatus).toBe("error");
    expect(store.getSidebarState("s1").working).toBe(false);
  });

  it("流终止事件:清理会话级交互卡待批状态(掉线错过 ask_resolved 的兜底)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.upsertSessionPendingAsk("s1", { requestId: "req1", kind: "approval", questions: [] });

    emitStreamStatus({ sessionId: "s1", status: "completed" });

    expect(store.sessionPendingAsk("s1")).toBeUndefined();
  });

  it("running 事件不清交互卡:ask 阻塞期间流保持 running", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.upsertSessionPendingAsk("s1", { requestId: "req1", kind: "approval", questions: [] });

    emitStreamStatus({ sessionId: "s1", status: "running" });

    expect(store.sessionPendingAsk("s1")?.requestId).toBe("req1");
  });

  it("子 Agent 事件:写 streamStatus(供 ChatPage watch),但不改侧边栏 working", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "sub-1", status: "running", sessionType: "sub_agent" });

    // streamStatus 写入(供概览"子代理"区等消费方派生运行状态)
    expect(store.getSessionState("sub-1").streamStatus).toBe("running");
    // 侧边栏 working 不被改(子 Agent 不出现在侧边栏)
    expect(store.getSidebarState("sub-1").working).toBe(false);
  });

  it("自身发起的流:仍标记 working,但不更新会话对象/未读", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    // 自身发起(source === clientId),running 携带 session 对象
    emitStreamStatus(
      { sessionId: "s1", status: "running", session: { id: "s1", title: "新的标题" } },
      "client-self",
    );

    // working 仍被标记(任何流开始都显示工作状态,包括自身)
    expect(store.getSidebarState("s1").working).toBe(true);
    // 忽略自身:不更新会话对象
    expect(store.getSession("s1")).toBeUndefined();
    // 忽略自身:不加未读
    expect(store.getSidebarState("s1").unread).toBe(false);
  });

  it("非自身发起的流:更新会话对象 + 更新最近活跃时间", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus(
      { sessionId: "s1", status: "running", session: { id: "s1", title: "其他窗口会话" } },
      "client-other",
    );

    expect(store.getSession("s1")?.title).toBe("其他窗口会话");
  });

  it("自身发起的流开始(running):续期 lastActiveAt,把老会话顶到侧边栏最前", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    // 两个老会话：s-old 更旧，正常排序在后
    store.setSession({ id: "s-old", title: "老会话", lastActiveAt: "2026-08-01T00:00:00Z" } as any);
    store.setSession({ id: "s-new", title: "新会话", lastActiveAt: "2026-08-02T00:00:00Z" } as any);
    expect(store.getSessionsByGroup(null)[0].id).toBe("s-new");

    // 在自身窗口给老会话发消息 → 流开始事件(source === clientId)
    emitStreamStatus({ sessionId: "s-old", status: "running" }, "client-self");

    // lastActiveAt 被续期（emitStreamStatus 注入的固定时间戳）
    expect(store.getSession("s-old")!.lastActiveAt).toBe("2026-08-24T00:00:00Z");
    // 排序副作用：老会话跃居第一
    expect(store.getSessionsByGroup(null)[0].id).toBe("s-old");
  });

  it("自身发起的流终态(completed):不置顶(避免流结束后会话又跳回顶部)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.setSession({ id: "s-old", title: "老会话", lastActiveAt: "2026-08-01T00:00:00Z" } as any);
    store.setSession({ id: "s-new", title: "新会话", lastActiveAt: "2026-08-02T00:00:00Z" } as any);

    emitStreamStatus({ sessionId: "s-old", status: "completed" }, "client-self");

    expect(store.getSession("s-old")!.lastActiveAt).toBe("2026-08-01T00:00:00Z");
    expect(store.getSessionsByGroup(null)[0].id).toBe("s-new");
  });

  it("子 Agent 的流开始:不置顶(子会话不出现在侧边栏)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.setSession({ id: "s-old", title: "老会话", lastActiveAt: "2026-08-01T00:00:00Z" } as any);

    emitStreamStatus(
      { sessionId: "s-old", status: "running", sessionType: "sub_agent" },
      "client-self",
    );

    expect(store.getSession("s-old")!.lastActiveAt).toBe("2026-08-01T00:00:00Z");
  });

  it("queue_updated：应用服务端快照（条目/暂停/计数）", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitSessionEvent("queue_updated", {
      sessionId: "s1",
      timestamp: "2026-10-25T00:00:00Z",
      source: "client-other",
      payload: queueSnapshot("s1", {
        revision: 3,
        paused: { reason: "manual", at: "2026-10-25T00:00:00Z" },
        items: [
          {
            id: "a",
            content: "A",
            files: [],
            status: "queued",
            createdAt: "2026-10-25T00:00:00.000Z",
          },
          {
            id: "b",
            content: "B",
            files: [],
            status: "running",
            createdAt: "2026-10-25T00:00:01.000Z",
          },
        ],
      }),
    });

    expect(store.getMessageQueue("s1").map((m) => m.content)).toEqual(["A", "B"]);
    expect(store.queuePauseReason("s1")).toBe("manual");
    expect(store.peekQueueCount("s1")).toBe(2);
  });

  it("queue_updated：旧 revision 丢弃", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitSessionEvent("queue_updated", {
      sessionId: "s1",
      timestamp: "2026-10-25T00:00:00Z",
      payload: queueSnapshot("s1", { revision: 5 }),
    });
    emitSessionEvent("queue_updated", {
      sessionId: "s1",
      timestamp: "2026-10-25T00:00:00Z",
      payload: queueSnapshot("s1", {
        revision: 4,
        items: [
          {
            id: "old",
            content: "OLD",
            files: [],
            status: "queued",
            createdAt: "2026-10-25T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(store.getMessageQueue("s1")[0].content).toBe("A");
  });

  it("queues_snapshot：整体恢复各会话计数", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitSessionEvent("queues_snapshot", {
      sessionId: "*",
      timestamp: "2026-10-25T00:00:00Z",
      payload: { epoch: "epoch-1", counts: { s1: 2, s2: 1 } },
    });

    expect(store.peekQueueCount("s1")).toBe(2);
    expect(store.peekQueueCount("s2")).toBe(1);
  });

  it("session_deleted：清理队列投影与计数", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitSessionEvent("queue_updated", {
      sessionId: "s1",
      timestamp: "2026-10-25T00:00:00Z",
      payload: queueSnapshot("s1"),
    });
    expect(store.peekQueueCount("s1")).toBe(1);

    emitSessionEvent("session_deleted", {
      sessionId: "s1",
      timestamp: "2026-10-25T00:00:00Z",
      source: "client-other",
    });

    expect(store.getMessageQueue("s1")).toEqual([]);
    expect(store.peekQueueCount("s1")).toBe(0);
  });

  it("（重）建连：补拉当前会话队列", async () => {
    useSessionEvents().init();
    const store = useSessionStore();
    vi.mocked(apiService.fetchSessionQueue).mockResolvedValueOnce(
      queueSnapshot("s1", { revision: 7 }),
    );

    for (const cb of connectHandlers) cb();
    await flushMicrotasks();

    expect(apiService.fetchSessionQueue).toHaveBeenCalledWith("s1");
    expect(store.getMessageQueue("s1").map((m) => m.content)).toEqual(["A"]);
  });

  it("refreshQueue：手动补拉并应用快照", async () => {
    const { refreshQueue } = useSessionEvents();
    const store = useSessionStore();
    vi.mocked(apiService.fetchSessionQueue).mockResolvedValueOnce(
      queueSnapshot("s2", { revision: 2 }),
    );

    await refreshQueue("s2");

    expect(apiService.fetchSessionQueue).toHaveBeenCalledWith("s2");
    expect(store.getMessageQueue("s2").map((m) => m.content)).toEqual(["A"]);
  });
});

/** 等 drain 内部的 await 链跑完 */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
