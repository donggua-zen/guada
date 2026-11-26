import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SkillRegistry } from "../../src/modules/skills/core/skill-registry.service";
import { SkillDefinition } from "../../src/modules/skills/interfaces/skill-manifest.interface";
import { normalizeWorkspaceKey } from "../../src/common/utils/workspace-key.util";

/**
 * 项目作用域（Skills 管理页的项目下拉）
 *
 * 约束三件容易出错的事：
 * 1. 列表合并：全局 + 项目 `.guada/skills`，同名项目版本覆盖并打 `overridden`；
 * 2. 单技能解析：项目优先，同名绝不落到全局版本；
 * 3. skill_learn：项目技能「清单里有、学不到」的回归点。
 */

const PROJECT_PATH = "/work/demo-project";

function makeSkill(
  id: string,
  extra: Partial<SkillDefinition> = {},
): SkillDefinition {
  return {
    id,
    baseDir: "/skills",
    basePath: id,
    manifest: { name: id, description: `Skill ${id}` },
    contentHash: `hash-${id}`,
    source: "global",
    enabled: true,
    ...extra,
  } as SkillDefinition;
}

/** sourceManager 替身：只提供 orchestrator 实际用到的方法。
 * 按 pathKey 命中：只有 PROJECT_PATH 对应的键返回项目技能，其他目录为空。 */
function makeSourceManager(workspaceSkills: SkillDefinition[] = []) {
  const projectKey = normalizeWorkspaceKey(PROJECT_PATH);
  const ensureWorkspaceSource = jest.fn(async (workspacePath: string) =>
    normalizeWorkspaceKey(workspacePath) === projectKey ? workspaceSkills : [],
  );
  const replaced: SkillDefinition[] = [];
  return {
    ensureWorkspaceSource,
    getWorkspaceSkillsByPathKey: jest.fn((pathKey: string) =>
      pathKey === projectKey ? workspaceSkills : [],
    ),
    getSourceSkills: jest.fn(() => []),
    findWorkspaceSourceKey: jest.fn((pathKey: string) => `workspace_${pathKey}`),
    replaceSourceSkill: jest.fn((_key: string, skill: SkillDefinition) => {
      replaced.push(skill);
    }),
    getAllSkills: jest.fn(() => workspaceSkills),
    getEnabledSkills: jest.fn(() => workspaceSkills),
    restart: jest.fn(),
    __replaced: replaced,
  } as any;
}

function makeOrchestrator(
  registrySkills: SkillDefinition[],
  workspaceSkills: SkillDefinition[] = [],
  loaderOverride: Record<string, any> = {},
  disabledIds: string[] = [],
) {
  const registry = new SkillRegistry(undefined as any);
  for (const skill of registrySkills) registry.register(skill);

  const sourceManager = makeSourceManager(workspaceSkills);
  const loader = {
    loadInstructions: jest.fn(async (skill: SkillDefinition) =>
      `content:${skill.id}@${skill.source}`,
    ),
    reloadManifest: jest.fn(async (skill: SkillDefinition) => ({
      ...skill,
      contentHash: `${skill.contentHash}-reloaded`,
    })),
    ...loaderOverride,
  } as any;

  // 项目级禁用：只在 PROJECT_PATH 生效，其他目录不受影响
  const disabledSet = new Set(disabledIds.map((id) => id.toLowerCase()));
  const projectConfig = {
    getProjectDisabledIds: jest.fn((workspacePath?: string | null) =>
      workspacePath && normalizeWorkspaceKey(workspacePath) === normalizeWorkspaceKey(PROJECT_PATH)
        ? disabledSet
        : new Set<string>(),
    ),
    isProjectDisabled: jest.fn(
      (workspacePath: string | null | undefined, skillId: string) =>
        !!workspacePath &&
        normalizeWorkspaceKey(workspacePath) === normalizeWorkspaceKey(PROJECT_PATH) &&
        disabledSet.has(String(skillId).toLowerCase()),
    ),
    getGlobalDisabledIds: jest.fn(() => new Set<string>()),
    isGlobalDisabled: jest.fn(() => false),
  } as any;

  const orchestrator = new SkillOrchestrator(
    sourceManager,
    registry,
    loader,
    { recordUpdate: jest.fn(), recordInstall: jest.fn() } as any,
    { isPluginEnabled: () => true } as any,
    {
      resolveToolSkill: jest.fn(),
      retiredToolkitMessage: jest.fn(),
      buildToolSkillContent: jest.fn(),
      listToolSkills: jest.fn(() => []),
    } as any,
    projectConfig,
  );

  return { registry, sourceManager, loader, orchestrator, projectConfig };
}

