import type { ProjectGroup, Session, SessionGroup } from "@/types/session";

/**
 * 侧栏快照对账（手工分组 / 目录分组）。
 *
 * 服务端返回的是“当前账户侧栏的权威投影”：
 * - 分组列表整体替换（排序、改名、图标、增删一次生效）
 * - 置顶清单整体替换（不再置顶的会话清掉 pinned）
 * - 每个桶只返回本次请求窗口内的会话；据此剪除已删除/已归档/移出窗口的本地投影
 *
 * 只动侧栏投影，不清消息缓存；当前会话与 bot/sub_agent 会话不参与剪除。
 */
export interface SidebarBucketSnapshot {
  /** 侧栏窗口 key：手工模式为分组 id / `__ungrouped__`；目录模式为目录桶 id / `__general__` */
  bucketId: string;
  items: Session[];
  hasMore: boolean;
}

export interface SidebarSnapshotInput {
  mode: "group" | "workspace";
  /** 手工模式为 SessionGroup[]；目录模式为 ProjectGroup 投影（不含虚拟「通用」桶） */
  groups: Array<SessionGroup | Omit<ProjectGroup, "kind">>;
  buckets: SidebarBucketSnapshot[];
  /** null = 置顶接口失败，跳过置顶对账，保留本地置顶状态 */
  pinned: Session[] | null;
  activeSessionId?: string | null;
}

/** 只依赖对账所需的 store 能力，便于单测用轻量假对象 */
export interface SidebarSnapshotSessionStore {
  sessionsMap: Map<string, Session>;
  mergeSession(session: Session): void;
  setSession(session: Session): void;
  syncStreamingState(sessionId: string, isStreaming: boolean): void;
  dropSidebarSessions(
    keepIds: ReadonlySet<string>,
    activeSessionId?: string | null,
  ): string[];
  clearPinnedExcept(pinnedIds: ReadonlySet<string>): void;
  setLoadedCount(bucketId: string, count: number): void;
  setHasMore(bucketId: string, hasMore: boolean): void;
}

export interface SidebarSnapshotGroupStore {
  setGroups(groups: SessionGroup[]): void;
  setProjectGroups(groups: Array<Omit<ProjectGroup, "kind">>): void;
}

export interface SidebarSnapshotStores {
  sessionStore: SidebarSnapshotSessionStore;
  sessionGroupStore: SidebarSnapshotGroupStore;
}

/**
 * 应用一次侧栏快照，返回被剪除的会话 id（便于调用方清理其它旁路缓存）。
 */
export function applySidebarSnapshot(
  stores: SidebarSnapshotStores,
  input: SidebarSnapshotInput,
): { removedSessionIds: string[] } {
  const { sessionStore, sessionGroupStore } = stores;

  // 1. 分组元数据整体替换
  if (input.mode === "workspace") {
    sessionGroupStore.setProjectGroups(
      input.groups as Array<Omit<ProjectGroup, "kind">>,
    );
  } else {
    sessionGroupStore.setGroups(input.groups as SessionGroup[]);
  }

  // 2. 汇总本次快照覆盖的会话 id，作为剪除白名单
  const keepIds = new Set<string>();
  for (const bucket of input.buckets) {
    for (const session of bucket.items) keepIds.add(session.id);
  }
  const pinnedIds = input.pinned
    ? new Set(input.pinned.map((session) => session.id))
    : null;
  if (input.pinned) {
    for (const session of input.pinned) keepIds.add(session.id);
  } else {
    // 置顶接口失败：本地已置顶的会话不能因为“不在分组桶里”被误删
    for (const [id, session] of sessionStore.sessionsMap) {
      if (session.pinned) keepIds.add(id);
    }
  }

  // 3. 应用会话：已存在的合并（保留前端注入字段），新的走 setSession
  const applySession = (session: Session): void => {
    if (sessionStore.sessionsMap.has(session.id)) {
      sessionStore.mergeSession(session);
    } else {
      sessionStore.setSession(session);
    }
    if (session.isStreaming) {
      sessionStore.syncStreamingState(session.id, true);
    }
  };

  for (const bucket of input.buckets) {
    for (const session of bucket.items) applySession(session);
  }
  if (input.pinned) {
    // 置顶清单以服务端为准：先清掉本地已不在清单里的 pinned，再写入本次清单
    sessionStore.clearPinnedExcept(pinnedIds!);
    for (const session of input.pinned) applySession(session);
  }

  // 4. 剪除已删除/已归档/移出当前窗口的侧栏投影（消息缓存不动）
  const removedSessionIds = sessionStore.dropSidebarSessions(
    keepIds,
    input.activeSessionId,
  );

  // 5. 分页窗口以本次快照为准
  for (const bucket of input.buckets) {
    sessionStore.setLoadedCount(bucket.bucketId, bucket.items.length);
    sessionStore.setHasMore(bucket.bucketId, bucket.hasMore);
  }

  return { removedSessionIds };
}
