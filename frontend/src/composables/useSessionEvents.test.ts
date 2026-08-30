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
 */

// init() 里 document.addEventListener("visibilitychange") —— node 环境无 document,提供最小 mock
vi.stubGlobal("document", {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// 捕获 apiService.onSessionEvent 注册的 handler,供测试手动触发
const registeredHandlers = new Map<string, (event: any) => void>();

vi.mock("@/services/ApiService", () => ({
  apiService: {
    getClientId: () => "client-self",
    onSessionEvent: (type: string, handler: (event: any) => void) => {
      registeredHandlers.set(type, handler);
      return () => registeredHandlers.delete(type);
    },
    chat: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ afterEach: () => () => {}, replace: vi.fn() }),
  useRoute: () => ({ params: { sessionId: "s1" } }),
}));

import { useSessionEvents } from "./useSessionEvents";
import { apiService } from "@/services/ApiService";

function emitStreamStatus(payload: Record<string, any>, source?: string) {
  const handler = registeredHandlers.get("stream_status_changed");
  expect(handler).toBeDefined();
  handler!({ sessionId: payload.sessionId, payload, timestamp: "2026-08-24T00:00:00Z", source });
}

describe("useSessionEvents 统一订阅器", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    registeredHandlers.clear();
  });

  it("init 注册 stream_status_changed 唯一订阅", () => {
    useSessionEvents().init();
    expect(registeredHandlers.has("stream_status_changed")).toBe(true);
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

  it("子 Agent 事件:写 streamStatus(供 ChatPage watch),但不改侧边栏 working", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    emitStreamStatus({ sessionId: "sub-1", status: "running", sessionType: "sub_agent" });

    // streamStatus 写入(供 ChatPage watch 派生 agentTabs)
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

  it("流结束后自动消费队列(有排队消息时调用 chat)", () => {
    useSessionEvents().init();
    const store = useSessionStore();

    // 预置排队消息
    store.enqueueMessage("s1", {
      content: "排队内容",
      files: [],
      knowledgeBaseIds: undefined,
    });
    (apiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    emitStreamStatus({ sessionId: "s1", status: "completed" });

    expect(apiService.chat).toHaveBeenCalledTimes(1);
    const callArg = (apiService.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.sessionId).toBe("s1");
    expect(callArg.regenerationMode).toBe("overwrite");
    expect(callArg.userMessage.content).toBe("排队内容");
  });
});
