import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/types/session";
import {
  applySidebarSnapshot,
  type SidebarSnapshotSessionStore,
} from "./sidebarSnapshot";

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    groupId: null,
    pinned: false,
    archived: false,
    sessionType: "web",
    isStreaming: false,
    ...patch,
  } as Session;
}

function createStores(initial: Session[]) {
  const map = new Map(initial.map((s) => [s.id, s]));
  const sessionStore: SidebarSnapshotSessionStore = {
    sessionsMap: map,
    mergeSession: vi.fn((next: Session) => {
      const existing = map.get(next.id);
      if (existing) Object.assign(existing, next);
      else map.set(next.id, next);
    }),
    setSession: vi.fn((next: Session) => {
      map.set(next.id, next);
    }),
    syncStreamingState: vi.fn(),
    dropSidebarSessions: vi.fn(
      (keepIds: ReadonlySet<string>, activeSessionId?: string | null) => {
        const removed: string[] = [];
        for (const [id, s] of map) {
          if (keepIds.has(id) || id === activeSessionId) continue;
          if (s.sessionType === "bot" || s.sessionType === "sub_agent") continue;
          map.delete(id);
          removed.push(id);
        }
        return removed;
      },
    ),
    clearPinnedExcept: vi.fn((pinnedIds: ReadonlySet<string>) => {
      for (const [id, s] of map) {
        if (s.pinned && !pinnedIds.has(id)) s.pinned = false;
      }
    }),
    setLoadedCount: vi.fn(),
    setHasMore: vi.fn(),
  };
  const sessionGroupStore = {
    setGroups: vi.fn(),
    setProjectGroups: vi.fn(),
  };
  return { sessionStore, sessionGroupStore, map };
}

describe("applySidebarSnapshot", () => {
  it("手工分组：替换分组、置顶以服务端为准、剪除已归档/移出窗口的会话", () => {
    const { sessionStore, sessionGroupStore, map } = createStores([
      session("g1-a", { groupId: "g1" }),
      session("g1-old", { groupId: "g1" }),
      session("pin-old", { pinned: true }),
      session("archived", { archived: true }),
      session("bot", { sessionType: "bot" }),
      session("active"),
    ]);

    const groups = [
      { id: "g1", name: "改名", sortOrder: 0, icon: "code", createdAt: "", updatedAt: "" },
    ];
    const result = applySidebarSnapshot(
      { sessionStore, sessionGroupStore },
      {
        mode: "group",
        groups,
        buckets: [
          {
            bucketId: "g1",
            items: [session("g1-a", { groupId: "g1", title: "新标题" })],
            hasMore: true,
          },
          { bucketId: "__ungrouped__", items: [], hasMore: false },
        ],
        pinned: [session("pin-new", { pinned: true })],
        activeSessionId: "active",
      },
    );

    expect(sessionGroupStore.setGroups).toHaveBeenCalledWith(groups);
    expect(sessionGroupStore.setProjectGroups).not.toHaveBeenCalled();
    expect(map.get("g1-a")?.title).toBe("新标题");
    // pin-old 不再置顶且不在任何分组窗口内 → 侧栏投影被剪除
    expect(map.has("pin-old")).toBe(false);
    expect(map.get("pin-new")?.pinned).toBe(true);
    expect(map.has("g1-old")).toBe(false);
    expect(map.has("archived")).toBe(false);
    expect(map.has("bot")).toBe(true);
    expect(map.has("active")).toBe(true);
    expect(result.removedSessionIds.sort()).toEqual([
      "archived",
      "g1-old",
      "pin-old",
    ]);
    expect(sessionStore.setLoadedCount).toHaveBeenCalledWith("g1", 1);
    expect(sessionStore.setHasMore).toHaveBeenCalledWith("g1", true);
    expect(sessionStore.setLoadedCount).toHaveBeenCalledWith("__ungrouped__", 0);
  });

  it("目录分组：走 setProjectGroups，桶 key 支持 __general__", () => {
    const { sessionStore, sessionGroupStore } = createStores([]);
    const groups = [
      {
        id: "p1",
        name: "项目",
        path: "/p1",
        pathKey: "p1",
        sortOrder: 0,
        isOverridden: false,
        icon: null,
      },
    ];

    applySidebarSnapshot(
      { sessionStore, sessionGroupStore },
      {
        mode: "workspace",
        groups,
        buckets: [
          { bucketId: "p1", items: [session("s1")], hasMore: false },
          { bucketId: "__general__", items: [session("s2")], hasMore: false },
        ],
        pinned: [],
      },
    );

    expect(sessionGroupStore.setProjectGroups).toHaveBeenCalledWith(groups);
    expect(sessionGroupStore.setGroups).not.toHaveBeenCalled();
    expect(sessionStore.setLoadedCount).toHaveBeenCalledWith("p1", 1);
    expect(sessionStore.setLoadedCount).toHaveBeenCalledWith("__general__", 1);
  });

  it("置顶接口失败（pinned=null）时不清本地置顶、不误删置顶会话", () => {
    const { sessionStore, sessionGroupStore, map } = createStores([
      session("pin-local", { pinned: true }),
    ]);

    applySidebarSnapshot(
      { sessionStore, sessionGroupStore },
      {
        mode: "group",
        groups: [],
        buckets: [],
        pinned: null,
      },
    );

    expect(sessionStore.clearPinnedExcept).not.toHaveBeenCalled();
    expect(map.get("pin-local")?.pinned).toBe(true);
    expect(map.has("pin-local")).toBe(true);
  });

  it("isStreaming 会话同步流状态；已存在走 merge，新会话走 set", () => {
    const { sessionStore, sessionGroupStore } = createStores([
      session("existing", { title: "旧" }),
    ]);

    applySidebarSnapshot(
      { sessionStore, sessionGroupStore },
      {
        mode: "group",
        groups: [],
        buckets: [
          {
            bucketId: "__ungrouped__",
            items: [
              session("existing", { title: "新", isStreaming: true }),
              session("new", { isStreaming: true }),
            ],
            hasMore: false,
          },
        ],
        pinned: [],
        activeSessionId: null,
      },
    );

    expect(sessionStore.mergeSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing", title: "新" }),
    );
    expect(sessionStore.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new" }),
    );
    expect(sessionStore.syncStreamingState).toHaveBeenCalledWith(
      "existing",
      true,
    );
    expect(sessionStore.syncStreamingState).toHaveBeenCalledWith("new", true);
  });
});
