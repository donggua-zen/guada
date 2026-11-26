import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SkillSourceManager } from "../../src/modules/skills/core/skill-source.manager";
import { SkillWatcherService } from "../../src/modules/skills/core/skill-watcher.service";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import {
  normalizeWorkspaceKey,
} from "../../src/common/utils/workspace-key.util";
import { workspaceSourceKey } from "../../src/modules/skills/core/skill-source.manager";

/**
 * 项目技能来源（`.guada/skills`）加载与缓存键
 *
 * 覆盖管理页项目下拉依赖的三个前提：
 * 1. 目录不存在时不注册空来源（否则 chokidar 会永久漏掉后续新增）；
 * 2. 同一目录的不同写法命中同一来源（路径归一化）；
 * 3. refresh 会重建来源（手动扫描/热更新后清单即刻正确）。
 */
describe("SkillSourceManager 项目技能来源", () => {
  let tmpDir: string;
  let skillsDir: string;
  let watcher: SkillWatcherService;
  let registry: SkillRegistry;
  let sourceManager: SkillSourceManager;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === "SKILLS_DIR") return skillsDir;
      return defaultValue;
    }),
  } as any;

  const mockWorkspaceService = {
    registerSafeWritePath: jest.fn(),
  } as any;

  async function writeSkill(dir: string, name: string, description = "desc") {
    const skillDir = path.join(dir, name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}`,
    );
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-project-src-"));
    skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    registry = new SkillRegistry();
    watcher = new SkillWatcherService();
    watcher.start();
    sourceManager = new SkillSourceManager(
      mockConfigService,
      new SkillLoaderService(),
      registry,
      watcher,
      mockWorkspaceService,
    );
  });

  afterEach(async () => {
    await watcher.stop();
    await sourceManager.onModuleDestroy();
  });

  it("目录不存在时不注册来源（避免 chokidar 漏事件）", async () => {
    const projectPath = path.join(tmpDir, "project-empty");
    await fs.mkdir(projectPath, { recursive: true });

    const skills = await sourceManager.ensureWorkspaceSource(projectPath);

    expect(skills).toEqual([]);
    expect(
      sourceManager.getAllSources().some((s) => s.source === "workspace"),
    ).toBe(false);
  });

  it("目录存在时加载项目技能，且只在来源缓存里（不进全局注册表）", async () => {
    const projectPath = path.join(tmpDir, "project-loaded");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "proj-skill");

    const skills = await sourceManager.ensureWorkspaceSource(projectPath);

    expect(skills.map((s) => s.id)).toEqual(["proj-skill"]);
    expect(skills[0]).toMatchObject({ source: "workspace", baseDir: projectSkillsDir });
    // 项目技能不能污染全局注册表
    expect(registry.get("proj-skill")).toBeUndefined();
  });

  it("同一目录的不同写法命中同一来源", async () => {
    const projectPath = path.join(tmpDir, "project-alias");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "alias-skill");

    await sourceManager.ensureWorkspaceSource(projectPath);

    // 尾部斜杠 + 分隔符差异：归一化后必须是同一个键
    const altPath = projectPath.replace(/[\\/]+/g, "/") + "/";
    const pathKey = normalizeWorkspaceKey(altPath);
    const viaPathKey = sourceManager.getWorkspaceSkillsByPathKey(pathKey);

    expect(viaPathKey.map((s) => s.id)).toEqual(["alias-skill"]);
    expect(
      sourceManager.getAllSources().filter((s) => s.source === "workspace"),
    ).toHaveLength(1);
    // 键由 pathKey 派生，不再是原始字符串拼接
    expect(sourceManager.findWorkspaceSourceKey(pathKey)).toBe(
      workspaceSourceKey(normalizeWorkspaceKey(projectPath)),
    );
  });

  it("refresh 重建来源：磁盘新增的技能下一次即可见", async () => {
    const projectPath = path.join(tmpDir, "project-refresh");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "first-skill");

    await sourceManager.ensureWorkspaceSource(projectPath);
    await writeSkill(projectSkillsDir, "second-skill");

    // 不 refresh：只续期，缓存不变
    const cached = await sourceManager.ensureWorkspaceSource(projectPath);
    expect(cached.map((s) => s.id).sort()).toEqual(["first-skill"]);

    // refresh：重建并重扫
    const refreshed = await sourceManager.ensureWorkspaceSource(projectPath, {
      refresh: true,
    });
    expect(refreshed.map((s) => s.id).sort()).toEqual([
      "first-skill",
      "second-skill",
    ]);
  });

  it("目录在加载后被删除：ensure 注销旧来源并返回空", async () => {
    const projectPath = path.join(tmpDir, "project-removed");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "gone-skill");

    await sourceManager.ensureWorkspaceSource(projectPath);
    expect(
      sourceManager.getWorkspaceSkillsByPathKey(normalizeWorkspaceKey(projectPath)),
    ).toHaveLength(1);

    await fs.rm(projectSkillsDir, { recursive: true, force: true });

    const after = await sourceManager.ensureWorkspaceSource(projectPath);
    expect(after).toEqual([]);
    expect(
      sourceManager.getAllSources().some((s) => s.source === "workspace"),
    ).toBe(false);
  });

  it("replaceSourceSkill：热重载后的定义写回来源缓存", async () => {
    const projectPath = path.join(tmpDir, "project-replace");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "replace-skill");

    const [skill] = await sourceManager.ensureWorkspaceSource(projectPath);
    const key = sourceManager.findWorkspaceSourceKey(
      normalizeWorkspaceKey(projectPath),
    );

    sourceManager.replaceSourceSkill(key, {
      ...skill,
      manifest: { ...skill.manifest, description: "updated" },
    });

    const [updated] = sourceManager.getWorkspaceSkillsByPathKey(
      normalizeWorkspaceKey(projectPath),
    );
    expect(updated.manifest.description).toBe("updated");
  });

  it("findWorkspaceSkillByName：按名称在项目来源里兜底查找", async () => {
    const projectPath = path.join(tmpDir, "project-byname");
    const projectSkillsDir = path.join(projectPath, ".guada", "skills");
    await writeSkill(projectSkillsDir, "byname-skill");

    await sourceManager.ensureWorkspaceSource(projectPath);

    expect(sourceManager.findWorkspaceSkillByName("byname-skill")?.id).toBe(
      "byname-skill",
    );
    expect(sourceManager.findWorkspaceSkillByName("missing-skill")).toBeUndefined();
  });
});
