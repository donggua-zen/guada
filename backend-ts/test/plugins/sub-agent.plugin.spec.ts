import { SubAgentPlugin } from "../../src/modules/sub-agent/sub-agent.plugin";
import type { PluginApi } from "../../src/modules/plugins/api/plugin-api";

/**
 * SubAgentPlugin 的注册契约。
 *
 * 该插件此前零测试覆盖，而它同时承载两件事：
 * 1. 子代理工具面（toolkit `subagent` + 工具 `subagent_spawn` + 提示词）
 * 2. `@` 唤起智能体（命令提供者 id `agent`）—— 由原独立插件 `agent` 合并而来
 *
 * 第 2 项的命令提供者 id 必须保持 "agent"：前端序列化为 `[@agent:<id> ...]`，
 * TagParserPipeline 按标签 type 反查解析器，改 id 会让历史消息全部失效。
 */

/** 捕获 onLoad 期间所有注册的假 PluginApi */
function makeApi() {
  const captured: {
    nls: Record<string, any>;
    toolkitDefs: any[];
    tools: any[];
    prompts: any[];
    commandProviders: any[];
  } = { nls: {}, toolkitDefs: [], tools: [], prompts: [], commandProviders: [] };

  const api = {
    registerNls: (locale: string, bundle: any) => {
      captured.nls[locale] = bundle;
    },
    registerToolKit: (def: any) => {
      captured.toolkitDefs.push(def);
      return {
        id: def.id,
        name: def.name,
        registerTool: (toolDef: any) => {
          captured.tools.push(toolDef);
        },
        registerPrompt: (promptDef: any) => {
          captured.prompts.push(promptDef);
        },
      };
    },
    registerCommandProvider: (def: any) => {
      captured.commandProviders.push(def);
    },
  } as unknown as PluginApi;

  return { api, captured };
}

function makeAgent(id: string, name?: string, description?: string) {
  return {
    id,
    name: name ?? id,
    description: description ?? "",
    settings: {},
  };
}

function makePlugin(agents: any[] = []) {
  const agentStore: any = {
    listAgents: jest.fn().mockResolvedValue(agents),
    findById: jest.fn(async (id: string) => agents.find((a) => a.id === id)),
  };
  const subAgentManager: any = { spawn: jest.fn() };
  return { plugin: new SubAgentPlugin(subAgentManager, agentStore), agentStore };
}

describe("SubAgentPlugin 注册契约", () => {
  it("manifest 保持 sub_agent 且图标指向 sub_agent.svg", () => {
    const { plugin } = makePlugin();
    expect(plugin.manifest.id).toBe("sub_agent");
    expect(plugin.manifest.category).toBe("system");
    expect(plugin.manifest.icon).toBe("images/plugins/sub_agent.svg");
  });

  it("onLoad 同时注册子代理工具面与 @ 唤起提供者", async () => {
    const { plugin } = makePlugin();
    const { api, captured } = makeApi();

    await plugin.onLoad(api);

    // 中英 NLS 都注册
    expect(Object.keys(captured.nls).sort()).toEqual(["en", "zh"]);

    // toolkit + tool + prompt
    expect(captured.toolkitDefs.map((k) => k.id)).toEqual(["subagent"]);
    expect(captured.tools.map((t) => t.name)).toEqual(["subagent_spawn"]);
    expect(captured.prompts).toHaveLength(1);

    // @ 唤起提供者（合并自原 agent 插件）
    expect(captured.commandProviders).toHaveLength(1);
    expect(captured.commandProviders[0].id).toBe("agent");
    expect(captured.commandProviders[0].trigger).toBe("mention");
  });

  it("subagent_spawn 描述把“跨文件调研/并行”写成显式用途", async () => {
    const { plugin } = makePlugin();
    const { api, captured } = makeApi();
    await plugin.onLoad(api);

    const description = String(captured.tools[0].description);
    expect(description).toContain("research/explore the codebase in parallel");
    expect(description).toContain("multiple files, directories, or naming conventions");
    expect(description).toContain("you only need the conclusion, not the file dumps");
    expect(description).toContain("Once you delegate a search, do not also run it yourself");
    expect(description).toContain("In plan mode, sub-agents run read-only");
  });

  it("agentId 为可选：省略时走 generic，schema 不再拒绝", async () => {
    const { plugin } = makePlugin();
    const { api, captured } = makeApi();
    await plugin.onLoad(api);

    const schema = captured.tools[0].inputSchema;
    expect(() => schema.parse({ name: "调研", task: "查一下" })).not.toThrow();
    expect(() =>
      schema.parse({ name: "调研", task: "查一下", agentId: "generic" }),
    ).not.toThrow();
  });

  it("使用指南包含广搜委派、单文件直查与计划模式只读约束", async () => {
    const { plugin } = makePlugin();
    const { api, captured } = makeApi();
    await plugin.onLoad(api);

    const text = await captured.prompts[0].content({
      session: {
        sessionType: "web",
        getSettings: () => ({ generic: true }),
      },
    });

    expect(text).toContain("Broad codebase exploration/research across multiple files");
    expect(text).toContain("single known-file lookup");
    expect(text).toContain("In plan mode, sub-agents are read-only");
    expect(text).toContain("do not repeat the same search yourself");
  });

  it("toolkit 的自治理标记与递归保护保持不变", async () => {
    const { plugin } = makePlugin();
    const { api, captured } = makeApi();
    await plugin.onLoad(api);

    const kit = captured.toolkitDefs[0];
    expect(kit.governance).toBe("self");
    expect(kit.loadMode).toBe("eager");

    // 子代理会话内不再注入子代理工具（禁止递归）
    const inSubSession = await kit.handler({
      session: { sessionType: "sub_agent" },
      pluginsConfig: undefined,
    });
    expect(inSubSession).toEqual({ loadMode: "none" });
  });
});

