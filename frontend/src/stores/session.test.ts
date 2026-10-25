import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore, UNGROUPED_ID } from "./session";
import type { UserQueueSnapshot } from "@/types/session";

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

/**
 * 置顶（pin）在侧边栏的聚合契约：
 * 「已置顶」分区（getPinnedSessions）与分组区（getSessionsByGroup）互斥，避免同一会话出现两次。
 */
describe("sessionStore 置顶分区聚合", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  /** 造一个最小 Session（仅置顶/分组/排序相关字段） */
  const mkSession = (id: string, over: Record<string, any> = {}) =>
    ({
      id,
      title: id,
      sessionType: "web",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
      ...over,
    }) as any;

  it("置顶会话从所属分组区排除（互斥，不重复展示）", () => {
    const store = useSessionStore();
    store.setSession(mkSession("a", { groupId: "g1", lastActiveAt: "2026-01-03T00:00:00.000Z" }));
    store.setSession(mkSession("b", { groupId: "g1", pinned: true, lastActiveAt: "2026-01-02T00:00:00.000Z" }));

    expect(store.getSessionsByGroup("g1").map((s) => s.id)).toEqual(["a"]);
    expect(store.getPinnedSessions().map((s) => s.id)).toEqual(["b"]);
  });

  it("未分组区同样排除置顶；getGroupTotal 同步排除", () => {
    const store = useSessionStore();
    store.setSession(mkSession("a"));
    store.setSession(mkSession("b", { pinned: true }));

    expect(store.getSessionsByGroup(null).map((s) => s.id)).toEqual(["a"]);
    expect(store.getGroupTotal(null)).toBe(1);
  });

  it("getPinnedSessions：跨分组聚合、按 lastActiveAt 降序、排除归档与子会话", () => {
    const store = useSessionStore();
    store.setSession(mkSession("p-old", { pinned: true, groupId: "g1", lastActiveAt: "2026-01-01T00:00:00.000Z" }));
    store.setSession(mkSession("p-new", { pinned: true, lastActiveAt: "2026-01-05T00:00:00.000Z" }));
    store.setSession(mkSession("p-archived", { pinned: true, archived: true, lastActiveAt: "2026-01-09T00:00:00.000Z" }));
    store.setSession(mkSession("p-sub", { pinned: true, sessionType: "sub_agent", lastActiveAt: "2026-01-09T00:00:00.000Z" }));

    expect(store.getPinnedSessions().map((s) => s.id)).toEqual(["p-new", "p-old"]);
  });

  it("setSessionPinned：本地翻转 + 立即反映到两个分区", () => {
    const store = useSessionStore();
    store.setSession(mkSession("a", { groupId: "g1" }));
    expect(store.getSessionsByGroup("g1").map((s) => s.id)).toEqual(["a"]);

    store.setSessionPinned("a", true);
    expect(store.getSession("a")!.pinned).toBe(true);
    expect(store.getSessionsByGroup("g1")).toEqual([]);
    expect(store.getPinnedSessions().map((s) => s.id)).toEqual(["a"]);

    store.setSessionPinned("a", false); // 回滚语义
    expect(store.getSessionsByGroup("g1").map((s) => s.id)).toEqual(["a"]);
    expect(store.getPinnedSessions()).toEqual([]);
  });
});

/**
 * 分组分页窗口：
 * 折叠分组时把可见数量重置回首屏条数，从而丢弃「加载更多」出来的会话；
 * 底层 sessionsMap 保留数据，重新展开后再次「加载更多」即可取回。
 */