describe("SkillOrchestrator 项目作用域", () => {
  it("无项目时：保持全局管理页口径（行为不变）", () => {
    const { orchestrator } = makeOrchestrator([makeSkill("global-a")]);
    const ids = orchestrator
      .listManageableSkillsForProject(undefined, false)
      .map((s) => s.id);
    expect(ids).toEqual(["global-a"]);
  });

  it("项目视图：全局 + 项目技能合并，同名项目版本覆盖并标记 overridden", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("shared-skill"), makeSkill("global-only")],
      [
        makeSkill("shared-skill", {
          source: "workspace",
          basePath: "shared-skill",
          manifest: { name: "shared-skill", description: "project version" },
        }),
        makeSkill("project-only", { source: "workspace" }),
      ],
    );

    const skills = orchestrator.listManageableSkillsForProject(
      PROJECT_PATH,
      false,
    );
    const byId = new Map(skills.map((s) => [s.id, s]));

    // 项目独有技能在列
    expect(byId.get("project-only")?.source).toBe("workspace");
    // 同名：只剩项目版本，且带覆盖标记
    expect(byId.get("shared-skill")?.manifest.description).toBe(
      "project version",
    );
    expect(byId.get("shared-skill")?.overridden).toBe(true);
    // 全局独有技能不标记
    expect(byId.get("global-only")?.overridden).toBeUndefined();
  });

  it("项目视图仍排除智能体专属技能", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a")],
      [makeSkill("scoped", { source: "workspace", visibleTo: ["self"] })],
    );
    const ids = orchestrator
      .listManageableSkillsForProject(PROJECT_PATH, false)
      .map((s) => s.id);
    expect(ids).toEqual(["global-a"]);
  });

  it("resolveEffectiveSkill：项目版本优先于全局同名版本", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("same-id", { manifest: { name: "same-id", description: "global" } })],
      [
        makeSkill("same-id", {
          source: "workspace",
          manifest: { name: "same-id", description: "project" },
        }),
      ],
    );

    expect(
      orchestrator.resolveEffectiveSkill("same-id", PROJECT_PATH)?.manifest
        .description,
    ).toBe("project");
    // 不带项目时仍是全局版本（其他智能体/会话口径不受影响）
    expect(
      orchestrator.resolveEffectiveSkill("same-id")?.manifest.description,
    ).toBe("global");
  });

  it("resolveEffectiveSkill：管理面排除智能体专属技能，非管理面放行", () => {
    const { orchestrator } = makeOrchestrator([
      makeSkill("scoped", { visibleTo: ["self"] }),
    ]);

    expect(orchestrator.resolveEffectiveSkill("scoped")).toBeNull();
    expect(
      orchestrator.resolveEffectiveSkill("scoped", undefined, false)?.id,
    ).toBe("scoped");
  });

  it("getManageableSkillDetail：项目独有技能可查，缺失返回 null", () => {
    const { orchestrator } = makeOrchestrator(
      [],
      [makeSkill("project-only", { source: "workspace" })],
    );

    expect(
      orchestrator.getManageableSkillDetail("project-only", PROJECT_PATH)?.source,
    ).toBe("workspace");
    expect(
      orchestrator.getManageableSkillDetail("project-only", "/other/project"),
    ).toBeNull();
  });

  it("skillLearn：学到项目版本，而不是全局同名版本", async () => {
    const { orchestrator, loader } = makeOrchestrator(
      [makeSkill("same-id")],
      [makeSkill("same-id", { source: "workspace" })],
    );

    const result = await orchestrator.skillLearn("same-id", {
      workspacePath: PROJECT_PATH,
    });

    expect(result?.content).toBe("content:same-id@workspace");
    expect(loader.loadInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ source: "workspace" }),
    );
  });

  it("skillLearn：项目独有技能可学习（此前会返回 null）", async () => {
    const { orchestrator } = makeOrchestrator(
      [],
      [makeSkill("project-only", { source: "workspace" })],
    );

    const result = await orchestrator.skillLearn("project-only", {
      workspacePath: PROJECT_PATH,
    });

    expect(result?.name).toBe("project-only");
    expect(result?.content).toBe("content:project-only@workspace");
    // 文件型技能：位置头取自项目目录
    expect(result?.baseDirectory).toContain("project-only");
  });

  it("skillLearn：项目目录为空时回落到全局注册表", async () => {
    const { orchestrator } = makeOrchestrator([makeSkill("global-a")], []);

    const result = await orchestrator.skillLearn("global-a", {
      workspacePath: PROJECT_PATH,
    });

    expect(result?.content).toBe("content:global-a@global");
  });

  it("reloadSkill：项目技能回写来源缓存，不进注册表、不写版本记录", async () => {
    const { orchestrator, registry, sourceManager } = makeOrchestrator(
      [makeSkill("same-id")],
      [makeSkill("same-id", { source: "workspace" })],
    );

    const updated = await orchestrator.reloadSkill("same-id", PROJECT_PATH);

    expect(updated.contentHash).toBe("hash-same-id-reloaded");
    expect(sourceManager.replaceSourceSkill).toHaveBeenCalledTimes(1);
    // 全局同名版本未被污染
    expect(registry.get("same-id")?.contentHash).toBe("hash-same-id");
  });

  it("reloadSkill：全局技能仍走注册表更新", async () => {
    const { orchestrator, registry } = makeOrchestrator([makeSkill("global-a")]);

    await orchestrator.reloadSkill("global-a");

    expect(registry.get("global-a")?.contentHash).toBe("hash-global-a-reloaded");
  });
});

