import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillVersionManager } from "../../src/modules/skills/core/skill-version-manager.service";
import { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * 完整业务链路测试：
 * 创建 SKILL.md 文件 → 加载解析 → 注册到 registry → listSkills 返回
 * 删除 registry → listSkills 不再返回
 *
 * 模拟 watcher 的 onAdd/onRemove 回调行为，但不依赖 chokidar。
 */
describe("Skill 生命周期（onAdd / onRemove → registry → listSkills）", () => {
  let registry: SkillRegistry;
  let orchestrator: SkillOrchestrator;
  let loader: SkillLoaderService;
  let tmpDir: string;
  let skillsDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-lifecycle-"));
    skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    registry = new SkillRegistry();
    const mockSourceManager = {
      restart: jest.fn().mockResolvedValue(undefined),
      getSourceSkills: jest.fn().mockReturnValue([]),
      getAllSkills: jest.fn().mockReturnValue([]),
      getEnabledSkills: jest.fn().mockReturnValue([]),
    } as any;
    const mockVersionManager = {} as SkillVersionManager;
    loader = new SkillLoaderService();
    orchestrator = new SkillOrchestrator(mockSourceManager, registry, loader, mockVersionManager);
  });

  // ================================================================
  // 场景：模拟 watcher 的 onAdd 回调
  // 流程：创建目录和 SKILL.md → loadManifest → registry.register → listSkills
  // ================================================================

  it("创建技能文件后应能被 listSkills 查询到", async () => {
    const skillName = "test-add-skill";
    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test skill for add\n---\n\n# ${skillName}\n\nContent.`,
    );

    // 模拟 watcher.onAdd：加载 manifest 并注册
    const sd = await loader.loadManifest(skillDir, "global", skillsDir);
    registry.register(sd);

    // 验证：listSkills 应返回该技能
    const all = orchestrator.listSkills(false);
    expect(all.some((s) => s.id === skillName)).toBe(true);
    expect(all.find((s) => s.id === skillName)?.manifest.name).toBe(skillName);
  });

  it("listSkills 默认只返回已启用的技能", async () => {
    const skillName = "test-disabled-skill";
    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test\n---\n\nContent.`,
    );

    const sd = await loader.loadManifest(skillDir, "global", skillsDir);
    sd.enabled = false;
    registry.register(sd);

    expect(orchestrator.listSkills(false)).toHaveLength(1); // filterEnabled=false 包含禁用
    expect(orchestrator.listSkills(true)).toHaveLength(0);  // filterEnabled=true 过滤掉
    expect(orchestrator.listSkills()).toHaveLength(0);       // 默认 true
  });

  // ================================================================
  // 场景：模拟 watcher 的 onRemove 回调
  // 流程：registry.unregister → listSkills 不再返回
  // ================================================================

  it("删除技能后 listSkills 应不再返回", async () => {
    const skillName = "test-remove-skill";
    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test\n---\n\nContent.`,
    );

    // 先注册
    const sd = await loader.loadManifest(skillDir, "global", skillsDir);
    registry.register(sd);
    expect(orchestrator.listSkills(false).some((s) => s.id === skillName)).toBe(true);

    // 模拟 watcher.onRemove：unregister
    registry.unregister(skillName);
    expect(orchestrator.listSkills(false).some((s) => s.id === skillName)).toBe(false);
  });

  // ================================================================
  // 场景：多次 add/remove (热更新)
  // ================================================================

  it("多次添加和删除应保持一致性", async () => {
    for (let i = 0; i < 3; i++) {
      const skillName = `test-cycle-${i}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: Cycle ${i}\n---\n\nContent.`,
      );

      const sd = await loader.loadManifest(skillDir, "global", skillsDir);
      registry.register(sd);
    }
    expect(orchestrator.listSkills(false)).toHaveLength(3);

    registry.unregister("test-cycle-1");
    expect(orchestrator.listSkills(false)).toHaveLength(2);
    expect(orchestrator.listSkills(false).map((s) => s.id)).not.toContain("test-cycle-1");

    registry.unregister("test-cycle-0");
    registry.unregister("test-cycle-2");
    expect(orchestrator.listSkills(false)).toHaveLength(0);
  });
});