describe("sessionStore 分组分页窗口", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mkSession = (id: string, over: Record<string, any> = {}) =>
    ({
      id,
      title: id,
      sessionType: "web",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
      ...over,
    }) as any;

  /** 在 g1 造 count 个会话，lastActiveAt 递增（s0 最旧，s{count-1} 最新） */
  const seedGroup = (store: ReturnType<typeof useSessionStore>, count: number) => {
    for (let i = 0; i < count; i++) {
      store.setSession(
        mkSession(`s${i}`, {
          groupId: "g1",
          lastActiveAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      );
    }
  };

  it("getVisibleSessionsByGroup 按窗口截断，getSessionsByGroup 仍返回全部", () => {
    const store = useSessionStore();
    seedGroup(store, 5);
    store.setLoadedCount("g1", 2);

    expect(store.getVisibleSessionsByGroup("g1").map((s) => s.id)).toEqual(["s4", "s3"]);
    expect(store.getSessionsByGroup("g1")).toHaveLength(5);
  });

  it("折叠重置窗口后，加载更多的会话不再可见且仍可继续加载", () => {
    const store = useSessionStore();
    seedGroup(store, 5);
    store.setLoadedCount("g1", 5);
    store.setHasMore("g1", false);

    store.resetGroupPagination("g1", 2);

    expect(store.getVisibleSessionsByGroup("g1").map((s) => s.id)).toEqual(["s4", "s3"]);
    // 被截掉的会话还在本地，重新展开后需要「加载更多」才能取回
    expect(store.groupHasMore("g1")).toBe(true);
  });

  it("未加载更多时折叠不改变 hasMore", () => {
    const store = useSessionStore();
    seedGroup(store, 2);
    store.setLoadedCount("g1", 2);
    store.setHasMore("g1", false);

    store.resetGroupPagination("g1", 2);

    expect(store.groupHasMore("g1")).toBe(false);
    expect(store.getVisibleSessionsByGroup("g1")).toHaveLength(2);
  });

  it("未分组使用 UNGROUPED_ID 作为分页 key", () => {
    const store = useSessionStore();
    for (let i = 0; i < 3; i++) {
      store.setSession(
        mkSession(`u${i}`, { lastActiveAt: `2026-02-0${i + 1}T00:00:00.000Z` }),
      );
    }
    store.setLoadedCount(UNGROUPED_ID, 1);

    expect(store.getVisibleSessionsByGroup(null).map((s) => s.id)).toEqual(["u2"]);
  });

  it("新插入/移入的会话会扩大窗口，避免被分页误藏", () => {
    const store = useSessionStore();
    seedGroup(store, 2);
    store.setLoadedCount("g1", 2);

    // 新会话进入已建窗口的分组 → 窗口 +1
    store.setSession(
      mkSession("s-new", { groupId: "g1", lastActiveAt: "2026-03-01T00:00:00.000Z" }),
    );
    expect(store.getVisibleSessionsByGroup("g1")).toHaveLength(3);

    // 从其他分组移入 → 目标组窗口 +1
    store.setSession(
      mkSession("s-moved", { groupId: "g2", lastActiveAt: "2026-03-02T00:00:00.000Z" }),
    );
    store.moveSession("s-moved", "g1");

    expect(store.getVisibleSessionsByGroup("g1").map((s) => s.id)).toContain("s-moved");
    expect(store.getVisibleSessionsByGroup("g1")).toHaveLength(4);
  });

  it("初始为空的分组后来新增会话不被截断", () => {
    const store = useSessionStore();
    store.setLoadedCount("g-empty", 0);
    store.setSession(mkSession("s1", { groupId: "g-empty" }));

    expect(store.getVisibleSessionsByGroup("g-empty").map((s) => s.id)).toEqual(["s1"]);
  });

  it("取消置顶的会话重新进入分组时扩大窗口", () => {
    const store = useSessionStore();
    seedGroup(store, 2);
    store.setSession(
      mkSession("pinned", {
        groupId: "g1",
        pinned: true,
        lastActiveAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    store.setLoadedCount("g1", 2);
    expect(store.getVisibleSessionsByGroup("g1")).toHaveLength(2);

    store.setSessionPinned("pinned", false);

    expect(store.getVisibleSessionsByGroup("g1").map((s) => s.id)).toContain("pinned");
    expect(store.getVisibleSessionsByGroup("g1")).toHaveLength(3);
  });
});

/**
 * 目录分组视图（侧栏「目录」模式）：
 * 归属键完全来自后端下发的 workspaceKey / pathKey，前端不做路径归一化；
 * 未匹配（空键、未注册目录）统一落虚拟「通用」桶。
 */
describe("sessionStore 目录分组视图", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mk = (id: string, over: Record<string, any> = {}) =>
    ({
      id,
      title: id,
      sessionType: "web",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
      ...over,
    }) as any;

  const groups = [
    {
      id: "pg-a",
      name: "alpha",
      path: "D:\AI\alpha",
      pathKey: "d:/ai/alpha",
      sortOrder: 0,
      isOverridden: false,
      kind: "workspace",
    },
    {
      id: "__general__",
      name: "",
      path: null,
      pathKey: null,
      sortOrder: Number.MAX_SAFE_INTEGER,
      isOverridden: false,
      kind: "general",
    },
  ] as any;

  it("按 pathKey 精确分桶，按 lastActiveAt 降序，排除置顶/归档/子代理", () => {
    const store = useSessionStore();
    store.setSession(mk("a-old", { workspaceKey: "d:/ai/alpha", lastActiveAt: "2026-01-01T00:00:00.000Z" }));
    store.setSession(mk("a-new", { workspaceKey: "d:/ai/alpha", lastActiveAt: "2026-01-05T00:00:00.000Z" }));
    store.setSession(mk("a-pinned", { workspaceKey: "d:/ai/alpha", pinned: true }));
    store.setSession(mk("a-archived", { workspaceKey: "d:/ai/alpha", archived: true }));
    store.setSession(mk("a-sub", { workspaceKey: "d:/ai/alpha", sessionType: "sub_agent" }));

    expect(store.getSessionsByProjectGroup("pg-a", groups).map((s) => s.id)).toEqual([
      "a-new",
      "a-old",
    ]);
  });

  it("空键 / 未注册目录 / 大小写不符一律落「通用」", () => {
    const store = useSessionStore();
    store.setSession(mk("no-key"));
    store.setSession(mk("unregistered", { workspaceKey: "d:/ai/other" }));
    store.setSession(mk("wrong-case", { workspaceKey: "D:/AI/alpha" }));

    expect(
      store.getSessionsByProjectGroup("__general__", groups).map((s) => s.id).sort(),
    ).toEqual(["no-key", "unregistered", "wrong-case"]);
  });

  it("可见窗口按目录桶 id 截断", () => {
    const store = useSessionStore();
    store.setSession(mk("a1", { workspaceKey: "d:/ai/alpha", lastActiveAt: "2026-01-02T00:00:00.000Z" }));
    store.setSession(mk("a2", { workspaceKey: "d:/ai/alpha", lastActiveAt: "2026-01-01T00:00:00.000Z" }));

    expect(store.getVisibleSessionsByProjectGroup("pg-a", groups)).toHaveLength(2);
    store.setLoadedCount("pg-a", 1);
    expect(store.getVisibleSessionsByProjectGroup("pg-a", groups).map((s) => s.id)).toEqual([
      "a1",
    ]);
  });
});

/** 队列快照投影（M3：服务端权威） */
describe("sessionStore 队列快照投影", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function snapshot(overrides: Partial<UserQueueSnapshot> = {}): UserQueueSnapshot {
    return {
      sessionId: "s1",
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
      ...overrides,
    };
  }

  it("应用快照：整块替换并映射 UI 视图（createdAt → 毫秒）", () => {
    const store = useSessionStore();
    expect(store.applyQueueSnapshot("s1", snapshot())).toBe(true);

    const queue = store.getMessageQueue("s1");
    expect(queue.map((m) => m.content)).toEqual(["A", "B"]);
    expect(queue.map((m) => m.status)).toEqual(["queued", "running"]);
    expect(queue[0].createdAt).toBe(Date.parse("2026-10-25T00:00:00.000Z"));
    expect(store.peekQueueLength("s1")).toBe(2);
    expect(store.peekQueueCount("s1")).toBe(2);
  });

  it("revision 旧快照丢弃；epoch 变化后重新接受", () => {
    const store = useSessionStore();
    expect(store.applyQueueSnapshot("s1", snapshot({ revision: 5 }))).toBe(true);
    // 旧 revision 丢弃
    expect(
      store.applyQueueSnapshot(
        "s1",
        snapshot({
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
      ),
    ).toBe(false);
    expect(store.getMessageQueue("s1")[0].content).toBe("A");

    // 后端重启（epoch 变化）：revision 归零也要接受
    expect(
      store.applyQueueSnapshot(
        "s1",
        snapshot({
          epoch: "epoch-2",
          revision: 1,
          items: [
            {
              id: "c",
              content: "C",
              files: [],
              status: "queued",
              createdAt: "2026-10-25T00:00:02.000Z",
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(store.getMessageQueue("s1").map((m) => m.content)).toEqual(["C"]);
  });

  it("暂停原因、promotion、失败原因透传", () => {
    const store = useSessionStore();
    store.applyQueueSnapshot(
      "s1",
      snapshot({
        paused: { reason: "stopped", at: "2026-10-25T00:00:00.000Z" },
        promotionId: "b",
        items: [
          {
            id: "b",
            content: "B",
            files: [],
            status: "failed",
            error: "boom",
            createdAt: "2026-10-25T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(store.queuePauseReason("s1")).toBe("stopped");
    expect(store.queuePromotionId("s1")).toBe("b");
    expect(store.getMessageQueue("s1")[0]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });

  it("计数快照整体替换；removeSession 清理计数", () => {
    const store = useSessionStore();
    store.setQueueCounts({ s1: 2, s2: 1 });
    expect(store.peekQueueCount("s1")).toBe(2);
    expect(store.peekQueueCount("s2")).toBe(1);

    // 未列出的会话即无排队
    store.setQueueCounts({ s1: 3 });
    expect(store.peekQueueCount("s2")).toBe(0);

    store.removeSession("s1");
    expect(store.peekQueueCount("s1")).toBe(0);
  });

  it("getMessageQueue 对未缓存会话返回空数组且不创建缓存", () => {
    const store = useSessionStore();
    expect(store.getMessageQueue("missing")).toEqual([]);
    expect(store.peekStreamStatus("missing")).toBeUndefined();
  });
});
