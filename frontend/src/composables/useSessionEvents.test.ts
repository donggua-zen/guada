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
// visibilityHandlers 捕获注册的可见性回调,供测试手动切换前后台
const visibilityHandlers: Array<() => void> = [];
vi.stubGlobal("document", {
  hidden: false,
  addEventListener: (type: string, cb: () => void) => {
    if (type === "visibilitychange") visibilityHandlers.push(cb);
  },
  removeEventListener: vi.fn(),
});
// node 环境无 window：emitSessionResync 经 window 派发 CustomEvent，提供最小 EventTarget
vi.stubGlobal("window", new EventTarget());

// 捕获 apiService.onSessionEvent 注册的 handler,供测试手动触发
const registeredHandlers = new Map<string, (event: any) => void>();
// 捕获 (重)建连监听,供测试手动触发补拉
const connectHandlers: Array<() => void> = [];
// 可变路由参数 + 捕获 router.afterEach 回调,供测试模拟编程式导航
const routeParams: { sessionId?: string } = { sessionId: "s1" };
const afterEachHandlers: Array<() => void> = [];

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
    onSessionEventsFatal: () => () => {},
    fetchSession: vi.fn(async (sessionId: string) => ({
      id: sessionId,
      isStreaming: false,
      closeReason: null,
    })),
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
  useRouter: () => ({
    afterEach: (cb: () => void) => {
      afterEachHandlers.push(cb);
      return () => {};
    },
    replace: vi.fn(),
  }),
  useRoute: () => ({ params: routeParams }),
}));

