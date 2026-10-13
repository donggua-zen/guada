import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "./session";

/**
 * sessionStore 流状态机测试
 *
 * 覆盖:
 * - 初始 streamStatus = 'idle'
 * - setStreamStatus 各状态迁移(pending/running/completed/error)
 * - 关键设计约束:
 *   ① setStreamStatus 不同步 isStreaming(两套状态各管各的:streamStatus 是会话级
 *      统一流状态,isStreaming 由 useSessionEvents 按 stream_status_changed 实际流状态维护)
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

  it("设计约束①:setStreamStatus 不同步 isStreaming(两套状态各管各的)", () => {
    const store = useSessionStore();
    // 预置 isStreaming(running 时由 useSessionEvents 按实际流状态置 true)
    store.setSessionIsStreaming("s1", true);

    // 另一来源写 streamStatus=running
    store.setStreamStatus("s1", "running");
    // isStreaming 不被 setStreamStatus 改动
    expect(store.getSessionState("s1").isStreaming).toBe(true);

    // 反向:仅有 streamStatus=running 时,isStreaming 必须保持 false
    // (isStreaming 只由 setSessionIsStreaming 按后端实际状态维护)
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

  it("peekStreamStatus 返回已缓存会话的实时状态,未缓存返回 undefined", () => {
    const store = useSessionStore();
    store.setStreamStatus("s1", "running");
    expect(store.peekStreamStatus("s1")).toBe("running");

    store.setStreamStatus("s1", "completed");
    expect(store.peekStreamStatus("s1")).toBe("completed");

    // 未缓存:undefined(调用方按 idle 处理),绝不静默创建
    expect(store.peekStreamStatus("unknown")).toBeUndefined();
  });

  it("peekStreamStatus 纯读约束:不创建缓存、不触发 LRU 淘汰(递归更新白屏回归)", () => {
    const store = useSessionStore();
    // 预置一批缓存并给探针会话打标
    for (let i = 0; i < 8; i++) {
      store.getSessionState(`fill_${i}`);
    }
    store.setStreamStatus("probe", "running");
    store.getSessionState("probe");

    // 渲染/watcher 路径高频 peek 一个未知会话:若 peek 有副作用(创建+清扫),
    // probe 会被挤出缓存,状态读取退回 idle
    for (let i = 0; i < 50; i++) {
      expect(store.peekStreamStatus(`unknown_${i}`)).toBeUndefined();
    }
    expect(store.getSessionState("probe").streamStatus).toBe("running");
  });

  it("TTL 淘汰:超过 2h 无续期的缓存被清除,running 中的流保留", () => {
    const store = useSessionStore();
    store.getSessionState("stale_1");
    store.setStreamStatus("runner_1", "running");
    store.getSessionState("runner_1");

    // 快进 3 小时清扫:stale 过期;runner 虽同样无续期但受 running 保护
    store.evictSessionStates(undefined, Date.now() + 3 * 60 * 60 * 1000);

    expect(store.peekStreamStatus("stale_1")).toBeUndefined();
    expect(store.peekStreamStatus("runner_1")).toBe("running");
  });

  it("活跃续期:2h 内有访问续期的缓存不被误删", () => {
    vi.useFakeTimers();
    try {
      const store = useSessionStore();
      vi.setSystemTime(0);
      store.getSessionState("s1");
      // 1h 后再次访问续期(模拟事件/读取不断到来)
      vi.setSystemTime(60 * 60 * 1000);
      store.getSessionState("s1");
      // 2h+1min 时清扫:距上次续期仅 1h+1min,不应被删
      vi.setSystemTime(2 * 60 * 60 * 1000 + 60 * 1000);
      store.evictSessionStates();
      expect(store.peekStreamStatus("s1")).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("peekSessionPendingAsk 纯读约束:不创建缓存、不写响应式 Map(渲染递归白屏回归)", () => {
    const store = useSessionStore();
    store.upsertSessionPendingAsk("probe", { requestId: "req1", kind: "approval", questions: [] });

    // 侧边栏渲染路径按会话逐项 peek 未知会话:若 peek 有副作用(创建 + 清扫),
    // 会话数超 32 硬上限时会"建了又被淘汰"→ 渲染期写响应式 Map → Maximum recursive updates
    for (let i = 0; i < 50; i++) {
      expect(store.peekSessionPendingAsk(`unknown_${i}`)).toBeUndefined();
    }

    // 未缓存会话不因 peek 而诞生:缓存一旦创建,streamStatus 至少是 'idle' 而非 undefined
    expect(store.peekStreamStatus("unknown_0")).toBeUndefined();
    // 既有待批状态正常读取
    expect(store.peekSessionPendingAsk("probe")?.requestId).toBe("req1");
    store.removeSessionPendingAsk("probe", "req1");
    expect(store.peekSessionPendingAsk("probe")).toBeUndefined();
  });

  it("待答队列:并发多个 ask 按到达顺序排队,出队只摘对应那一个", () => {
    const store = useSessionStore();
    const mk = (id: string) => ({ requestId: id, kind: "approval" as const, questions: [] });
    store.upsertSessionPendingAsk("q", mk("r1"));
    store.upsertSessionPendingAsk("q", mk("r2"));
    store.upsertSessionPendingAsk("q", mk("r3"));

    // 到达顺序 = 队列顺序；队首 = 最早
    expect(store.sessionPendingAskQueue("q").map((a) => a.requestId)).toEqual(["r1", "r2", "r3"]);
    expect(store.sessionPendingAsk("q")?.requestId).toBe("r1");

    // 同 requestId 重复写入是幂等的（流帧重放/双写）
    store.upsertSessionPendingAsk("q", mk("r2"));
    expect(store.sessionPendingAskQueue("q").map((a) => a.requestId)).toEqual(["r1", "r2", "r3"]);

    // 摘中间那个：其余不受影响，队首不变
    store.removeSessionPendingAsk("q", "r2");
    expect(store.sessionPendingAskQueue("q").map((a) => a.requestId)).toEqual(["r1", "r3"]);

    // 摘队首 → 下一个成为队首
    store.removeSessionPendingAsk("q", "r1");
    expect(store.sessionPendingAsk("q")?.requestId).toBe("r3");

    store.clearSessionPendingAsks("q");
    expect(store.sessionPendingAskQueue("q")).toEqual([]);
    expect(store.peekSessionPendingAskQueue("q")).toEqual([]);
  });

  it("淘汰保护:待批(审批/询问)中的会话不被 TTL 淘汰(卡片状态丢了无法从补发重建)", () => {
    const store = useSessionStore();
    store.getSessionState("ask_1");
    store.upsertSessionPendingAsk("ask_1", { requestId: "req1", kind: "approval", questions: [] });
    store.getSessionState("stale_1");

    // 快进 3 小时清扫:stale 过期;ask_1 无续期但受待批保护
    store.evictSessionStates(undefined, Date.now() + 3 * 60 * 60 * 1000);

    expect(store.peekStreamStatus("stale_1")).toBeUndefined();
    expect(store.peekSessionPendingAsk("ask_1")?.requestId).toBe("req1");
  });

  it("硬上限兜底:灌入超过 32 个会话,running 不被淘汰,最旧非 running 被踢", () => {
    const store = useSessionStore();
    store.setStreamStatus("runner", "running");
    store.getSessionState("runner");
    for (let i = 0; i < 40; i++) {
      store.getSessionState(`flood_${i}`);
    }
    // running 保护:无论灌入多少,运行中的会话不被淘汰
    expect(store.peekStreamStatus("runner")).toBe("running");
    // 最旧的非 running 被踢,最新的保留(尺寸收敛到硬上限)
    expect(store.peekStreamStatus("flood_0")).toBeUndefined();
    expect(store.peekStreamStatus("flood_39")).toBe("idle");
  });
});
