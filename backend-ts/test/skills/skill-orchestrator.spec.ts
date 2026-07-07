import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillVersionManager } from "../../src/modules/skills/core/skill-version-manager.service";

// ── Mocks ──

const mockSourceManager = {
  restart: jest.fn().mockResolvedValue(undefined),
  getSourceSkills: jest.fn().mockReturnValue([]),
  getAllSkills: jest.fn().mockReturnValue([]),
  getEnabledSkills: jest.fn().mockReturnValue([]),
} as any;
const mockLoader = {} as SkillLoaderService;
const mockVersionManager = {} as SkillVersionManager;

function makeSkill(id: string, enabled = true): SkillDefinition {
  return {
    id,
    baseDir: '/tmp/skills',
    basePath: id,
    manifest: { name: id, description: `Skill ${id}`, tags: [id] },
    contentHash: "abc123",
    source: "global",
    enabled,
  };
}

describe("SkillOrchestrator", () => {
  let registry: SkillRegistry;
  let orchestrator: SkillOrchestrator;

  beforeEach(() => {
    registry = new SkillRegistry();
    orchestrator = new SkillOrchestrator(mockSourceManager, registry, mockLoader, mockVersionManager);
  });

  describe("listSkills", () => {
    it("should return all skills when filterEnabled=false", () => {
      registry.register(makeSkill("enabled-1", true));
      registry.register(makeSkill("disabled-1", false));
      registry.register(makeSkill("enabled-2", true));

      const all = orchestrator.listSkills(false);
      expect(all).toHaveLength(3);
    });

    it("should return only enabled skills by default", () => {
      registry.register(makeSkill("enabled-1", true));
      registry.register(makeSkill("disabled-1", false));
      registry.register(makeSkill("enabled-2", true));

      const enabled = orchestrator.listSkills();
      expect(enabled).toHaveLength(2);
      expect(enabled.every((s) => s.enabled !== false)).toBe(true);
    });

    it("should return only enabled skills when filterEnabled=true", () => {
      registry.register(makeSkill("enabled-1", true));
      registry.register(makeSkill("disabled-1", false));

      const enabled = orchestrator.listSkills(true);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe("enabled-1");
    });

    it("should return empty when all skills are disabled", () => {
      registry.register(makeSkill("disabled-1", false));
      registry.register(makeSkill("disabled-2", false));

      expect(orchestrator.listSkills()).toHaveLength(0);
    });

    it("should return empty when no skills registered", () => {
      expect(orchestrator.listSkills()).toHaveLength(0);
    });
  });

  describe("getMetadataInjection", () => {
    it("should include all registered skills in metadata (no enabled filter)", () => {
      registry.register(makeSkill("code-review", true));
      registry.register(makeSkill("data-analyzing", true));
      registry.register(makeSkill("deprecated-skill", false));

      const meta = orchestrator.getMetadataInjection();
      expect(meta).toContain("code-review");
      expect(meta).toContain("data-analyzing");
      // 当前实现不按 enabled 过滤，全部注入
      expect(meta).toContain("deprecated-skill");
    });

    it("should include disabled skills when they exist", () => {
      registry.register(makeSkill("disabled-1", false));
      expect(orchestrator.getMetadataInjection()).not.toBe("");
      expect(orchestrator.getMetadataInjection()).toContain("disabled-1");
    });

    it("should return empty string when no skills at all", () => {
      expect(orchestrator.getMetadataInjection()).toBe("");
    });
  });

  describe("matchSkills", () => {
    it("should match by skill name", async () => {
      registry.register(makeSkill("code-review", true));
      registry.register(makeSkill("data-analyzing", true));

      const matches = await orchestrator.matchSkills("I need code-review");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skillId).toBe("code-review");
    });

    it("should match disabled skills too (current impl uses getAll)", async () => {
      registry.register(makeSkill("code-review", false));

      const matches = await orchestrator.matchSkills("I need code-review");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skillId).toBe("code-review");
    });

    it("should match by tags", async () => {
      const skill = makeSkill("security-audit", true);
      skill.manifest.tags = ["security", "audit"];
      registry.register(skill);

      const matches = await orchestrator.matchSkills("security audit");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skillId).toBe("security-audit");
    });

    it("should return empty when no match", async () => {
      registry.register(makeSkill("data-analyzing", true));
      const matches = await orchestrator.matchSkills("cooking recipe");
      expect(matches).toHaveLength(0);
    });
  });

  describe("enableSkill / disableSkill", () => {
    it("should enable a disabled skill", async () => {
      registry.register(makeSkill("test", false));
      await orchestrator.enableSkill("test");
      expect(registry.isEnabled("test")).toBe(true);
    });

    it("should disable an enabled skill", async () => {
      registry.register(makeSkill("test", true));
      await orchestrator.disableSkill("test");
      expect(registry.isEnabled("test")).toBe(false);
    });

    it("should throw when skill not found", async () => {
      await expect(orchestrator.enableSkill("unknown")).rejects.toThrow("not found");
    });
  });

  describe("batchToggleSkills", () => {
    it("should toggle multiple skills", async () => {
      registry.register(makeSkill("a", true));
      registry.register(makeSkill("b", true));

      await orchestrator.batchToggleSkills(["a", "b"], false);
      expect(registry.isEnabled("a")).toBe(false);
      expect(registry.isEnabled("b")).toBe(false);
    });
  });

  describe("getSkillDetail", () => {
    it("should return skill by ID", () => {
      registry.register(makeSkill("test"));
      const skill = orchestrator.getSkillDetail("test");
      expect(skill).toBeDefined();
      expect(skill!.id).toBe("test");
    });

    it("should return null for unknown skill", () => {
      expect(orchestrator.getSkillDetail("unknown")).toBeNull();
    });
  });
});
