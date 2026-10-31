import { ToolkitCatalogService } from "./toolkit-catalog.service";
import type {
  ResolvedPluginInfo,
  ToolHandlerDef,
} from "../plugins/types/plugin.types";
import type { ISessionContext } from "../chat/session-context";

/**
 * ToolkitCatalogService 契约：懒加载工具包以"动态工具技能"暴露给 skill_learn。
 *
 * tool_learn 退役后的等价入口：listToolSkills 供技能清单使用，
 * resolveToolSkill + buildToolSkillContent 供 skill_learn fallback，
 * collectLearnedToolkits / hasCompleteSkillContent 供压缩记忆恢复。
 */

function makeTool(name: string, toolSet: string): ToolHandlerDef {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    toolSet,
    handler: async () => "ok",
  } as unknown as ToolHandlerDef;
}

function makeResolved(
  pluginId: string,
  kits: Array<{
    id: string;
    name?: string;
    loadMode: "eager" | "lazy" | "none";
    enabled?: boolean;
  }>,
  tools: ToolHandlerDef[],
  enabled = true,
): ResolvedPluginInfo {
  return {
    enabled,
    effective: "default",
    plugin: { id: pluginId, name: pluginId } as any,
    enabledTools: tools.filter(
      (t) =>
        kits.find((k) => k.id === t.toolSet)?.loadMode === "eager" ||
        kits.find((k) => k.id === t.toolSet) === undefined,
    ),
    allTools: tools,
    enabledToolKits: kits.map((k) => ({
      id: k.id,
      name: k.name || k.id,
      loadMode: k.loadMode,
      enabled: k.enabled !== false,
      toolCount: tools.filter((t) => t.toolSet === k.id).length,
      promptCount: 0,
    })),
    workspaceProviders: [],
    attachmentTypes: [],
  } as unknown as ResolvedPluginInfo;
}

function makeSession(resolved: ResolvedPluginInfo[]): ISessionContext {
  return {
    sessionId: "s1",
    getResolvedPlugins: () => resolved,
    getHistory: async () => [],
  } as unknown as ISessionContext;
}

function makeService(): ToolkitCatalogService {
  return new ToolkitCatalogService({} as any, {
    collectLazyPrompts: async () => [],
  } as any);
}

describe("ToolkitCatalogService listToolSkills", () => {
  it("只列 lazy 且启用的工具包", () => {
    const resolved = [
      makeResolved(
        "workflow",
        [{ id: "workflow", loadMode: "lazy" }, { id: "eager_kit", loadMode: "eager" }],
        [makeTool("workflow_run", "workflow")],
      ),
    ];
    const session = makeSession(resolved);
    const list = makeService().listToolSkills(session);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("workflow");
    expect(list[0].pluginId).toBe("workflow");
  });

  it("插件禁用或工具包禁用时不列出", () => {
    const resolved = [
      makeResolved("p1", [{ id: "k1", loadMode: "lazy" }], [], false),
      makeResolved(
        "p2",
        [{ id: "k2", loadMode: "lazy", enabled: false }],
        [],
      ),
    ];
    expect(makeService().listToolSkills(makeSession(resolved))).toHaveLength(0);
  });
});

describe("ToolkitCatalogService resolveToolSkill", () => {
  it("按 id 解析（不区分大小写）", () => {
    const resolved = [
      makeResolved("workflow", [{ id: "workflow", loadMode: "lazy" }], []),
    ];
    const entry = makeService().resolveToolSkill("Workflow", makeSession(resolved));
    expect(entry?.id).toBe("workflow");
  });

  it("按展示名解析", () => {
    const resolved = [
      makeResolved(
        "computer",
        [{ id: "computer", name: "Computer Use", loadMode: "lazy" }],
        [],
      ),
    ];
    const entry = makeService().resolveToolSkill("Computer Use", makeSession(resolved));
    expect(entry?.id).toBe("computer");
  });

  it("loadMode=none 不可学（压根不加载）", () => {
    const resolved = [
      makeResolved("p1", [{ id: "k1", loadMode: "none" }], []),
    ];
    expect(
      makeService().resolveToolSkill("k1", makeSession(resolved)),
    ).toBeUndefined();
  });

  it("插件禁用不可学", () => {
    const resolved = [
      makeResolved("p1", [{ id: "k1", loadMode: "lazy" }], [], false),
    ];
    expect(
      makeService().resolveToolSkill("k1", makeSession(resolved)),
    ).toBeUndefined();
  });
});

