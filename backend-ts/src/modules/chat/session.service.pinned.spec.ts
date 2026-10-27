import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionService } from "./session.service";
import { SessionMetaStore } from "./session-meta.store";

/**
 * 置顶（pin）在侧边栏聚合层的契约：
 * - 分组区排除置顶项（pinned:false），且 total 同步排除（分页计数一致）
 * - getPinnedSessions 只归集「已置顶且未归档」，并注入 isStreaming
 */

describe("SessionService 侧边栏置顶聚合", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let store: SessionMetaStore;
  let service: SessionService;
  let streaming: Set<string>;

  const GROUP_ID = "g1";

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pinned-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fs.rmSync(sessionsBase, { recursive: true, force: true });
    fs.mkdirSync(sessionsBase, { recursive: true });
    store = new SessionMetaStore();
    await store.initialize();

    streaming = new Set();

    service = new SessionService(
      store,
      { findById: async () => null, findManyByIds: async () => new Map() } as any, // agentStore
      {} as any, // modelStore
      {} as any, // settingsStorage
      {} as any, // llmService
      {} as any, // contextManager
      { toResourceAbsoluteUrl: (u: string) => u } as any, // urlService
      {} as any, // workspaceService
      {} as any, // sessionContextFactory
      {} as any, // workspaceWatcherService
      { hasActiveStream: (id: string) => streaming.has(id) } as any, // streamManager
      {} as any, // compactionCoordinator
      {} as any, // eventBus
      {} as any, // sessionReplayService
      {} as any, // contentSearch
      {
        getGroups: async () => [
          {
            id: GROUP_ID,
            name: "默认分组",
            sortOrder: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      } as any, // sessionGroupService
    );

    await store.create({
      id: "g-normal",
      title: "分组内普通",
      sessionType: "web",
      groupId: GROUP_ID,
      lastActiveAt: "2026-01-03T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    await store.create({
      id: "g-pinned",
      title: "分组内置顶",
      sessionType: "web",
      groupId: GROUP_ID,
      pinned: true,
      lastActiveAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    await store.create({
      id: "u-pinned",
      title: "未分组置顶",
      sessionType: "web",
      pinned: true,
      lastActiveAt: "2026-01-04T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    });
    await store.create({
      id: "a-pinned",
      title: "已归档置顶（不应出现）",
      sessionType: "web",
      archived: true,
      pinned: true,
      lastActiveAt: "2026-01-05T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  it("getSidebarSessions：分组区排除置顶项，total 同步排除", async () => {
    const res = await service.getSidebarSessions(10);

    const g1 = res.groupSessions.find((g) => g.groupId === GROUP_ID)!;
    expect(g1.items.map((i: any) => i.id)).toEqual(["g-normal"]);
    expect(g1.total).toBe(1); // 置顶的 g-pinned 不计入分组 total
    expect(g1.hasMore).toBe(false);

    const ungrouped = res.groupSessions.find((g) => g.groupId === null)!;
    expect(ungrouped.items.map((i: any) => i.id)).toEqual([]);
    expect(ungrouped.total).toBe(0); // u-pinned 是置顶 → 不在分组区
  });

  it("getPinnedSessions：只归集未归档的置顶会话，按 lastActiveAt desc", async () => {
    const res = await service.getPinnedSessions();
    expect(res.items.map((i: any) => i.id)).toEqual(["u-pinned", "g-pinned"]);
  });

  it("getPinnedSessions：注入 isStreaming", async () => {
    streaming.add("g-pinned");
    const res = await service.getPinnedSessions();
    const byId = new Map(res.items.map((i: any) => [i.id, i]));
    expect((byId.get("g-pinned") as any).isStreaming).toBe(true);
    expect((byId.get("u-pinned") as any).isStreaming).toBe(false);
  });

  it("getSessions（侧边栏加载更多）：同样排除置顶项，分页槽位不被占用", async () => {
    // 分组内：g-pinned（置顶，lastActive 较新）与 g-normal 同组
    // 若不过滤，limit=1 时首页会拿到置顶项 → 前端过滤后显示为空
    const first = await service.getSessions(0, 1, GROUP_ID);
    expect(first.items.map((i: any) => i.id)).toEqual(["g-normal"]);
    expect(first.total).toBe(1);

    const all = await service.getSessions(0, 10, null);
    expect(all.items.map((i: any) => i.id)).toEqual([]);
    expect(all.total).toBe(0);
  });

  it("updateSession 白名单接受 pinned", async () => {
    await service.updateSession("u-pinned", { pinned: false });
    expect(store.getMeta("u-pinned")!.pinned).toBe(false);
    expect((await service.getPinnedSessions()).items.map((i: any) => i.id)).toEqual([
      "g-pinned",
    ]);
  });
});
