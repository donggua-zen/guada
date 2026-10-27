import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionService } from "./session.service";
import {
  GENERAL_PROJECT_GROUP_ID,
  SessionMetaStore,
} from "./session-meta.store";
import { normalizeWorkspaceKey } from "../../common/utils/workspace-key.util";

/**
 * 侧栏「目录模式」分桶契约：
 * - 已注册目录 → 各自分组；未注册目录 / 空路径 → 虚拟「通用」桶
 * - 分组区排除置顶与归档；分页按桶走 projectGroupId
 * - 通用桶 id 是协议常量 `__general__`
 */
describe("SessionService 侧栏目录分组", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let store: SessionMetaStore;
  let service: SessionService;
  let streaming: Set<string>;

  const projectA = path.resolve("/proj/alpha");
  const projectB = path.resolve("/proj/unregistered");
  const autoDir = path.resolve("/work/WORK-2026-07-28-XvZL");

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-group-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  afterEach(() => {
    // Windows 下未关闭的连接会锁住 _meta.db，导致下一轮 rmSync EPERM
    store?.onModuleDestroy();
  });

  beforeEach(async () => {
    fs.rmSync(sessionsBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.mkdirSync(sessionsBase, { recursive: true });
    store = new SessionMetaStore();
    await store.initialize();

    streaming = new Set();

    service = new SessionService(
      store,
      { findById: async () => null, findManyByIds: async () => new Map() } as any,
      {} as any,
      {} as any,
      {} as any,
      { clearSessionTurns: async () => undefined } as any,
      { toResourceAbsoluteUrl: (u: string) => u } as any,
      {} as any,
      {} as any,
      { stopWatchingSession: () => undefined } as any,
      { hasActiveStream: (id: string) => streaming.has(id) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getGroups: async () => [] } as any,
    );

    await store.create({
      id: "a1",
      title: "A1",
      sessionType: "web",
      workspacePath: projectA,
      lastActiveAt: "2026-01-05T00:00:00.000Z",
    });
    await store.create({
      id: "a2",
      title: "A2",
      sessionType: "web",
      workspacePath: projectA,
      lastActiveAt: "2026-01-04T00:00:00.000Z",
    });
    await store.create({
      id: "b1",
      title: "B1（未注册）",
      sessionType: "web",
      workspacePath: projectB,
      lastActiveAt: "2026-01-03T00:00:00.000Z",
    });
    await store.create({
      id: "auto1",
      title: "自动目录",
      sessionType: "web",
      workspacePath: autoDir,
      lastActiveAt: "2026-01-02T00:00:00.000Z",
    });
    await store.create({
      id: "none1",
      title: "无目录",
      sessionType: "web",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
    });
    // 置顶与归档不应出现在分组区
    await store.create({
      id: "pinned1",
      title: "置顶",
      sessionType: "web",
      workspacePath: projectA,
      pinned: true,
    });
    await store.create({
      id: "archived1",
      title: "归档",
      sessionType: "web",
      workspacePath: projectA,
      archived: true,
    });

    await store.ensureProjectGroup({ path: projectA, prepend: false });
  });

  it("已注册目录独立成组，其余全部落「通用」桶", async () => {
    const data = await service.getSidebarSessionsByProject(10);

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]).toMatchObject({
      name: "alpha",
      path: projectA,
      pathKey: normalizeWorkspaceKey(projectA),
      icon: null,
      kind: "workspace",
      isOverridden: false,
    });

    const projectBucket = data.groupSessions.find(
      (g) => g.groupId === data.groups[0].id,
    )!;
    expect(projectBucket.items.map((s) => s.id).sort()).toEqual(["a1", "a2"]);
    expect(projectBucket.total).toBe(2);

    const general = data.groupSessions.find(
      (g) => g.groupId === GENERAL_PROJECT_GROUP_ID,
    )!;
    expect(general.items.map((s) => s.id).sort()).toEqual([
      "auto1",
      "b1",
      "none1",
    ]);
    expect(general.total).toBe(3);
  });

  it("侧栏分组返回自定义图标", async () => {
    const group = (await store.listProjectGroups())[0];
    await store.updateProjectGroup(group.id, { icon: "rocket" });

    const data = await service.getSidebarSessionsByProject(10);
    expect(data.groups[0].icon).toBe("rocket");
  });

  it("按桶分页：分组 / 通用 / 未知 id", async () => {
    const data = await service.getSidebarSessionsByProject(10);
    const projectId = data.groups[0].id;

    const onlyProject = await service.getSessionsByProjectGroup(projectId, 0, 10);
    expect(onlyProject.items.map((s: any) => s.id)).toEqual(["a1", "a2"]);

    const general = await service.getSessionsByProjectGroup(
      GENERAL_PROJECT_GROUP_ID,
      0,
      10,
    );
    expect(general.items.map((s: any) => s.id)).toEqual(["b1", "auto1", "none1"]);

    const unknown = await service.getSessionsByProjectGroup("pg-unknown", 0, 10);
    expect(unknown.items).toEqual([]);
    expect(unknown.total).toBe(0);
  });

  it("重命名只改显示名，不影响成员归属", async () => {    const group = (await store.listProjectGroups())[0];
    await store.updateProjectGroup(group.id, { name: "我的项目" });

    const data = await service.getSidebarSessionsByProject(10);
    expect(data.groups[0].name).toBe("我的项目");
    expect(data.groups[0].isOverridden).toBe(true);

    const bucket = data.groupSessions.find((g) => g.groupId === group.id)!;
    expect(bucket.items.map((s) => s.id).sort()).toEqual(["a1", "a2"]);
  });

  it("没有可见会话的目录不渲染（消除「暂无任务」空分组），但分组行保留", async () => {
    const archivedDir = path.resolve("/proj/archived-only");
    await store.create({
      id: "arch-only",
      title: "已归档",
      sessionType: "web",
      workspacePath: archivedDir,
      archived: true,
    });
    await store.ensureProjectGroup({ path: archivedDir, prepend: false });

    const data = await service.getSidebarSessionsByProject(10);
    expect(data.groups.map((g) => g.path)).not.toContain(archivedDir);
    expect(
      data.groupSessions.some((g) =>
        g.items.some((s) => s.id === "arch-only"),
      ),
    ).toBe(false);

    // 行仍在：取消归档后目录会自动重新出现在侧栏
    expect(
      (await store.listProjectGroups()).some((g) => g.path === archivedDir),
    ).toBe(true);
  });

  // ===== 项目菜单：统计 / 归档 / 删除 =====

  it("stats 只统计 web 会话，区分 active / archived / pinned", async () => {
    const group = (await store.listProjectGroups())[0];
    // projectA: a1 + a2 + pinned1 + archived1
    expect(await service.getProjectGroupStats(group.pathKey)).toEqual({
      total: 4,
      active: 3,
      archived: 1,
      pinned: 1,
    });
  });

  it("归档项目：active 与置顶归档，已归档不变，流式跳过", async () => {
    const group = (await store.listProjectGroups())[0];
    streaming.add("a2");

    const result = await service.archiveProjectGroupSessions(group.pathKey);

    expect(result.archived).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.sessionIds.sort()).toEqual(["a1", "pinned1"].sort());
    expect(store.getMeta("a1")!.archived).toBe(true);
    expect(store.getMeta("pinned1")!.archived).toBe(true);
    expect(store.getMeta("a2")!.archived).toBe(false);
    expect(store.getMeta("archived1")!.archived).toBe(true);
  });

  it("删除项目：删除该目录全部 web 会话（含归档/置顶）并级联子会话，其他目录不受影响", async () => {
    const group = (await store.listProjectGroups())[0];
    await store.create({
      id: "child1",
      title: "子代理",
      sessionType: "sub_agent",
      parentId: "a1",
      workspacePath: projectA,
    });

    const result = await service.deleteProjectGroupSessions(group.pathKey);

    expect(result.sessionIds.sort()).toEqual(
      ["a1", "a2", "archived1", "pinned1"].sort(),
    );
    expect(store.getMeta("a1")).toBeUndefined();
    expect(store.getMeta("child1")).toBeUndefined(); // 随父会话级联
    expect(store.getMeta("b1")).toBeTruthy(); // 其他目录不受影响
    expect(store.getMeta("none1")).toBeTruthy();
  });

  it("删除预检：任一会话或子会话流式 → 409 且一条未删", async () => {
    const group = (await store.listProjectGroups())[0];
    await store.create({
      id: "child2",
      title: "子代理",
      sessionType: "sub_agent",
      parentId: "a1",
      workspacePath: projectA,
    });
    streaming.add("child2");

    await expect(
      service.deleteProjectGroupSessions(group.pathKey),
    ).rejects.toMatchObject({ status: 409 });

    expect(store.getMeta("a1")).toBeTruthy();
    expect(store.getMeta("child2")).toBeTruthy();
    expect(store.getMeta("a2")).toBeTruthy();
    expect(store.getMeta("pinned1")).toBeTruthy();
  });

  it("删除项目保留工作目录与文件", async () => {
    const workspaceDir = path.join(tmpRoot, "ws-preserve");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "keep.txt"), "keep");
    await store.create({
      id: "ws1",
      title: "保留目录",
      sessionType: "web",
      workspacePath: workspaceDir,
    });
    const group = await store.ensureProjectGroup({
      path: workspaceDir,
      prepend: false,
    });

    await service.deleteProjectGroupSessions(group.pathKey);

    expect(store.getMeta("ws1")).toBeUndefined();
    expect(fs.existsSync(path.join(workspaceDir, "keep.txt"))).toBe(true);
  });
});