describe("ToolkitCatalogService buildToolSkillContent", () => {
  const context = (session: ISessionContext) =>
    ({ session, toolCallId: "tc" }) as any;

  it("输出 <tool_definition> JSON、首尾标记与 tool_use 用法", async () => {
    const svc = makeService();
    const resolved = [
      makeResolved(
        "workflow",
        [{ id: "workflow", loadMode: "lazy" }],
        [makeTool("workflow_run", "workflow")],
      ),
    ];
    const session = makeSession(resolved);
    const entry = svc.resolveToolSkill("workflow", session)!;

    const content = await svc.buildToolSkillContent(entry, context(session));

    expect(content).toContain("<!-- tool-skill:workflow -->");
    expect(content).toContain("<!-- /tool-skill:workflow -->");
    expect(content).toContain("toolkit workflow");
    expect(content).toContain("<tool_definition>");
    const parsed = JSON.parse(
      content.split("<tool_definition>")[1].split("</tool_definition>")[0].trim(),
    );
    expect(parsed.name).toBe("workflow_run");
    expect(parsed.parameters.type).toBe("object");
  });

  it("lazy 包工具从 allTools 收集（不在 enabledTools 也可学出）", async () => {
    const svc = makeService();
    const tool = makeTool("workflow_run", "workflow");
    const resolved = [
      makeResolved("workflow", [{ id: "workflow", loadMode: "lazy" }], [tool]),
    ];
    const session = makeSession(resolved);
    // enabledTools 不含 lazy 工具：makeResolved 已保证
    expect(resolved[0].enabledTools).toHaveLength(0);

    const entry = svc.resolveToolSkill("workflow", session)!;
    const content = await svc.buildToolSkillContent(entry, context(session));
    expect(content).toContain('"workflow_run"');
  });
});

describe("ToolkitCatalogService 历史扫描与压缩保护", () => {
  it("collectLearnedToolkits 识别 skill_learn 与 legacy tool_learn", async () => {
    const svc = makeService();
    const session = {
      sessionId: "s1",
      getResolvedPlugins: () => [],
      getHistory: async () => [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "a", name: "skill_learn", arguments: '{"name":"Workflow"}' },
            { type: "tool-call", toolCallId: "b", name: "tool_learn", arguments: '{"name":"computer"}' },
            { type: "tool-call", toolCallId: "c", name: "tool_use", arguments: '{"tool_name":"x"}' },
          ],
        },
      ],
    } as unknown as ISessionContext;

    const learned = await svc.collectLearnedToolkits(session);
    expect(learned.has("workflow")).toBe(true);
    expect(learned.has("computer")).toBe(true);
    expect(learned.size).toBe(2);
  });

  it("hasCompleteSkillContent：skill_learn/tool_learn 且首尾标记俱在", () => {
    const svc = makeService();
    const body = '<!-- tool-skill:workflow -->\ndef\n<!-- /tool-skill:workflow -->';
    expect(svc.hasCompleteSkillContent("skill_learn", body, "workflow")).toBe(true);
    expect(svc.hasCompleteSkillContent("tool_learn", body, "workflow")).toBe(true);
    // 头被裁掉
    expect(svc.hasCompleteSkillContent("skill_learn", body.slice(10), "workflow")).toBe(false);
    // 其他工具名
    expect(svc.hasCompleteSkillContent("read", body, "workflow")).toBe(false);
    // 其他 kit
    expect(svc.hasCompleteSkillContent("skill_learn", body, "computer")).toBe(false);
  });

  it("retiredToolkitMessage 透传退役提示", () => {
    const svc = makeService();
    expect(svc.retiredToolkitMessage("browser")).toContain("retired");
    expect(svc.retiredToolkitMessage("workflow")).toBeUndefined();
  });
});