/**
 * 项目级开关（`<项目>/.guada/skills.yaml`）
 *
 * 核心语义：只能收紧不能放宽。
 * - 项目可以关掉「继承来的全局技能」；
 * - 项目不能把「全局已禁用」的技能重新启用；
 * - 学习入口与清单必须同口径，否则会出现"列表看不到但技能名可学"的后门。
 */
describe("SkillOrchestrator 项目级开关", () => {
  it("列出被项目禁用的技能：enabled=false 且打 projectDisabled", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a"), makeSkill("global-b")],
      [],
      {},
      ["global-a"],
    );

    const skills = orchestrator.listSkills(false, PROJECT_PATH);
    const byId = new Map(skills.map((s) => [s.id, s]));

    expect(byId.get("global-a")?.enabled).toBe(false);
    expect(byId.get("global-a")?.projectDisabled).toBe(true);
    // 未被禁用的不受影响
    expect(byId.get("global-b")?.enabled).toBe(true);
    expect(byId.get("global-b")?.projectDisabled).toBeUndefined();
  });

  it("项目禁用只影响该项目：换一个目录仍可用", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a")],
      [],
      {},
      ["global-a"],
    );

    expect(orchestrator.listSkills(false, PROJECT_PATH)[0].enabled).toBe(false);
    expect(orchestrator.listSkills(false, "/other/project")[0].enabled).toBe(true);
  });

  it("filterEnabled=true（会话/prompt 口径）时被禁用技能直接消失", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a"), makeSkill("global-b")],
      [],
      {},
      ["global-a"],
    );

    const enabled = orchestrator.listSkills(true, PROJECT_PATH).map((s) => s.id);

    expect(enabled).toEqual(["global-b"]);
  });

  it("不污染注册表：全局视图仍是启用状态", () => {
    const { orchestrator, registry } = makeOrchestrator(
      [makeSkill("global-a")],
      [],
      {},
      ["global-a"],
    );

    orchestrator.listSkills(false, PROJECT_PATH);

    // 管理面（无项目）与注册表本身都不受影响
    expect(registry.get("global-a")?.enabled).toBe(true);
    expect(orchestrator.listSkills(false)[0].enabled).toBe(true);
  });

  it("项目自带技能也能被项目禁用（同 id 覆盖后判定）", () => {
    const { orchestrator } = makeOrchestrator(
      [],
      [makeSkill("project-only", { source: "workspace" })],
      {},
      ["project-only"],
    );

    const skill = orchestrator.listManageableSkillsForProject(PROJECT_PATH, false)[0];

    expect(skill.enabled).toBe(false);
    expect(skill.projectDisabled).toBe(true);
  });

  it("skillLearn：被项目禁用的技能等同不存在（关闭后门）", async () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a")],
      [],
      {},
      ["global-a"],
    );

    await expect(
      orchestrator.skillLearn("global-a", { workspacePath: PROJECT_PATH }),
    ).resolves.toBeNull();

    // 同技能在其他项目仍可学习
    const other = await orchestrator.skillLearn("global-a", {
      workspacePath: "/other/project",
    });
    expect(other?.content).toBe("content:global-a@global");
  });

  it("skillLearn：无项目上下文（管理页/命令面板）不受项目禁用影响", async () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("global-a")],
      [],
      {},
      ["global-a"],
    );

    const result = await orchestrator.skillLearn("global-a");
    expect(result?.content).toBe("content:global-a@global");
  });

  it("resolveProjectEnabled：四种组合的可点性与实际状态", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("gl-on"), makeSkill("gl-off", { enabled: false })],
      [],
      {},
      ["gl-on"],
    );

    // 全局启用 + 项目未禁用 → 可用、可点
    expect(orchestrator.resolveProjectEnabled("gl-on", "/other/project")).toEqual({
      enabled: true,
      lockedByGlobal: false,
      projectDisabled: false,
    });

    // 全局启用 + 项目禁用 → 不可用，但仍可点（点=取消禁用）
    expect(orchestrator.resolveProjectEnabled("gl-on", PROJECT_PATH)).toEqual({
      enabled: false,
      lockedByGlobal: false,
      projectDisabled: true,
    });

    // 全局禁用 + 项目未列出 → 不可用，锁定（项目无法放宽）
    expect(orchestrator.resolveProjectEnabled("gl-off", PROJECT_PATH)).toEqual({
      enabled: false,
      lockedByGlobal: true,
      projectDisabled: false,
    });

    // 全局禁用 + 项目也列出 → 仍不可用且锁定
    expect(orchestrator.resolveProjectEnabled("gl-off", PROJECT_PATH)).toMatchObject({
      enabled: false,
      lockedByGlobal: true,
    });
  });

  it("全局已禁用的技能不会被项目配置重新启用", () => {
    const { orchestrator } = makeOrchestrator(
      [makeSkill("gl-off", { enabled: false })],
      [],
      {},
      [], // 项目未列出它
    );

    const skills = orchestrator.listSkills(false, PROJECT_PATH);
    expect(skills.find((s) => s.id === "gl-off")?.enabled).toBe(false);
  });
});
