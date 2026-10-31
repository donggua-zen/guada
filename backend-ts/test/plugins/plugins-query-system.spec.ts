import { PluginsController } from "../../src/modules/plugins/plugins.controller";

/**
 * /plugins/query 的系统插件 opt-in 语义。
 *
 * 背景：系统插件（category=system）恒启用、不可禁用，默认不返回——
 * 智能体工具配置页等消费方不应看到它们的工具包。插件管理页通过
 * `includeSystem: true` 显式请求。
 */
describe("PluginsController.queryPlugins — 系统插件 opt-in", () => {
  let pluginManager: any;
  let nlsService: any;
  let controller: PluginsController;

  const nls = {
    resolveString: (_id: string, str: string) => str,
    resolveDisplay: (_id: string, display: any) => display,
  };

  function makeResolved(
    id: string,
    category: string,
    essential?: boolean,
  ) {
    return {
      enabled: true,
      effective: "default",
      plugin: { id, name: id, description: "", version: "1.0.0", category, essential },
      enabledTools: [],
      allTools: [],
      enabledToolKits: [],
      source: "builtin",
    };
  }

  beforeEach(() => {
    nlsService = { ...nls };
    pluginManager = {
      resolvePlugins: jest.fn().mockResolvedValue([
        makeResolved("universal_tools", "system", true),
        makeResolved("remote-workspace", "system", true),
        makeResolved("skill", "system"),
        makeResolved("file", "core"),
        makeResolved("web-search", "extended"),
        makeResolved("hello-plugin", "user"),
      ]),
    };
    controller = new PluginsController(
      pluginManager,
      {} as any,
      nlsService,
      {} as any,
    );
  });

  it("默认（不传 includeSystem）不返回系统插件", async () => {
    const result = await controller.queryPlugins({});

    expect(result.plugins.map((p: any) => p.pluginId)).toEqual([
      "file",
      "web-search",
      "hello-plugin",
    ]);
    expect(result.plugins.every((p: any) => p.category !== "system")).toBe(true);
  });

  it("includeSystem: true 返回全部插件，含系统插件", async () => {
    const result = await controller.queryPlugins({ includeSystem: true });

    const ids = result.plugins.map((p: any) => p.pluginId);
    expect(ids).toEqual([
      "universal_tools",
      "remote-workspace",
      "skill",
      "file",
      "web-search",
      "hello-plugin",
    ]);
    expect(ids).toContain("universal_tools");
    expect(ids).toContain("remote-workspace");
  });

  it("系统插件条目带 category=system 与 essential 字段，供前端判定不可禁用", async () => {
    const result = await controller.queryPlugins({ includeSystem: true });
    const byId = new Map(result.plugins.map((p: any) => [p.pluginId, p]));

    const universal = byId.get("universal_tools") as any;
    expect(universal.category).toBe("system");
    expect(universal.essential).toBe(true);

    const skill = byId.get("skill") as any;
    expect(skill.category).toBe("system");
    // 非 essential 的系统插件也应带 false/undefined，前端靠 category 兜底
    expect(skill.essential).toBeUndefined();

    const file = byId.get("file") as any;
    expect(file.category).toBe("core");
    expect(file.essential).toBeUndefined();
  });

  it("includeSystem 为 false 或非布尔值时保持默认过滤", async () => {
    const falseResult = await controller.queryPlugins({ includeSystem: false });
    expect(falseResult.plugins.every((p: any) => p.category !== "system")).toBe(true);

    const undefinedResult = await controller.queryPlugins({});
    expect(undefinedResult.plugins.every((p: any) => p.category !== "system")).toBe(true);
  });

  it("GET /plugins/global 仍按默认过滤（旧接口行为不变）", async () => {
    const result = await controller.getGlobalPlugins();
    expect(result.plugins.every((p: any) => p.category !== "system")).toBe(true);
  });
});