describe("SubAgentPlugin @ 唤起提供者", () => {
  async function getProvider(agents: any[]) {
    const { plugin } = makePlugin(agents);
    const { api, captured } = makeApi();
    await plugin.onLoad(api);
    return captured.commandProviders[0];
  }

  it("无 agentId 上下文时返回全部智能体（向后兼容）", async () => {
    const provider = await getProvider([
      makeAgent("a", "Agent A"),
      makeAgent("b", "Agent B"),
    ]);

    const items = await provider.fetchItems(undefined);

    expect(items.map((i: any) => i.name)).toEqual(["a", "b"]);
  });

  it("排除当前会话自身的智能体", async () => {
    const provider = await getProvider([
      makeAgent("a", "Agent A"),
      makeAgent("b", "Agent B"),
    ]);

    const items = await provider.fetchItems({ agentId: "a" });

    // agent a 无 settings.agents → 返回全部候选（已排除自身）
    expect(items.map((i: any) => i.name)).toEqual(["b"]);
  });

  it("settings.agents === false 时返回空列表", async () => {
    const agents = [
      makeAgent("a"),
      makeAgent("b"),
    ];
    agents[0].settings = { agents: false } as any;
    const provider = await getProvider(agents);

    const items = await provider.fetchItems({ agentId: "a" });

    expect(items).toEqual([]);
  });

  it("固定白名单：只保留显式 true 的智能体", async () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    agents[0].settings = { agents: { b: true, c: false } } as any;
    const provider = await getProvider(agents);

    const items = await provider.fetchItems({ agentId: "a" });

    expect(items.map((i: any) => i.name)).toEqual(["b"]);
  });

  it("parse 对不存在的 agentId 返回 undefined", async () => {
    const provider = await getProvider([makeAgent("a", "Agent A")]);

    const result = await provider.parse({ name: "missing" });

    expect(result).toBeUndefined();
  });

  it("parse 产出 <available_agents> 附录（供模型识别被 @ 的智能体）", async () => {
    const provider = await getProvider([
      makeAgent("a", "Agent A", "does A things"),
    ]);

    const result = await provider.parse({ name: "a" });

    expect(result?.appendix).toContain("<available_agents>");
    expect(result?.appendix).toContain("id:a");
    expect(result?.appendix).toContain("description:does A things");
  });

  it("parse 在智能体无描述时不产出附录", async () => {
    const provider = await getProvider([makeAgent("a", "Agent A", "")]);

    const result = await provider.parse({ name: "a" });

    expect(result?.appendix).toBeUndefined();
  });
});
