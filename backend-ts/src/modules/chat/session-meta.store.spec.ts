import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { normalizeWorkspaceKey } from "../../common/utils/workspace-key.util";
import {
  META_DB_FILE,
  SESSION_ID_PREFIX,
  SessionMetaStore,
  importSessionMetaRows,
  openMetaDb,
  readMetaRow,
  replaceAllGroups,
  upsertMetaRow,
} from "./session-meta.store";

/**
 * 会话元数据存储（sessions/_meta.db）契约测试
 *
 * 覆盖：批量写入与 root_id 回填、CRUD 与结构化查询、data 扩展位、
 * schema 迁移（v1 与误标记 v2 两种自愈）、孤儿/幽灵收敛、分组 CRUD、
 * id 铸造与路径安全（原文件版 store 的回归点）。
 */
describe("SessionMetaStore", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let store: SessionMetaStore;

  const sessionDir = (id: string) => path.join(sessionsBase, id);
  const dbPath = () => path.join(sessionsBase, META_DB_FILE);

  /** 只读原始连接（断言 schema；不经 openMetaDb，避免触发 schema 初始化） */
  const rawDb = () => new Database(dbPath(), { readonly: true });

  const writeEventLog = (id: string, events: any[]) => {
    fs.mkdirSync(sessionDir(id), { recursive: true });
    const body = events
      .map((e, i) => JSON.stringify({ seq: i, time: 1700000000000 + i, ...e }))
      .join("\n");
    fs.writeFileSync(path.join(sessionDir(id), "seg-0000.jsonl"), body);
  };

  /** 历史 session 行的形状（characterId 即 agentId） */
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

  /** 历史行 → SessionMeta（测试夹具用） */
  const toMeta = (row: Record<string, any>) => {
    const now = new Date().toISOString();
    return {
      id: String(row.id),
      title: row.title ?? null,
      avatarUrl: row.avatarUrl ?? null,
      description: row.description ?? null,
      modelId: row.modelId ?? null,
      agentId: row.characterId ?? null,
      groupId: row.groupId ?? null,
      settings:
        row.settings && typeof row.settings === "object" ? row.settings : null,
      data: null,
      sessionType: row.sessionType ?? "web",
      archived: row.archived === true,
      pinned: false,
      botId: row.botId ?? null,
      platform: row.platform ?? null,
      externalId: row.externalId ?? null,
      workspacePath: row.workspacePath ?? null,
      workspaceKey: null,
      parentId: row.parentId ?? null,
      rootId: null,
      closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
      closeReason: row.closeReason ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : now,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : now,
      lastActiveAt: row.lastActiveAt
        ? new Date(row.lastActiveAt).toISOString()
        : null,
    };
  };

  const newStore = () => new SessionMetaStore();

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-meta-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot; // → sessionsBase = <tmpRoot>/sessions
    store = newStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("批量写入与 root_id 回填", () => {
    it("写入行与分组，回填 root_id", async () => {
      const db = openMetaDb(sessionsBase);
      try {
        importSessionMetaRows(
          db,
          [
            toMeta(dbRow("sess-parent")),
            toMeta(
              dbRow("sess-child", {
                parentId: "sess-parent",
                sessionType: "sub_agent",
                closedAt: new Date("2026-01-03T00:00:00.000Z"),
                closeReason: "done",
              }),
            ),
          ],
          [{ id: "grp-1", name: "工作", sortOrder: 1, icon: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
        );
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
      // settings 折入 data.settings
      expect(store.getMeta("sess-parent")!.settings).toEqual({ thinkingEnabled: true });
      // 分组随批量写入落库
      expect((await store.listGroups()).map((g) => g.id)).toEqual(["grp-1"]);
      // 行视图 Date 形状（兼容既有调用方）
      expect(store.get("sess-parent")!.createdAt).toBeInstanceOf(Date);
    });

    it("库文件被删后重开实例得到空库", async () => {
      const db = openMetaDb(sessionsBase);
      importSessionMetaRows(db, [toMeta(dbRow("a1"))], []);
      db.close();
      fs.mkdirSync(sessionDir("a1"), { recursive: true });

      store.onModuleDestroy();
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${dbPath()}${suffix}`, { force: true });
      }

      store = newStore();
      await store.initialize();
      expect(store.query({}).length).toBe(0);
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

    it("listWebSessionsWithMissingModel 只列 web 会话；backfillModelId 不触碰时间戳", async () => {
      await store.create({
        id: "w1",
        title: "w1",
        sessionType: "web",
        modelId: null,
      });
      await store.create({
        id: "b1",
        title: "b1",
        sessionType: "bot",
        modelId: null,
      });
      await store.create({
        id: "w2",
        title: "w2",
        sessionType: "web",
        modelId: "p:m",
      });

      expect(store.listWebSessionsWithMissingModel()).toEqual([
        { id: "w1", agentId: null },
      ]);

      const before = store.getMeta("w1")!;
      await store.backfillModelId("w1", "p:first");
      const after = store.getMeta("w1")!;
      expect(after.modelId).toBe("p:first");
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(store.listWebSessionsWithMissingModel()).toEqual([]);
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
      const groupCols = (
        probe.pragma("table_info(session_groups)") as any[]
      ).map((c) => c.name);
      const projectCols = (
        probe.pragma("table_info(project_groups)") as any[]
      ).map((c) => c.name);
      probe.close();
      expect(cols).toContain("data");
      expect(cols).not.toContain("settings");
      // v4：pinned 列（置顶）由迁移补齐；v5：model_usage 用量表；v6：workspace_key 派生列
      expect(cols).toContain("pinned");
      expect(cols).toContain("workspace_key");
      expect(groupCols).toContain("icon");
      expect(projectCols).toContain("icon");
      expect(version).toBe(7);
    });
  });

  describe("workspace_key 派生列（v6 迁移）", () => {
    // win32 用 `/` 与 `\` 两种写法（真实库场景）；POSIX 用末尾分隔符
    const isWin = process.platform === "win32";
    const pathA = isWin ? "D:/AI/work/public" : "/ai/work/public";
    const pathB = isWin ? "D:\\AI\\work\\public" : "/ai/work/public/";

    /** 手建 v1 物理库（与上方 buildLegacyDb 同构，此处只需带 workspace_path 的行） */
    const buildLegacyDbWithWorkspaces = (
      rows: { id: string; workspacePath: string }[],
    ) => {
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
        const insert = db.prepare(
          `INSERT INTO sessions (id, session_type, title, workspace_path, created_at, updated_at) VALUES (?, 'web', ?, ?, ?, ?)`,
        );
        for (const row of rows) {
          insert.run(
            row.id,
            row.id,
            row.workspacePath,
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          );
        }
        db.pragma(`user_version = 1`);
      } finally {
        db.close();
      }
      for (const row of rows) {
        fs.mkdirSync(sessionDir(row.id), { recursive: true });
      }
    };

    it("旧库补列并回填，同目录不同写法归一为同键", async () => {
      store.onModuleDestroy();
      buildLegacyDbWithWorkspaces([
        { id: "w1", workspacePath: pathA },
        { id: "w2", workspacePath: pathB },
      ]);

      store = newStore();
      await store.initialize();

      const probe = rawDb();
      const rows = probe
        .prepare(`SELECT id, workspace_key FROM sessions WHERE workspace_path IS NOT NULL ORDER BY id`)
        .all() as { id: string; workspace_key: string | null }[];
      probe.close();

      expect(rows).toHaveLength(2);
      expect(rows[0]!.workspace_key).toBeTruthy();
      expect(rows[0]!.workspace_key).toBe(rows[1]!.workspace_key);
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
          { id: "g-a", name: "A", sortOrder: 0, icon: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", data: { icon: "i" } },
          { id: "g-b", name: "B", sortOrder: 1, icon: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ]);
      } finally {
        db.close();
      }
      const groups = await store.listGroups();
      expect(groups.map((g) => g.id)).toEqual(["g-a", "g-b"]);
      expect(groups[0].data).toEqual({ icon: "i" });
      expect(groups[1].data).toBeNull();
    });

    it("分组图标往返：创建可带 icon，updateGroup 可只改/清空 icon", async () => {
      const group = await store.createGroup({ name: "图标分组", icon: "code" });
      expect(group.icon).toBe("code");
      expect((await store.findGroupById(group.id))!.icon).toBe("code");

      await store.updateGroup(group.id, { icon: "rocket" });
      const updated = (await store.findGroupById(group.id))!;
      expect(updated.icon).toBe("rocket");
      expect(updated.name).toBe("图标分组");

      await store.updateGroup(group.id, { icon: null });
      expect((await store.findGroupById(group.id))!.icon).toBeNull();
    });

    it("读取助手：readMetaRow 读回写入后的行（骨架判定依据）", () => {
      const db = openMetaDb(sessionsBase);
      try {
        upsertMetaRow(db, toMeta(dbRow("conv-1")));
        expect(readMetaRow(db, "conv-1")?.title).toBe("会话 conv-1");
        expect(readMetaRow(db, "missing")).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  describe("目录分组（project_groups）", () => {
    const projectPath = path.resolve("/proj/alpha");
    const projectPathKey = normalizeWorkspaceKey(projectPath);

    it("注册幂等：归一化后同键原样返回，且不改名", async () => {
      await store.initialize();
      const first = await store.ensureProjectGroup({
        path: projectPath,
        prepend: false,
      });
      expect(first.pathKey).toBe(projectPathKey);
      expect(first.name).toBe("alpha");
      expect(first.nameOverridden).toBe(false);

      // 末尾分隔符写法应命中同一分组
      const second = await store.ensureProjectGroup({
        path: `${projectPath}${path.sep}`,
        prepend: false,
      });
      expect(second.id).toBe(first.id);
      expect(await store.listProjectGroups()).toHaveLength(1);

      // 改名后再次注册不得覆盖（bootstrap 语义）
      await store.updateProjectGroup(first.id, { name: "自定义名字" });
      const third = await store.ensureProjectGroup({ path: projectPath, prepend: false });
      expect(third.id).toBe(first.id);
      expect(third.name).toBe("自定义名字");
      expect(third.nameOverridden).toBe(true);
    });

    it("项目图标：注册默认 null；只改 icon 不置 nameOverridden，改名仍置位", async () => {
      await store.initialize();
      const group = await store.ensureProjectGroup({
        path: projectPath,
        prepend: false,
      });
      expect(group.icon).toBeNull();

      const iconOnly = (await store.updateProjectGroup(group.id, {
        icon: "rocket",
      }))!;
      expect(iconOnly.icon).toBe("rocket");
      expect(iconOnly.name).toBe("alpha");
      expect(iconOnly.nameOverridden).toBe(false);

      const renamed = (await store.updateProjectGroup(group.id, {
        name: "新名字",
        icon: "star",
      }))!;
      expect(renamed.name).toBe("新名字");
      expect(renamed.nameOverridden).toBe(true);
      expect(renamed.icon).toBe("star");

      await store.updateProjectGroup(group.id, { icon: null });
      expect((await store.findProjectGroup(group.id))!.icon).toBeNull();
    });

    it("新建分组前置：position 递增向前，列表顺序稳定", async () => {
      await store.initialize();
      const a = await store.ensureProjectGroup({ path: path.resolve("/proj/a") });
      const b = await store.ensureProjectGroup({ path: path.resolve("/proj/b") });
      const c = await store.ensureProjectGroup({ path: path.resolve("/proj/c") });
      expect((await store.listProjectGroups()).map((g) => g.id)).toEqual([c.id, b.id, a.id]);
    });

    it("拖拽排序写 dense position，非法 id 集合拒绝", async () => {
      await store.initialize();
      const a = await store.ensureProjectGroup({ path: path.resolve("/proj/a") });
      const b = await store.ensureProjectGroup({ path: path.resolve("/proj/b") });

      const reordered = await store.reorderProjectGroups([a.id, b.id]);
      expect(reordered.map((g) => g.id)).toEqual([a.id, b.id]);
      expect(reordered.map((g) => g.position)).toEqual([0, 1]);

      await expect(store.reorderProjectGroups([a.id])).rejects.toThrow(/id 集合/);
      await expect(store.reorderProjectGroups([a.id, "pg-missing"])).rejects.toThrow(/id 集合/);
      await expect(store.reorderProjectGroups([a.id, a.id])).rejects.toThrow(/id 集合/);
    });

    it("取消注册只删分组行，会话不受影响并回落到通用桶", async () => {
      await store.initialize();
      const created = await store.create({
        id: "p1",
        title: "项目会话",
        workspacePath: projectPath,
      });
      expect(created.workspaceKey).toBe(projectPathKey);

      const group = await store.ensureProjectGroup({ path: projectPath, prepend: false });
      expect(store.query({ workspaceKey: projectPathKey }).map((m) => m.id)).toEqual(["p1"]);
      expect(store.query({ workspaceKey: null }).map((m) => m.id)).toEqual([]);

      await store.deleteProjectGroup(group.id);

      expect(store.getMeta("p1")).toBeTruthy(); // 会话行仍在，未被回写
      expect(await store.listProjectGroups()).toEqual([]);
      // 未注册后，该目录的会话落入通用桶
      expect(store.query({ workspaceKey: null }).map((m) => m.id)).toEqual(["p1"]);
    });

    it("workspaceKey tri-state：null = 空路径 + 未注册目录，undefined = 不过滤", async () => {
      await store.initialize();
      await store.create({ id: "registered", workspacePath: projectPath });
      await store.create({ id: "unregistered", workspacePath: path.resolve("/proj/beta") });
      await store.create({ id: "auto", workspacePath: path.resolve("/work/WORK-2026-07-28-XvZL") });
      await store.create({ id: "nopath" });

      await store.ensureProjectGroup({ path: projectPath, prepend: false });

      expect(store.query({ workspaceKey: projectPathKey }).map((m) => m.id)).toEqual(["registered"]);
      expect(
        store.query({ workspaceKey: null }).map((m) => m.id).sort(),
      ).toEqual(["auto", "nopath", "unregistered"]);
      expect(store.query({}).length).toBe(4);
    });

    it("excludeSessionTypes 生效（目录侧栏排除 bot/sub_agent）", async () => {
      await store.initialize();
      await store.create({ id: "w", sessionType: "web", workspacePath: projectPath });
      await store.create({ id: "b", sessionType: "bot", workspacePath: projectPath });
      await store.create({ id: "s", sessionType: "sub_agent", workspacePath: projectPath });

      const ids = store
        .query({ workspaceKey: projectPathKey, excludeSessionTypes: ["bot", "sub_agent"] })
        .map((m) => m.id);
      expect(ids).toEqual(["w"]);
    });
  });
});
