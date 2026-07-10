import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SkillSourceManager } from "../../src/modules/skills/core/skill-source.manager";
import { SkillWatcherService } from "../../src/modules/skills/core/skill-watcher.service";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { FileEventHandlers } from "../../src/modules/skills/core/skill-watcher.service";

/**
 * 热更新集成测试：验证 watcher → source manager → registry 的全链路
 *
 * 关键验证点：
 * 1. 新增技能目录 → watcher 触发 → registry 自动注册
 * 2. 删除技能文件 → watcher 触发 → registry 自动注销
 * 3. triggerScan 后 watcher 仍能捕获后续变更
 * 4. 路径一致性：热更新写入 registry 的 basePath 与初始扫描一致
 */
describe("技能热更新集成测试 (Watcher + SourceManager + Registry)", () => {
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

  /** 从 watcher 内部获取 global 来源的 handler（按 pattern 名后缀匹配） */
  function getGlobalWatcherHandler(): FileEventHandlers | undefined {
    const handlers: Map<string, FileEventHandlers> = (watcher as any).handlers;
    for (const [pattern, h] of handlers) {
      // global 来源的 pattern 以 skills/*/SKILL.md 结尾（不含 .system）
      if (pattern.endsWith("/*/SKILL.md") && !pattern.includes(".system")) {
        return h;
      }
    }
    return undefined;
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-hot-reload-"));
    skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });

    // 初始创建 built-in 技能
    const systemDir = path.join(skillsDir, ".system", "built-in");
    await fs.mkdir(systemDir, { recursive: true });
    await fs.writeFile(
      path.join(systemDir, "SKILL.md"),
      "---\nname: built-in\ndescription: System built-in skill\n---\n\nBuilt-in content",
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    registry = new SkillRegistry();
    watcher = new SkillWatcherService();
    const loader = new SkillLoaderService();

    // 必须先启动 watcher（初始化 chokidar），sourceManager.register() 才能注册 watcher handlers
    watcher.start();

    sourceManager = new SkillSourceManager(
      mockConfigService,
      loader,
      registry,
      watcher,
      mockWorkspaceService,
    );
  });

  afterEach(async () => {
    await watcher.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("初始扫描应正确注册已存在的技能", async () => {
    await sourceManager.start();

    expect(registry.get("built-in")).toBeDefined();
    expect(registry.get("built-in")!.manifest.name).toBe("built-in");
    expect(registry.get("built-in")!.baseDir).toBe(skillsDir);
  });

  it("新增技能目录 → watcher 触发 → registry 自动注册", async () => {
    await sourceManager.start();

    const handler = getGlobalWatcherHandler();
    expect(handler).toBeDefined();

    // 创建新的技能目录和 SKILL.md
    const newSkillDir = path.join(skillsDir, "new-skill");
    await fs.mkdir(newSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(newSkillDir, "SKILL.md"),
      "---\nname: new-skill\ndescription: A newly added skill\n---\n\nNew skill content",
    );

    // 模拟 watcher 触发
    await handler!.onAdd(path.join(skillsDir, "new-skill"));

    // 验证 registry 已注册
    const skill = registry.get("new-skill");
    expect(skill).toBeDefined();
    expect(skill!.manifest.description).toBe("A newly added skill");
    expect(skill!.source).toBe("global");
    expect(skill!.baseDir).toBe(skillsDir);
    expect(skill!.basePath).toBe("new-skill");
  });

  it("删除技能文件 → watcher 触发 → registry 自动注销", async () => {
    await sourceManager.start();

    const handler = getGlobalWatcherHandler();
    expect(handler).toBeDefined();

    // 先注册一个技能
    const skillToRemove = path.join(skillsDir, "to-remove");
    await fs.mkdir(skillToRemove, { recursive: true });
    await fs.writeFile(
      path.join(skillToRemove, "SKILL.md"),
      "---\nname: to-remove\ndescription: Will be removed\n---\n\nContent",
    );

    // 模拟 watcher add
    await handler!.onAdd(path.join(skillsDir, "to-remove"));
    expect(registry.get("to-remove")).toBeDefined();

    // 模拟删除（unlink）
    handler!.onRemove("to-remove");
    expect(registry.get("to-remove")).toBeUndefined();
  });

  it("triggerScan 后 watcher 仍能捕获新增技能", async () => {
    await sourceManager.start();

    // 模拟 triggerScan
    await sourceManager.restart();

    // 内置技能仍然存在
    expect(registry.get("built-in")).toBeDefined();

    const handler = getGlobalWatcherHandler();
    expect(handler).toBeDefined();

    // 新增技能仍能被 watcher 捕获
    const newDir = path.join(skillsDir, "after-scan");
    await fs.mkdir(newDir, { recursive: true });
    await fs.writeFile(
      path.join(newDir, "SKILL.md"),
      "---\nname: after-scan\ndescription: Added after scan\n---\n\nContent",
    );

    await handler!.onAdd(path.join(skillsDir, "after-scan"));
    expect(registry.get("after-scan")).toBeDefined();
  });

  it("热更新写入的 basePath 应与初始扫描格式一致", async () => {
    await sourceManager.start();

    const systemSkill = registry.get("built-in")!;

    const handler = getGlobalWatcherHandler();
    expect(handler).toBeDefined();

    // 热更新新增
    const newSkillDir = path.join(skillsDir, "hot-added");
    await fs.mkdir(newSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(newSkillDir, "SKILL.md"),
      "---\nname: hot-added\ndescription: Added via hot reload\n---\n\nContent",
    );

    await handler!.onAdd(path.resolve(path.join(skillsDir, "hot-added")));

    const hotSkill = registry.get("hot-added")!;

    // 两者的 baseDir 应一致
    expect(hotSkill.baseDir).toBe(systemSkill.baseDir);
    // basePath 都应为相对路径格式（不包含 .. 或驱动器号）
    expect(hotSkill.basePath).not.toContain("..");
    expect(hotSkill.basePath).not.toContain(":");
    expect(hotSkill.basePath).toBe("hot-added");
  });

  it("修改 SKILL.md → watcher 触发 → registry 内容哈希更新", async () => {
    await sourceManager.start();

    const handler = getGlobalWatcherHandler();
    expect(handler).toBeDefined();

    // 创建技能
    const updatableDir = path.join(skillsDir, "updatable");
    await fs.mkdir(updatableDir, { recursive: true });
    await fs.writeFile(
      path.join(updatableDir, "SKILL.md"),
      "---\nname: updatable\ndescription: v1\n---\n\nVersion 1 content",
    );

    await handler!.onAdd(path.resolve(path.join(skillsDir, "updatable")));

    const oldHash = registry.get("updatable")!.contentHash;

    // 修改内容
    await fs.writeFile(
      path.join(updatableDir, "SKILL.md"),
      "---\nname: updatable\ndescription: v2\n---\n\nVersion 2 content",
    );

    // 触发热更新
    await handler!.onAdd(path.resolve(path.join(skillsDir, "updatable")));

    const newHash = registry.get("updatable")!.contentHash;
    expect(newHash).not.toBe(oldHash);
    expect(registry.get("updatable")!.manifest.description).toBe("v2");
  });
});
