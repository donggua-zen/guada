import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionGroupService } from "./session-group.service";
import { SessionMetaStore } from "./session-meta.store";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";

/**
 * 手工分组「归档本分组」契约：
 * - 组内全部 web 会话归档（置顶也归档、已归档跳过、流式跳过）
 * - 分组行保留；组外会话不受影响
 * - 返回成功归档的 id，供前端精确清理本地缓存
 */
describe("SessionGroupService 归档本分组", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let store: SessionMetaStore;
  let service: SessionGroupService;
  let groupId: string;
  const streaming = new Set<string>();

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-group-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  afterEach(() => {
    store?.onModuleDestroy();
  });

  beforeEach(async () => {
    fs.rmSync(sessionsBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.mkdirSync(sessionsBase, { recursive: true });

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = new SessionMetaStore(gate);
    await store.initialize();
    streaming.clear();

    service = new SessionGroupService(store, {
      hasActiveStream: (id: string) => streaming.has(id),
    } as any);

    const group = await store.createGroup({ name: "开发", sortOrder: 0 });
    groupId = group.id;

    await store.create({ id: "a1", sessionType: "web", groupId });
    await store.create({ id: "a2", sessionType: "web", groupId, pinned: true });
    await store.create({ id: "arch", sessionType: "web", groupId, archived: true });
    await store.create({ id: "stream", sessionType: "web", groupId });
    // 组外会话：不受影响
    await store.create({ id: "other", sessionType: "web" });
  });

  it("stats 只统计组内 web 会话，区分 active / archived / pinned", async () => {
    expect(await service.getStats(groupId)).toEqual({
      total: 4,
      active: 3,
      archived: 1,
      pinned: 1,
    });
  });

  it("归档本分组：active 与置顶归档，已归档不变，流式跳过", async () => {
    streaming.add("stream");

    const result = await service.archiveGroup(groupId);

    expect(result.archived).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.sessionIds.sort()).toEqual(["a1", "a2"]);
    expect(store.getMeta("a1")!.archived).toBe(true);
    expect(store.getMeta("a2")!.archived).toBe(true);
    expect(store.getMeta("stream")!.archived).toBe(false);
    expect(store.getMeta("arch")!.archived).toBe(true);
  });

  it("归档本分组不影响组外会话，分组行保留", async () => {
    await service.archiveGroup(groupId);

    expect(store.getMeta("other")!.archived).toBe(false);
    expect(await store.findGroupById(groupId)).toBeTruthy();
  });

  it("分组不存在时 404", async () => {
    await expect(service.archiveGroup("grp-missing")).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.getStats("grp-missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
