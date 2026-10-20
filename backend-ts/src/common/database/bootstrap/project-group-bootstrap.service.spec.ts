import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { ProjectGroupBootstrapService } from "./project-group-bootstrap.service";
import {
  META_DB_FILE,
  PROJECT_GROUPS_BOOTSTRAPPED_KEY,
  SessionMetaStore,
} from "../../../modules/chat/session-meta.store";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../metadata-bootstrap.gate";
import { normalizeWorkspaceKey } from "../../utils/workspace-key.util";

/**
 * 目录分组一次性注册契约：
 * - 首次启动把历史 workspace_key 里「合格」的真实目录注册成分组
 * - 自动生成目录 / `<baseDir>/public` / 空路径永不注册（归入「通用」）
 * - marker 落库后不再扫描；重复执行（marker 被删）也不覆盖用户改名
 */
describe("ProjectGroupBootstrapService", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let baseDir: string;
  let bootstrap: ProjectGroupBootstrapService;

  const projectA = path.resolve("/proj/alpha");
  const projectB = path.resolve("/proj/beta");
  const autoDir = path.resolve("/work/WORK-2026-07-28-XvZL");

  const newStore = () => {
    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    return new SessionMetaStore(gate);
  };

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-group-bootstrap-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    baseDir = path.join(tmpRoot, "work");
    fs.mkdirSync(sessionsBase, { recursive: true });
    fs.mkdirSync(baseDir, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;

    bootstrap = new ProjectGroupBootstrapService({
      getEffectiveBaseDir: async () => baseDir,
    } as any);
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(sessionsBase, { recursive: true, force: true });
    fs.mkdirSync(sessionsBase, { recursive: true });
  });

  const seedSessions = async () => {
    const store = newStore();
    await store.initialize();
    await store.create({ id: "a1", workspacePath: projectA });
    await store.create({ id: "a2", workspacePath: projectA });
    await store.create({ id: "b1", workspacePath: projectB });
    await store.create({ id: "auto1", workspacePath: autoDir });
    await store.create({ id: "pub1", workspacePath: path.join(baseDir, "public") });
    // 历史遗留的另一处 public（旧 baseDir）：目录名判定，同样不得注册
    await store.create({
      id: "pub2",
      workspacePath: path.resolve("/legacy/workspace/public"),
    });
    await store.create({ id: "none1" });
    // 只有归档会话的目录：不得注册（侧栏会显示空分组）
    await store.create({
      id: "archived1",
      workspacePath: path.resolve("/proj/archived-only"),
      archived: true,
    });
    store.onModuleDestroy();
  };

  it("只注册合格的真实目录（自动目录 / public / 归档目录 / 空路径排除）", async () => {
    await seedSessions();
    await bootstrap.run();

    const store = newStore();
    await store.initialize();
    const groups = await store.listProjectGroups();
    store.onModuleDestroy();

    expect(groups.map((g) => g.pathKey).sort()).toEqual(
      [normalizeWorkspaceKey(projectA), normalizeWorkspaceKey(projectB)].sort(),
    );
    expect(groups.map((g) => g.name).sort()).toEqual(["alpha", "beta"]);
    expect(groups.every((g) => g.nameOverridden === false)).toBe(true);
  });

  it("marker 落库后不再扫描（第二次启动零变更）", async () => {
    await seedSessions();
    await bootstrap.run();
    await bootstrap.run();

    const store = newStore();
    await store.initialize();
    expect(await store.listProjectGroups()).toHaveLength(2);
    store.onModuleDestroy();
  });

  it("重复执行（marker 被删）不覆盖用户改名，也不重复建组", async () => {    await seedSessions();
    await bootstrap.run();

    const store = newStore();
    await store.initialize();
    const before = (await store.listProjectGroups()).find(
      (g) => g.pathKey === normalizeWorkspaceKey(projectA),
    )!;
    await store.renameProjectGroup(before.id, "我的 alpha");
    store.onModuleDestroy();

    // 模拟 marker 丢失（库手改/回滚场景）
    const raw = new Database(path.join(sessionsBase, META_DB_FILE));
    raw.prepare(`DELETE FROM _bootstrap WHERE key = ?`).run(
      PROJECT_GROUPS_BOOTSTRAPPED_KEY,
    );
    raw.close();

    await bootstrap.run();

    const verify = newStore();
    await verify.initialize();
    const groups = await verify.listProjectGroups();
    verify.onModuleDestroy();

    expect(groups).toHaveLength(2);
    const renamed = groups.find((g) => g.id === before.id)!;
    expect(renamed.name).toBe("我的 alpha");
    expect(renamed.nameOverridden).toBe(true);
  });

  it("每次启动清理策略失效的历史分组（public / 自动目录），但保留用户改名", async () => {
    await seedSessions();
    await bootstrap.run();

    // 模拟旧规则/旧 baseDir 遗留的分组行
    const store = newStore();
    await store.initialize();
    const legacyPublic = await store.ensureProjectGroup({
      path: path.resolve("/legacy/other/public"),
      prepend: false,
    });
    const legacyAuto = await store.ensureProjectGroup({
      path: path.resolve("/legacy/WORK-2026-01-01-ABCD"),
      prepend: false,
    });
    const renamedPublic = await store.ensureProjectGroup({
      path: path.resolve("/legacy/renamed/public"),
      prepend: false,
    });
    await store.renameProjectGroup(renamedPublic.id, "保留的公共目录");
    store.onModuleDestroy();

    await bootstrap.run();

    const verify = newStore();
    await verify.initialize();
    const ids = (await verify.listProjectGroups()).map((g) => g.id);
    verify.onModuleDestroy();

    expect(ids).not.toContain(legacyPublic.id);
    expect(ids).not.toContain(legacyAuto.id);
    // 用户改过名 = 显式意图，不因规则收紧被静默删除
    expect(ids).toContain(renamedPublic.id);
  });
});
