import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { sessionRowToMeta } from "../../common/database/bootstrap/session-meta-mapping";
import {
  META_DB_FILE,
  SESSION_ID_PREFIX,
  SessionMetaStore,
  isMetaDbMigrated,
  importSessionMetaRows,
  markMetaDbMigrated,
  openMetaDb,
  readMetaRow,
  replaceAllGroups,
  upsertMetaRow,
} from "./session-meta.store";

/**
 * 会话元数据存储（sessions/_meta.db）契约测试
 *
 * 覆盖：冻结主库行 → 库的一次性转换（含幂等门控）、CRUD 与结构化查询、
 * root_id 解析、data 扩展位、schema 迁移（v1 与误标记 v2 两种自愈）、
 * 孤儿/幽灵收敛、分组 CRUD、id 铸造与路径安全（原文件版 store 的回归点）。
 */
describe("SessionMetaStore", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let gate: MetadataBootstrapGate;
  let store: SessionMetaStore;

  const sessionDir = (id: string) => path.join(sessionsBase, id);
  const dbPath = () => path.join(sessionsBase, META_DB_FILE);

  /** 只读原始连接（断言 schema/标记；不经 openMetaDb，避免触发迁移） */
  const rawDb = () => new Database(dbPath(), { readonly: true });

  const writeEventLog = (id: string, events: any[]) => {
    fs.mkdirSync(sessionDir(id), { recursive: true });
    const body = events
      .map((e, i) => JSON.stringify({ seq: i, time: 1700000000000 + i, ...e }))
      .join("\n");
    fs.writeFileSync(path.join(sessionDir(id), "seg-0000.jsonl"), body);
  };

  /** 冻结主库 session 行的形状（Prisma 列名；character_id 即 agentId） */
  const dbRow = (id: string, over: Record<string, any> = {}) => ({
    id,
    title: `会话 ${id}`,
    avatarUrl: null,
    description: null,
    modelId: null,
    characterId: null,
    groupId: null,
    settings: { thinkingEnabled: true },
    sessionType: "web",
    archived: false,
    botId: null,
    platform: null,
    externalId: null,
    workspacePath: null,
    parentId: null,
    closedAt: null,
    closeReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    lastActiveAt: new Date("2026-01-02T00:00:00.000Z"),
    ...over,
  });

  const newStore = () => new SessionMetaStore(gate);

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-meta-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot; // → sessionsBase = <tmpRoot>/sessions
    gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = newStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("冻结主库 → _meta.db 一次性转换", () => {
    it("转换行与分组，回填 root_id，并落库内标记（幂等）", async () => {
      const db = openMetaDb(sessionsBase);
      try {
        importSessionMetaRows(
          db,
          [
            sessionRowToMeta(dbRow("sess-parent")),
            sessionRowToMeta(
              dbRow("sess-child", {
                parentId: "sess-parent",
                sessionType: "sub_agent",
                closedAt: new Date("2026-01-03T00:00:00.000Z"),
                closeReason: "done",
              }),
            ),
          ],
          [{ id: "grp-1", name: "工作", sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
        );
        expect(isMetaDbMigrated(db)).toBe(false);
        markMetaDbMigrated(db);
        expect(isMetaDbMigrated(db)).toBe(true);
      } finally {
        db.close();
      }

      // 目录：行存在则目录也必须在（否则幽灵清理会删行）
      fs.mkdirSync(sessionDir("sess-parent"), { recursive: true });
      fs.mkdirSync(sessionDir("sess-child"), { recursive: true });

      await store.initialize();
      expect(store.query({}).length).toBe(2);
      const child = store.getMeta("sess-child")!;
      expect(child.parentId).toBe("sess-parent");
      expect(child.rootId).toBe("sess-parent");
      expect(child.closedAt).toBe("2026-01-03T00:00:00.000Z");
      expect(store.getMeta("sess-parent")!.rootId).toBeNull();
      // settings 从主库行折入 data.settings
      expect(store.getMeta("sess-parent")!.settings).toEqual({ thinkingEnabled: true });
      // 分组随转换落库
      expect((await store.listGroups()).map((g) => g.id)).toEqual(["grp-1"]);
      // 行视图 Date 形状（对齐旧 Prisma 返回）
      expect(store.get("sess-parent")!.createdAt).toBeInstanceOf(Date);
    });

    it("库文件被删后转换标记随之消失（重转入口），重开实例得到空库", async () => {
      const db = openMetaDb(sessionsBase);
      importSessionMetaRows(db, [sessionRowToMeta(dbRow("a1"))], []);
      markMetaDbMigrated(db);
      db.close();
      fs.mkdirSync(sessionDir("a1"), { recursive: true });

      store.onModuleDestroy();
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${dbPath()}${suffix}`, { force: true });
      }

      store = newStore();
      await store.initialize();
      // 空库（重开时文件被重建）且转换标记为空 → 下次启动会从主库重转
      expect(store.query({}).length).toBe(0);
      const probe = rawDb();
      expect(isMetaDbMigrated(probe)).toBe(false);
      probe.close();
    });
  });

  describe("CRUD 与 root_id 解析", () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it("create：目录与行同时落，lastActiveAt 默认当前时间", async () => {
      const row = await store.create({ title: "新会话", sessionType: "web" });
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(fs.existsSync(sessionDir(String(row.id)))).toBe(true);
      expect(store.getMeta(String(row.id))!.lastActiveAt).toBeTruthy();
    });

    it("不传 id 时铸造 session-<uuid v4>（绝不落 sessions/undefined）", async () => {
      const row = await store.create({ title: "新会话" });
      expect(String(row.id).startsWith(SESSION_ID_PREFIX)).toBe(true);
      expect(row.id).not.toBe("undefined");
      expect(fs.existsSync(path.join(sessionsBase, "undefined"))).toBe(false);

      const second = await store.create({ title: "第二个" });
      expect(second.id).not.toBe(row.id);
      expect(store.query({}).length).toBe(2);
    });

    it("显式 id 保留原值（主库 cuid 形状）", async () => {
      const row = await store.create({ id: "cmophqvcd0000vckz8xo3hfk1", title: "存量形状" });
      expect(row.id).toBe("cmophqvcd0000vckz8xo3hfk1");
    });

    it.each(["undefined", "null", "../escape", "a/b", "a\\b", ".hidden", "bad:id"])(
      "非法 id %s 被拒绝且不落目录",
      async (bad) => {
        await expect(store.create({ id: bad })).rejects.toThrow(/Invalid session id/);
        expect(fs.existsSync(path.join(sessionsBase, bad))).toBe(false);
      },
    );

    it("deleteSession 对非法 id 抛错，不会删到 baseDir 之外", async () => {
      const sentinelDir = path.join(tmpRoot, "sentinel");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "keep.txt"), "keep", "utf8");

      await expect(store.deleteSession("../sentinel")).rejects.toThrow(/Invalid session id/);
      expect(fs.existsSync(path.join(sentinelDir, "keep.txt"))).toBe(true);
    });

    it("create 子会话：rootId = 父会话的 rootId（顶层父则取父 id）", async () => {
      const parent = await store.create({ title: "主", sessionType: "web" });
      const child = await store.create({
        title: "子",
        sessionType: "sub_agent",
        parentId: parent.id,
      });
      expect(store.getMeta(String(child.id))!.rootId).toBe(String(parent.id));
    });

    it("update：undefined 保持原值，null 显式置空", async () => {
      const row = (await store.create({
        title: "原题",
        groupId: "grp-9",
        settings: { thinkingEnabled: true },
      })) as any;

      await store.update(String(row.id), { title: undefined, groupId: null });
      const meta = store.getMeta(String(row.id))!;
      expect(meta.title).toBe("原题");
      expect(meta.groupId).toBeNull();
      expect(meta.settings).toEqual({ thinkingEnabled: true });
    });

    it("data 扩展字段往返（settings 折叠为 data.settings，其余键透传）", async () => {
      const row = (await store.create({
        title: "扩展",
        settings: { thinkingEnabled: false },
        data: { pinned: true, note: "自定义" },
      })) as any;

      const meta = store.getMeta(String(row.id))!;
      expect(meta.settings).toEqual({ thinkingEnabled: false });
      expect(meta.data).toEqual({
        pinned: true,
        note: "自定义",
        settings: { thinkingEnabled: false },
      });

      // data 整体替换语义；settings 键仍以 meta.settings 为准
      await store.update(String(row.id), { data: { pinned: false } });
      const next = store.getMeta(String(row.id))!;
      expect(next.data).toEqual({ pinned: false, settings: { thinkingEnabled: false } });
      expect(next.settings).toEqual({ thinkingEnabled: false });
    });

    it("updateLastActiveAt：单字段更新（updatedAt 与 lastActiveAt 同步刷新）", async () => {
      const row = await store.create({ title: "热写" });
      const before = store.getMeta(String(row.id))!;
      await new Promise((r) => setTimeout(r, 10));
      await store.updateLastActiveAt(String(row.id));
      const after = store.getMeta(String(row.id))!;
      expect(after.lastActiveAt! > before.lastActiveAt!).toBe(true);
      expect(after.updatedAt > before.updatedAt).toBe(true);
    });

    it("deleteSession：目录与行一起删，二次删除返回 false", async () => {
      const row = await store.create({ title: "待删" });
      const id = String(row.id);
      expect(await store.deleteSession(id)).toBe(true);
      expect(fs.existsSync(sessionDir(id))).toBe(false);
      expect(store.has(id)).toBe(false);
      expect(await store.deleteSession(id)).toBe(false);
    });

    it("新实例重开仍能列出既有会话（库为权威）", async () => {
      const row = await store.create({ title: "重启后仍在" });
      store.onModuleDestroy();

      store = newStore();
      await store.initialize();
      expect(store.get(String(row.id))?.title).toBe("重启后仍在");
    });

    /**
     * 手建 v1 物理库（settings 独立列 + 指定 user_version 戳 + 无转换标记）。
     * userVersion 设 2 模拟 dev 热重载误标记场景：物理还是 v1，版本戳已超前。
     */
    const buildLegacyDb = (userVersion: number) => {
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${dbPath()}${suffix}`, { force: true });
      }
      const db = new Database(dbPath());
      try {
        db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_id TEXT, root_id TEXT, session_type TEXT NOT NULL DEFAULT 'web', title TEXT, avatar_url TEXT, description TEXT, model_id TEXT, agent_id TEXT, group_id TEXT, settings TEXT, workspace_path TEXT, bot_id TEXT, platform TEXT, external_id TEXT, archived INTEGER NOT NULL DEFAULT 0, closed_at TEXT, close_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_active_at TEXT);
        CREATE TABLE session_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE _bootstrap (key TEXT PRIMARY KEY, value TEXT);
      `);
        db.prepare(
          `INSERT INTO sessions (id, session_type, title, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run("legacy-1", "web", "旧会话", JSON.stringify({ thinkingEnabled: true }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
        db.pragma(`user_version = ${userVersion}`);
      } finally {
        db.close();
      }
      // 目录存在（无 meta/事件）：仅 SQL 迁移路径生效，幽灵清理不会删行
      fs.mkdirSync(sessionDir("legacy-1"), { recursive: true });
    };

    it.each([
      [1, "v1 库正常迁移"],
      [2, "版本戳误标记 v2 的 v1 物理库自愈（dev 热重载瞬时代码场景）"],
    ])("%s：settings 列折叠进 data，行数据不丢", async (stamp) => {
      store.onModuleDestroy();
      buildLegacyDb(stamp as number);

      store = newStore();
      await store.initialize();

      const meta = store.getMeta("legacy-1")!;
      expect(meta.settings).toEqual({ thinkingEnabled: true });
      expect(meta.data).toEqual({ settings: { thinkingEnabled: true } });

      const probe = rawDb();
      const cols = (probe.pragma("table_info(sessions)") as any[]).map((c) => c.name);
      const version = probe.pragma("user_version", { simple: true });
      probe.close();
      expect(cols).toContain("data");
      expect(cols).not.toContain("settings");
      // v4：pinned 列（置顶）由迁移补齐
      expect(cols).toContain("pinned");
      expect(version).toBe(4);
    });
  });

  describe("查询过滤与排序", () => {
    beforeEach(async () => {
      await store.initialize();
      await store.create({ id: "a1", title: "Alpha 项目", sessionType: "web", groupId: "g1", lastActiveAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      await store.create({ id: "a2", title: "beta 计划", sessionType: "web", groupId: "g1", archived: true, lastActiveAt: "2026-01-04T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-06T00:00:00.000Z" });
      await store.create({ id: "a3", title: "未分组会话", sessionType: "web", lastActiveAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" });
      await store.create({ id: "s1", title: "子代理", sessionType: "sub_agent", parentId: "a1" });
      await store.create({ id: "s2", title: "frozen", sessionType: "sub_agent", parentId: "a1", closedAt: "2026-01-02T00:00:00.000Z", closeReason: "done" });
    });

    it("sessionType + archived 组合过滤", () => {
      const ids = store.query({ sessionType: "web", archived: false }).map((m) => m.id);
      expect(ids).toEqual(["a1", "a3"]); // lastActiveDesc
    });

    it("groupId tri-state：null 仅未分组，undefined 不过滤", () => {
      expect(store.query({ sessionType: "web", groupId: null }).map((m) => m.id)).toEqual(["a3"]);
      expect(store.query({ sessionType: "web", groupId: "g1" }).map((m) => m.id)).toEqual(["a1", "a2"]);
      expect(store.query({ sessionType: "web" })).toHaveLength(3);
    });

    it("keyword 大小写不敏感子串匹配标题", () => {
      expect(store.query({ sessionType: "web", keyword: "ALPHA" }).map((m) => m.id)).toEqual(["a1"]);
      expect(store.query({ sessionType: "web", keyword: "会话" }).map((m) => m.id)).toEqual(["a3"]);
    });

    it("LIKE 通配符不注入（% 与 _ 按字面匹配）", () => {
      expect(store.query({ keyword: "%" })).toHaveLength(0);
      expect(store.query({ keyword: "_" })).toHaveLength(0);
    });

    it("parentId 过滤与 childrenOf（升序，Date 行形状）", () => {
      expect(
        store.query({ parentId: "a1" }, "createdAsc").map((m) => m.id),
      ).toEqual(["s1", "s2"]);
      const children = store.childrenOf("a1");
      expect(children.map((c) => c.id)).toEqual(["s1", "s2"]);
      expect(children[0].createdAt).toBeInstanceOf(Date);
    });

    it("countByParentId 排除已冻结（closedAt 非空）子会话", () => {
      expect(store.countByParentId("a1")).toBe(1);
    });

    it("updatedDesc 排序（归档列表用）", () => {
      const ids = store
        .query({ sessionType: "web", archived: true }, "updatedDesc")
        .map((m) => m.id);
      expect(ids).toEqual(["a2"]);
    });

    it("listWebSessionIds 排除归档；getManyByIds 保序", () => {
      expect(store.listWebSessionIds()).toEqual(["a1", "a3"]);
      expect(store.listWebSessionIds(true)).toEqual(["a1", "a2", "a3"]);
      expect(store.getManyByIds(["a3", "a1", "missing"]).map((r) => r.id)).toEqual(["a3", "a1"]);
    });

    it("findByBotAndExternalId 走复合索引语义", async () => {
      await store.create({ id: "b1", title: "bot 会话", sessionType: "bot", botId: "bot-x", platform: "wecom", externalId: "ext-1" });
      expect(store.findByBotAndExternalId("bot-x", "ext-1")?.id).toBe("b1");
      expect(store.findByBotAndExternalId("bot-x", "other")).toBeNull();
    });

    it("queryPaged：页切片与全量同序，total 只计过滤后行数", () => {
      const full = store.query({ sessionType: "web", archived: false }).map((m) => m.id);
      const p0 = store.queryPaged({ sessionType: "web", archived: false }, "lastActiveDesc", { skip: 0, limit: 1 });
      const p1 = store.queryPaged({ sessionType: "web", archived: false }, "lastActiveDesc", { skip: 1, limit: 1 });
      expect(p0.total).toBe(full.length);
      expect(p0.rows.map((m) => m.id)).toEqual(full.slice(0, 1));
      expect(p1.rows.map((m) => m.id)).toEqual(full.slice(1, 2));
    });

    it("queryPaged：keyword/过滤与分页组合；越界页空行不空 total", () => {
      const kw = store.queryPaged({ sessionType: "web", keyword: "会话" }, "lastActiveDesc", { skip: 0, limit: 10 });
      expect(kw.total).toBe(1);
      expect(kw.rows.map((m) => m.id)).toEqual(["a3"]);
      const oob = store.queryPaged({ sessionType: "web" }, "lastActiveDesc", { skip: 99, limit: 10 });
      expect(oob.rows).toEqual([]);
      expect(oob.total).toBe(3);
    });

    it("queryPaged：省略 limit = 不分页，rows 等同 query 全量", () => {
      const all = store.queryPaged({ sessionType: "web" }, "lastActiveDesc", {});
      expect(all.rows.map((m) => m.id)).toEqual(store.query({ sessionType: "web" }).map((m) => m.id));
      expect(all.total).toBe(3);
    });

    it("pinned：默认 false，update 可置顶/取消，query 双向过滤", async () => {
      // 默认不置顶
      expect(store.getMeta("a1")!.pinned).toBe(false);

      await store.update("a1", { pinned: true });
      expect(store.getMeta("a1")!.pinned).toBe(true);

      // 仅置顶 / 排除置顶（tri-state）
      expect(
        store.query({ sessionType: "web", pinned: true }).map((m) => m.id),
      ).toEqual(["a1"]);
      expect(
        store.query({ sessionType: "web", archived: false, pinned: false }).map((m) => m.id),
      ).toEqual(["a3"]);
      // undefined = 不过滤
      expect(store.query({ sessionType: "web" })).toHaveLength(3);

      // 取消置顶
      await store.update("a1", { pinned: false });
      expect(store.getMeta("a1")!.pinned).toBe(false);
      expect(store.query({ sessionType: "web", pinned: true })).toHaveLength(0);
    });

    it("create 支持显式置顶；pinned 不参与排序（仍按 lastActiveDesc）", async () => {
      await store.create({ id: "p1", sessionType: "web", pinned: true, lastActiveAt: "2026-01-01T00:00:00.000Z" });
      expect(store.getMeta("p1")!.pinned).toBe(true);
      // 置顶不改变 SORT_SQL：p1 最旧 → 排在最后（置顶靠分区互斥，不靠排序）
      const ids = store.query({ sessionType: "web", archived: false, pinned: true }).map((m) => m.id);
      expect(ids).toEqual(["p1"]);
      const all = store.query({ sessionType: "web", archived: false }).map((m) => m.id);
      expect(all[all.length - 1]).toBe("p1");
    });
  });

  describe("孤儿与幽灵收敛", () => {
    it("目录有事件日志但库无行 → 从 seg-0000 重建骨架（含真实消息才救）", async () => {
      writeEventLog("orphan-1", [
        { type: "session/init", data: { title: "孤儿会话" } },
        { type: "user/message", data: {} },
      ]);
      // 纯空壳：仅 init，跳过
      writeEventLog("empty-shell", [{ type: "session/init", data: { title: "空壳" } }]);

      await store.initialize();

      expect(store.getMeta("orphan-1")?.title).toBe("孤儿会话");
      expect(store.has("empty-shell")).toBe(false);
    });

    it("库有行而目录无 → 删行（被绕过存储删除的幽灵）", async () => {
      const row = await store.create({ title: "手删目标" });
      const id = String(row.id);
      fs.rmSync(sessionDir(id), { recursive: true, force: true });

      store.onModuleDestroy(); // 先释放句柄（Windows 下打开中的 db 会锁目录）
      store = newStore();
      await store.initialize();
      expect(store.has(id)).toBe(false);
    });
  });

  describe("分组操作", () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it("createGroup/updateGroup/deleteGroup + clearGroup 解绑", async () => {
      const group = await store.createGroup({ name: "新分组" });
      expect(group.sortOrder).toBe(0);
      expect(group.id).toMatch(/^grp-/);

      const row = await store.create({ title: "会话", groupId: group.id });
      expect(await store.clearGroup(group.id)).toBe(1);
      expect(store.getMeta(String(row.id))!.groupId).toBeNull();

      const updated = await store.updateGroup(group.id, { name: "改名" });
      expect(updated?.name).toBe("改名");

      expect((await store.deleteGroup(group.id)).id).toBe(group.id);
      expect(await store.findGroupById(group.id)).toBeUndefined();
    });

    it("getMaxGroupSortOrder 与 batchUpdateGroupSortOrder", async () => {
      await store.createGroup({ name: "A", sortOrder: 2 });
      expect(await store.getMaxGroupSortOrder()).toBe(2);
      const groups = await store.listGroups();
      const updated = await store.batchUpdateGroupSortOrder(
        groups.map((g, i) => ({ id: g.id, sortOrder: 10 - i })),
      );
      expect(updated).toHaveLength(1);
      expect((await store.listGroups())[0].sortOrder).toBe(10);
    });

    it("分组 data 扩展字段往返（updateGroup 写入、listGroups 读出、转换写入）", async () => {
      const group = await store.createGroup({ name: "扩展分组" });
      expect((await store.findGroupById(group.id))!.data).toBeNull();

      await store.updateGroup(group.id, { data: { color: "red" } });
      expect((await store.findGroupById(group.id))!.data).toEqual({ color: "red" });

      // 转换侧写入（replaceAllGroups）；缺省 data 归一 null
      const db = openMetaDb(sessionsBase);
      try {
        replaceAllGroups(db, [
          { id: "g-a", name: "A", sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", data: { icon: "i" } },
          { id: "g-b", name: "B", sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ]);
      } finally {
        db.close();
      }
      const groups = await store.listGroups();
      expect(groups.map((g) => g.id)).toEqual(["g-a", "g-b"]);
      expect(groups[0].data).toEqual({ icon: "i" });
      expect(groups[1].data).toBeNull();
    });

    it("转换助手：readMetaRow 读回转换后的行（骨架判定依据）", () => {
      const db = openMetaDb(sessionsBase);
      try {
        upsertMetaRow(db, sessionRowToMeta(dbRow("conv-1")));
        expect(readMetaRow(db, "conv-1")?.title).toBe("会话 conv-1");
        expect(readMetaRow(db, "missing")).toBeNull();
      } finally {
        db.close();
      }
    });
  });
});
