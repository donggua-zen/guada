/// <reference types="jest" />

import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import type { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";

/**
 * 插件启停 → 技能可见性过滤回归：
 * 禁用插件后，其注册的技能必须从「Skills 管理页（GET /skills）」「命令面板目录
 * （/skill fetchItems，无 session 路径）」以及 matchSkills / getMetadataInjection
 * 中消失；非插件技能与已启用插件的技能不受影响。
 */

function makeSkill(
  overrides: Partial<SkillDefinition> & { id: string },
): SkillDefinition {
  return {
    id: overrides.id,
    basePath: "__plugin__",
    manifest: {
      name: overrides.id,
      description: "desc",
      version: "0.5.0",
      ...(overrides.manifest || {}),
    },
    contentHash: "hash",
    content: "content",
    source: "system",
    enabled: true,
    ...overrides,
  } as SkillDefinition;
}

describe("SkillOrchestrator plugin-enabled filtering", () => {
  let registry: SkillRegistry;
  let orchestrator: SkillOrchestrator;
  let enabledStates: Record<string, boolean>;

  beforeEach(() => {
    enabledStates = {
      "guada-blender": false,
      handoff: true,
    };
    const pluginManagerStub = {
      isPluginEnabled: (pluginId: string) => enabledStates[pluginId] ?? false,
    };
    registry = new SkillRegistry();
    orchestrator = new SkillOrchestrator(
      { getSourceSkills: () => [] } as any,
      registry,
      {} as any,
      {} as any,
      pluginManagerStub as any,
      {} as any,
    );

    registry.register(
      makeSkill({ id: "blender-cameras", provider: "plugin:guada-blender" }),
    );
    registry.register(
      makeSkill({ id: "handoff-generate", provider: "plugin:handoff" }),
    );
    // 非插件技能（如内置 file 技能）：无 provider
    registry.register(makeSkill({ id: "file-read" }));
  });

  test("listSkills(false)（管理页/命令面板目录）隐藏禁用插件的技能", () => {
    const ids = orchestrator.listSkills(false).map((s) => s.id);
    expect(ids).not.toContain("blender-cameras");
    expect(ids).toContain("handoff-generate");
    expect(ids).toContain("file-read");
  });

  test("listSkills(true, ws, session) 会话路径同样过滤", () => {
    const session = { getResolvedPlugins: () => [] };
    const ids = orchestrator
      .listSkills(true, "/tmp/ws", session)
      .map((s) => s.id);
    expect(ids).not.toContain("blender-cameras");
    expect(ids).toContain("handoff-generate");
  });

  test("插件重新启用后恢复可见", () => {
    enabledStates["guada-blender"] = true;
    const ids = orchestrator.listSkills(false).map((s) => s.id);
    expect(ids).toContain("blender-cameras");
  });

  test("getMetadataInjection 不含禁用插件技能", () => {
    const meta = orchestrator.getMetadataInjection();
    expect(meta).not.toContain("blender-cameras");
    expect(meta).toContain("handoff-generate");
  });

  test("matchSkills 不匹配禁用插件技能", async () => {
    const matches = await orchestrator.matchSkills("blender-cameras");
    expect(matches.find((m) => m.skillId === "blender-cameras")).toBeUndefined();
  });
});