import { useSessionEvents } from "./useSessionEvents";
import { apiService } from "@/services/ApiService";
import { SESSION_RESYNC_EVENT } from "@/utils/sessionResync";
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
    visibilityHandlers.length = 0;
    afterEachHandlers.length = 0;
    routeParams.sessionId = "s1";
    (document as any).hidden = false;
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
    // s1 是当前会话且窗口可见 → 不置未读（不打扰正在看的用户）
    expect(store.getSidebarState("s1").unread).toBe(false);
  });

  it("（重）建连补拉待答卡:非当前会话置未读(断线期间的 ask 也要点亮红点)", async () => {
    useSessionEvents().init();
    const store = useSessionStore();

    vi.mocked(apiService.fetchPendingAsks).mockResolvedValue({
      pending: [
        {
          sessionId: "s-bg",
          requestId: "r-bg",
          kind: "approval",
          cardKind: "command-approval",
          title: "命令需要批准",
          questions: [],
        },
      ],
    });

    for (const cb of connectHandlers) cb();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.peekSessionPendingAsk("s-bg")?.requestId).toBe("r-bg");
    expect(store.getSidebarState("s-bg").unread).toBe(true);
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

  it("ask_requested 到达非当前会话:置未读(桌面红点与侧边栏同源)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    streamEventHub.route({
      type: "ask_requested",
      sessionId: "s-bg",
      requestId: "r-bg",
      kind: "approval",
      cardKind: "command-approval",
      questions: [],
      streamSeq: 1,
      streamBootId: "boot-ask",
    } as any);

    expect(store.peekSessionPendingAsk("s-bg")?.requestId).toBe("r-bg");
    expect(store.getSidebarState("s-bg").unread).toBe(true);
  });

  it("ask_requested 到达当前会话且窗口可见:不置未读(用户直接看到卡片)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    streamEventHub.route({
      type: "ask_requested",
      sessionId: "s1",
      requestId: "r-cur",
      kind: "ask",
      cardKind: "question",
      questions: [],
      streamSeq: 1,
      streamBootId: "boot-ask",
    } as any);

    expect(store.peekSessionPendingAsk("s1")?.requestId).toBe("r-cur");
    expect(store.getSidebarState("s1").unread).toBe(false);
  });

  it("离开会话不补亮未读:红点是一次性通知(阅后即焚),待答卡刻意忽略也不持续提醒", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.upsertSessionPendingAsk("s1", { requestId: "r1", kind: "approval", questions: [] });

    // 编程式导航到 s2（路由回调）
    routeParams.sessionId = "s2";
    for (const cb of afterEachHandlers) cb();

    // s1 虽有未答卡片，但用户已看过 → 不补亮；进入的 s2 置已读
    expect(store.peekSessionPendingAsk("s1")?.requestId).toBe("r1");
    expect(store.getSidebarState("s1").unread).toBe(false);
    expect(store.getSidebarState("s2").unread).toBe(false);
  });

  it("进入会话即已读:清当前会话未读,不误清其他会话", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.setSidebarFlag("s1", "unread", true);
    store.setSidebarFlag("s-other", "unread", true);

    for (const cb of afterEachHandlers) cb();

    expect(store.getSidebarState("s1").unread).toBe(false);
    expect(store.getSidebarState("s-other").unread).toBe(true);
  });

  it("窗口隐藏不补亮已看过的待答卡；恢复可见时清除当前会话未读", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.upsertSessionPendingAsk("s1", { requestId: "r1", kind: "approval", questions: [] });

    // 用户已看过卡片后隐藏窗口：不重复提醒
    (document as any).hidden = true;
    for (const cb of visibilityHandlers) cb();
    expect(store.getSidebarState("s1").unread).toBe(false);

    // 恢复可见 = 阅后即焚：清掉当前会话未读
    store.setSidebarFlag("s1", "unread", true);
    store.setSidebarFlag("s-other", "unread", true);
    (document as any).hidden = false;
    for (const cb of visibilityHandlers) cb();
    expect(store.getSidebarState("s1").unread).toBe(false);
    expect(store.getSidebarState("s-other").unread).toBe(true);
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

  it("session_updated 不把事件时间当作活跃时间，只接受会话快照中的权威值", () => {
    useSessionEvents().init();
    const store = useSessionStore();
    store.setSession({ id: "s1", title: "会话", lastActiveAt: "2026-08-01T00:00:00Z" } as any);

    emitSessionEvent("session_updated", {
      sessionId: "s1",
      timestamp: "2026-08-24T00:00:00Z",
      source: "client-other",
      payload: { session: { id: "s1", title: "重命名" } },
    });
    expect(store.getSession("s1")!.title).toBe("重命名");
    expect(store.getSession("s1")!.lastActiveAt).toBe("2026-08-01T00:00:00Z");

    emitSessionEvent("session_updated", {
      sessionId: "s1",
      timestamp: "2026-08-25T00:00:00Z",
      source: "client-other",
      payload: { session: { id: "s1", lastActiveAt: "2026-08-03T00:00:00Z" } },
    });
    expect(store.getSession("s1")!.lastActiveAt).toBe("2026-08-03T00:00:00Z");
  });

  it("自身流只应用后端权威 lastActiveAt，不使用事件 timestamp 推进排序", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    store.setSession({ id: "s-old", title: "老会话", lastActiveAt: "2026-08-01T00:00:00Z" } as any);
    store.setSession({ id: "s-new", title: "新会话", lastActiveAt: "2026-08-02T00:00:00Z" } as any);

    emitStreamStatus(
      { sessionId: "s-old", status: "running", lastActiveAt: "2026-08-03T00:00:00Z" },
      "client-self",
    );
    expect(store.getSession("s-old")!.lastActiveAt).toBe("2026-08-03T00:00:00Z");
    expect(store.getSessionsByGroup(null)[0].id).toBe("s-old");

    emitStreamStatus({ sessionId: "s-old", status: "running" }, "client-self");
    expect(store.getSession("s-old")!.lastActiveAt).toBe("2026-08-03T00:00:00Z");
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

  // === 流状态校准（后台断线后终态事件不可补发，恢复时以服务端为准） ===
  //
  // 背景：终态帧只在完成那一刻对在线连接广播一次，stopStream 随即删缓冲，
  // 重连补发不含已完成会话的任何帧 → 本地 running 必须靠主动探测服务端收敛。
  // 曾因详情端点不返回顶层 isStreaming 而永不生效（undefined === false 恒假）。

  /** 监听会话 resync 事件，返回解除监听函数 */
  function trackSessionResync(resyncs: string[]): () => void {
    const onResync = (e: Event) =>
      resyncs.push((e as CustomEvent<{ sessionId: string }>).detail.sessionId);
    window.addEventListener(SESSION_RESYNC_EVENT, onResync);
    return () => window.removeEventListener(SESSION_RESYNC_EVENT, onResync);
  }

  it("（重）建连:本地 running 但服务端已终态 → 复位流状态并重载当前会话", async () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "running" }, "client-other");
    store.upsertSessionPendingAsk("s1", { requestId: "r1", kind: "approval", questions: [] });
    expect(store.sessionIsStreaming("s1")).toBe(true);
    expect(store.getSidebarState("s1").working).toBe(true);

    // 手机切后台期间回合跑完：重连后 getStreamStatus 返回 isRunning:false（beforeEach 默认）
    const resyncs: string[] = [];
    const off = trackSessionResync(resyncs);
    for (const cb of connectHandlers) cb();
    await flushMicrotasks();
    off();

    // 与 stream_status_changed 终态同款收敛 + 当前会话派发重载事件
    expect(store.sessionIsStreaming("s1")).toBe(false);
    expect(store.getSidebarState("s1").working).toBe(false);
    expect(store.peekStreamStatus("s1")).toBe("completed");
    expect(store.sessionPendingAsk("s1")).toBeUndefined();
    expect(resyncs).toEqual(["s1"]);
  });

  it("（重）建连:服务端仍在运行 → 不复位(流由补发缓冲 + hub 去重接管)", async () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "running" }, "client-other");
    vi.mocked(apiService.getStreamStatus).mockResolvedValue({
      isRunning: true,
      subscriberCount: 1,
      bufferedEventCount: 3,
    });

    const resyncs: string[] = [];
    const off = trackSessionResync(resyncs);
    for (const cb of connectHandlers) cb();
    await flushMicrotasks();
    off();

    expect(store.sessionIsStreaming("s1")).toBe(true);
    expect(store.getSidebarState("s1").working).toBe(true);
    expect(resyncs).toEqual([]);
  });

  it("（重）建连:非当前会话已终态 → 复位侧栏 working 并派发历史重载", async () => {
    useSessionEvents().init(); // 当前路由会话是 s1
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s2", status: "running" }, "client-other");
    expect(store.getSidebarState("s2").working).toBe(true);

    const resyncs: string[] = [];
    const off = trackSessionResync(resyncs);
    for (const cb of connectHandlers) cb();
    await flushMicrotasks();
    off();

    // 任何会话的历史都应失效；若该子会话面板已挂载会立即重载，未挂载时下次打开补拉。
    expect(store.sessionIsStreaming("s2")).toBe(false);
    expect(store.getSidebarState("s2").working).toBe(false);
    expect(resyncs).toEqual(["s2"]);
  });

  it("切回前台:本地 running 且服务端已终态 → 校准复位(覆盖连接假活,不依赖 onConnected)", async () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "s1", status: "running" }, "client-other");
    (document as any).hidden = false;
    for (const cb of visibilityHandlers) cb();
    await flushMicrotasks();

    expect(apiService.getStreamStatus).toHaveBeenCalledWith("s1");
    expect(store.sessionIsStreaming("s1")).toBe(false);
    expect(store.getSidebarState("s1").working).toBe(false);
  });

  it("watchdog:本地 running 静默超阈值 → 探测服务端并复位;已收敛后不再探测", async () => {
    vi.useFakeTimers();
    try {
      useSessionEvents().init();
      const store = useSessionStore();

      emitStreamStatus({ sessionId: "s1", status: "running" }, "client-other");
      expect(store.sessionIsStreaming("s1")).toBe(true);

      // 前台静默一个轮询周期(watchdog 间隔 10s) → 探测(isRunning:false) → 复位
      await vi.advanceTimersByTimeAsync(10_000);
      expect(apiService.getStreamStatus).toHaveBeenCalledWith("s1");
      expect(store.sessionIsStreaming("s1")).toBe(false);

      // 已收敛（不在 running 集合）→ 后续周期不再探测
      await vi.advanceTimersByTimeAsync(60_000);
      expect(apiService.getStreamStatus).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** 等 drain 内部的 await 链跑完 */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
