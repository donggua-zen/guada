import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "./session";

/**
 * sessionStore 流状态机测试
 *
 * 覆盖:
 * - 初始 streamStatus = 'idle'
 * - setStreamStatus 各状态迁移(pending/running/completed/error)
 * - 关键设计约束:
 *   ① setStreamStatus 不同步 isStreaming(那是前端"本窗口已订阅/发起"标记,
 *      由 processStreamLoop/subscribeToActiveStream 维护;同步会误挡 subscribeToActiveStream 守卫)
 *   ② setStreamStatus 不写侧边栏 working(由 useSessionEvents 显式管理,仅主会话)
 * - getSessionState 对同一会话幂等
 */
describe("sessionStore 流状态机", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("初始 streamStatus 为 idle,isStreaming 为 false", () => {
    const store = useSessionStore();
    const state = store.getSessionState("s1");
    expect(state.streamStatus).toBe("idle");
    expect(state.isStreaming).toBe(false);
  });

  it("getSessionState 对同一会话幂等(返回同一实例)", () => {
    const store = useSessionStore();
    expect(store.getSessionState("s1")).toBe(store.getSessionState("s1"));
  });

  it("setStreamStatus 正确迁移各状态", () => {
    const store = useSessionStore();
    store.setStreamStatus("s1", "pending");
    expect(store.getSessionState("s1").streamStatus).toBe("pending");

    store.setStreamStatus("s1", "running");
    expect(store.getSessionState("s1").streamStatus).toBe("running");

    store.setStreamStatus("s1", "completed");
    expect(store.getSessionState("s1").streamStatus).toBe("completed");

    store.setStreamStatus("s1", "error");
    expect(store.getSessionState("s1").streamStatus).toBe("error");

    // 回到 idle(如 SessionBusy 兜底)
    store.setStreamStatus("s1", "idle");
    expect(store.getSessionState("s1").streamStatus).toBe("idle");
  });

  it("设计约束①:setStreamStatus 不同步 isStreaming(避免误挡 subscribeToActiveStream 守卫)", () => {
    const store = useSessionStore();
    // 预置一个"前端已订阅"标记(running 时本窗口已通过 processStreamLoop 置 true)
    store.setSessionIsStreaming("s1", true);

    // 另一窗口发起:统一订阅器写 streamStatus=running
    store.setStreamStatus("s1", "running");
    // 本窗口 isStreaming 应保持 true(本窗口已订阅),不应被 setStreamStatus 改掉
    expect(store.getSessionState("s1").isStreaming).toBe(true);

    // 更关键:无前端订阅时(其他窗口发起,本窗口没订阅),isStreaming 必须保持 false
    // 这样 subscribeToActiveStream 的守卫才能放行本窗口去订阅
    const store2 = useSessionStore();
    store2.setStreamStatus("s2", "running");
    expect(store2.getSessionState("s2").isStreaming).toBe(false);
  });

  it("设计约束②:setStreamStatus 不写侧边栏 working(由 useSessionEvents 显式管理)", () => {
    const store = useSessionStore();
    store.setStreamStatus("s1", "running");
    // 侧边栏 working 应为 false(未经 setSidebarFlag/syncStreamingState 显式设置)
    expect(store.getSidebarState("s1").working).toBe(false);

    // 显式设置后生效
    store.setSidebarFlag("s1", "working", true);
    expect(store.getSidebarState("s1").working).toBe(true);
  });

  it("setSessionIsStreaming 与 setStreamStatus 互不影响(职责分离)", () => {
    const store = useSessionStore();
    store.setStreamStatus("s1", "running");
    expect(store.getSessionState("s1").isStreaming).toBe(false);

    store.setSessionIsStreaming("s1", true);
    expect(store.getSessionState("s1").isStreaming).toBe(true);
    // streamStatus 保持 running,不被 setSessionIsStreaming 改动
    expect(store.getSessionState("s1").streamStatus).toBe("running");
  });
});
