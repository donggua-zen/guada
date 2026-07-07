import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";

function makeSkill(id: string, enabled = true): SkillDefinition {
  return {
    id,
    baseDir: '/tmp/skills',
    basePath: id,
    manifest: { name: id, description: `Skill ${id}` },
    contentHash: "abc123",
    source: "global",
    enabled,
  };
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("register", () => {
    it("should register a skill with enabled=true by default", () => {
      const skill = makeSkill("test-skill");
      delete (skill as any).enabled;
      registry.register(skill);
      expect(registry.get("test-skill")).toBeDefined();
      expect(registry.get("test-skill")!.enabled).toBe(true);
    });

    it("should preserve explicitly set enabled state", () => {
      const skill = makeSkill("disabled-skill", false);
      registry.register(skill);
      expect(registry.get("disabled-skill")!.enabled).toBe(false);
    });

    it("should warn and update when registering duplicate", () => {
      const skill1 = makeSkill("dup");
      const skill2 = makeSkill("dup");
      registry.register(skill1);
      registry.register(skill2); // should not throw
      expect(registry.getAll().size).toBe(1);
    });
  });

  describe("enable / disable", () => {
    it("should enable a disabled skill", async () => {
      const skill = makeSkill("test", false);
      registry.register(skill);
      await registry.enable("test");
      expect(registry.get("test")!.enabled).toBe(true);
      expect(registry.isEnabled("test")).toBe(true);
    });

    it("should disable an enabled skill", async () => {
      const skill = makeSkill("test", true);
      registry.register(skill);
      await registry.disable("test");
      expect(registry.get("test")!.enabled).toBe(false);
      expect(registry.isEnabled("test")).toBe(false);
    });

    it("should be idempotent when enabling already-enabled skill", async () => {
      const skill = makeSkill("test", true);
      registry.register(skill);
      await registry.enable("test"); // no-op
      expect(registry.get("test")!.enabled).toBe(true);
    });

    it("should be idempotent when disabling already-disabled skill", async () => {
      const skill = makeSkill("test", false);
      registry.register(skill);
      await registry.disable("test"); // no-op
      expect(registry.get("test")!.enabled).toBe(false);
    });

    it("should throw when enabling unknown skill", async () => {
      await expect(registry.enable("unknown")).rejects.toThrow("not found");
    });

    it("should throw when disabling unknown skill", async () => {
      await expect(registry.disable("unknown")).rejects.toThrow("not found");
    });
  });

  describe("batchToggle", () => {
    it("should toggle multiple skills at once", async () => {
      registry.register(makeSkill("a", true));
      registry.register(makeSkill("b", true));
      registry.register(makeSkill("c", false));

      await registry.batchToggle(["a", "b", "c"], false);

      expect(registry.isEnabled("a")).toBe(false);
      expect(registry.isEnabled("b")).toBe(false);
      expect(registry.isEnabled("c")).toBe(false);
    });

    it("should skip unknown skill IDs", async () => {
      registry.register(makeSkill("a", true));
      await registry.batchToggle(["a", "nonexistent"], false);
      expect(registry.isEnabled("a")).toBe(false);
    });
  });

  describe("getEnabled / getDisabled", () => {
    it("should return only enabled skills", () => {
      registry.register(makeSkill("enabled-1", true));
      registry.register(makeSkill("enabled-2", true));
      registry.register(makeSkill("disabled-1", false));

      const enabled = registry.getEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled.map((s) => s.id).sort()).toEqual(["enabled-1", "enabled-2"]);
    });

    it("should return only disabled skills", () => {
      registry.register(makeSkill("enabled-1", true));
      registry.register(makeSkill("disabled-1", false));
      registry.register(makeSkill("disabled-2", false));

      const disabled = registry.getDisabled();
      expect(disabled).toHaveLength(2);
      expect(disabled.map((s) => s.id).sort()).toEqual(["disabled-1", "disabled-2"]);
    });

    it("should treat undefined enabled as enabled", () => {
      const skill = makeSkill("test");
      delete (skill as any).enabled;
      registry.register(skill);
      // register sets enabled=true when undefined
      expect(registry.getEnabled()).toHaveLength(1);
    });
  });

  describe("isEnabled", () => {
    it("should return false for unknown skill", () => {
      expect(registry.isEnabled("nonexistent")).toBe(false);
    });

    it("should return true for enabled skill", () => {
      registry.register(makeSkill("test", true));
      expect(registry.isEnabled("test")).toBe(true);
    });

    it("should return false for disabled skill", () => {
      registry.register(makeSkill("test", false));
      expect(registry.isEnabled("test")).toBe(false);
    });
  });

  describe("unregister", () => {
    it("should remove a skill from registry", () => {
      registry.register(makeSkill("test"));
      registry.unregister("test");
      expect(registry.get("test")).toBeUndefined();
      expect(registry.getAll().size).toBe(0);
    });

    it("should not throw when unregistering unknown skill", () => {
      expect(() => registry.unregister("unknown")).not.toThrow();
    });
  });

  describe("update", () => {
    it("should update an existing skill", () => {
      registry.register(makeSkill("test"));
      const updated = makeSkill("test");
      updated.contentHash = "newhash";
      registry.update(updated);
      expect(registry.get("test")!.contentHash).toBe("newhash");
    });

    it("should throw when updating unknown skill", () => {
      expect(() => registry.update(makeSkill("unknown"))).toThrow("not found");
    });
  });

  describe("searchByTags", () => {
    it("should find skills by matching tags", () => {
      registry.register({
        ...makeSkill("alpha"),
        manifest: { name: "alpha", description: "Alpha", tags: ["test", "alpha"] },
      });
      registry.register({
        ...makeSkill("beta"),
        manifest: { name: "beta", description: "Beta", tags: ["test", "beta"] },
      });

      const result = registry.searchByTags(["alpha"]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("alpha");
    });

    it("should return empty when no tags match", () => {
      registry.register(makeSkill("test"));
      expect(registry.searchByTags(["nonexistent"])).toHaveLength(0);
    });

    it("should return empty when search tags array is empty", () => {
      registry.register(makeSkill("test"));
      expect(registry.searchByTags([])).toHaveLength(0);
    });
  });

  describe("onChange listeners", () => {
    it("should notify on register", () => {
      const listener = jest.fn();
      registry.onChange(listener);
      registry.register(makeSkill("test"));
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "registered", skill: expect.objectContaining({ id: "test" }) })
      );
    });

    it("should notify on enable", async () => {
      const listener = jest.fn();
      registry.register(makeSkill("test", false));
      registry.onChange(listener);
      await registry.enable("test");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "enabled", skillId: "test", enabled: true })
      );
    });

    it("should notify on disable", async () => {
      const listener = jest.fn();
      registry.register(makeSkill("test", true));
      registry.onChange(listener);
      await registry.disable("test");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "disabled", skillId: "test", enabled: false })
      );
    });

    it("should allow unsubscribing", () => {
      const listener = jest.fn();
      const unsubscribe = registry.onChange(listener);
      unsubscribe();
      registry.register(makeSkill("test"));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
