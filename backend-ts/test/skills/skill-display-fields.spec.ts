import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";
import { SkillVersionManager } from "../../src/modules/skills/core/skill-version-manager.service";

/**
 * SKILL.md 展示扩展字段（display_name 等）回归测试。
 *
 * 约定：display_* / description_* 只用于 UI 展示，必须随 manifest 原样下发；
 * 但 AI 侧的元数据注入（getMetadataInjection）只能出现 name / description。
 */

const mockSourceManager = {
  restart: jest.fn().mockResolvedValue(undefined),
  getSourceSkills: jest.fn().mockReturnValue([]),
  getAllSkills: jest.fn().mockReturnValue([]),
  getEnabledSkills: jest.fn().mockReturnValue([]),
} as any;
const mockPluginManager = {
  isPluginEnabled: jest.fn().mockReturnValue(true),
} as any;

function makeSkill(manifest: SkillDefinition["manifest"]): SkillDefinition {
  return {
    id: manifest.name.toLowerCase(),
    baseDir: "/tmp/skills",
    basePath: manifest.name,
    manifest,
    contentHash: "abc123",
    source: "global",
    enabled: true,
  };
}

describe("SKILL.md 展示扩展字段", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-display-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("加载技能时 display_name/description_zh 等字段原样进入 manifest", async () => {
    const skillDir = path.join(tmpDir, "humanizer");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: humanizer",
        "description: Remove AI writing patterns from text",
        "display_name: 去AI味",
        "display_name_zh: 去AI味",
        "display_name_en: AI Text Humanizer",
        "description_zh: 去除 AI 写作痕迹",
        "description_en: Remove AI writing patterns",
        "default_lang: zh",
        "version: 1.0.0",
        "---",
        "",
        "# Humanizer",
      ].join("\n"),
    );

    const loader = new SkillLoaderService();
    const skill = await loader.loadManifest(skillDir);

    expect(skill.manifest.name).toBe("humanizer");
    expect(skill.manifest.display_name).toBe("去AI味");
    expect(skill.manifest.display_name_zh).toBe("去AI味");
    expect(skill.manifest.display_name_en).toBe("AI Text Humanizer");
    expect(skill.manifest.description_zh).toBe("去除 AI 写作痕迹");
    expect(skill.manifest.description_en).toBe("Remove AI writing patterns");
    expect(skill.manifest.default_lang).toBe("zh");
  });

  it("AI 元数据注入只包含 name/description，不泄漏展示字段", () => {
    const registry = new SkillRegistry();
    const orchestrator = new SkillOrchestrator(
      mockSourceManager,
      registry,
      {} as SkillLoaderService,
      {} as SkillVersionManager,
      mockPluginManager,
    );

    registry.register(
      makeSkill({
        name: "humanizer",
        description: "Remove AI writing patterns from text",
        display_name: "去AI味",
        display_name_zh: "去AI味",
        display_name_en: "AI Text Humanizer",
        description_zh: "去除 AI 写作痕迹",
      }),
    );

    const injected = orchestrator.getMetadataInjection();

    expect(injected).toContain("humanizer");
    expect(injected).toContain("Remove AI writing patterns from text");
    expect(injected).not.toContain("去AI味");
    expect(injected).not.toContain("去除 AI 写作痕迹");
    expect(injected).not.toContain("AI Text Humanizer");
  });
});
