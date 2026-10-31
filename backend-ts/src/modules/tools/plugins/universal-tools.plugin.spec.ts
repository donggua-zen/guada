import { UniversalToolsPlugin } from "./universal-tools.plugin";
import { ToolkitCatalogService } from "../toolkit-catalog.service";
import type { ToolCallResponse } from "../interfaces/tool-provider.interface";

/**
 * tool_use 通道的结果透传契约。
 *
 * tool_use 是懒加载工具的调用入口，它把内层工具的结果重新包一层返回。若只透传
 * content（旧行为），内层工具的 meta 会在此被静默丢弃——例如 todo 的待办列表
 * meta，会导致分支会话无法从历史还原 TODO。images 同理（多模态图片返回）。
 *
 * 工具包学习入口已迁至 skill_learn（经 ToolkitCatalogService），本文件聚焦
 * tool_use 透传与 # LEARNED TOOLKITS 压缩恢复。
 */

const INNER_META = {
  card: "todo",
  action: "update",
  items: [{ content: "第一步", status: "pending" }],
};

/** 用假 api 捕获注册的工具定义，取出 tool_use 的 execute */
async function loadToolUse(
  executeTool: (...args: any[]) => Promise<Partial<ToolCallResponse>>,
) {
  const calls: any[][] = [];
  const orchestrator = {
    executeTool: async (...args: any[]) => {
      calls.push(args);
      return executeTool(...args);
    },
  };
  const plugin = new UniversalToolsPlugin(
    orchestrator as any,
    {} as ToolkitCatalogService,
    {} as any,
  );

  const tools = new Map<string, any>();
  const api: any = {
    registerNls: () => {},
    registerToolKit: () => ({
      registerTool: (def: any) => tools.set(def.name, def),
      registerPrompt: () => {},
    }),
    registerPrompt: () => {},
  };
  await plugin.onLoad(api);

  const toolUse = tools.get("tool_use");
  if (!toolUse) throw new Error("tool_use 未注册");
  return { execute: toolUse.execute as any, calls, tools };
}

const ctx = () =>
  ({
    session: { sessionId: "s1", workspacePath: "/tmp/ws" },
    toolCallId: "tc-outer",
  }) as any;

const IMAGE = { type: "image", data: "base64", media_type: "image/png" };

describe("UniversalToolsPlugin tool_use 结果透传", () => {
  it("透传内层 meta（无 images）", async () => {
    const { execute } = await loadToolUse(async () => ({
      content: "待办列表",
      meta: INNER_META,
    }));

    const result = await execute(
      { tool_name: "todo", arguments: { action: "update" } },
      ctx(),
    );

    expect(result).toEqual({ content: "待办列表", meta: INNER_META });
  });

  it("同时透传 images 与 meta", async () => {
    const images = [IMAGE];
    const { execute } = await loadToolUse(async () => ({
      content: "图",
      images,
      meta: INNER_META,
    }));

    const result = await execute({ tool_name: "read", arguments: {} }, ctx());

    expect(result).toEqual({ content: "图", images, meta: INNER_META });
  });

  it("只有 images 时保持原形状（不带空 meta 键）", async () => {
    const images = [IMAGE];
    const { execute } = await loadToolUse(async () => ({
      content: "图",
      images,
    }));

    const result = await execute({ tool_name: "read", arguments: {} }, ctx());

    expect(result).toEqual({ content: "图", images });
    expect("meta" in result).toBe(false);
  });

  it("两者都无时返回裸字符串（沿用旧行为）", async () => {
    const { execute } = await loadToolUse(async () => ({ content: "纯文本" }));

    const result = await execute({ tool_name: "read", arguments: {} }, ctx());

    expect(result).toBe("纯文本");
  });

  it("以 allowLazy 调用内层工具，并沿用外层真实 callId", async () => {
    const { execute, calls } = await loadToolUse(async () => ({
      content: "ok",
    }));

    await execute({ tool_name: "some_lazy_tool", arguments: { a: 1 } }, ctx());

    expect(calls[0][0]).toBe("some_lazy_tool");
    expect(calls[0][1]).toEqual({ a: 1 });
    expect(calls[0][2]).toBe("tc-outer");
    expect(calls[0][5]).toEqual({ allowLazy: true });
  });

  it("无会话上下文时返回错误串且不调用内层工具", async () => {
    const { execute, calls } = await loadToolUse(async () => ({
      content: "ok",
    }));

    const result = await execute({ tool_name: "todo", arguments: {} }, {});

    expect(result).toContain("Error");
    expect(calls).toHaveLength(0);
  });

  it("tool_learn 已退役：不再注册，tool_use 描述指向 skill_learn", async () => {
    const { tools } = await loadToolUse(async () => ({ content: "ok" }));
    expect(tools.has("tool_learn")).toBe(false);
    expect(tools.get("tool_use").description).toContain("skill_learn");
  });
});

/**
 * # LEARNED TOOLKITS 压缩恢复契约。
 *
 * 二级压缩后 skill_learn/tool_learn 的定义正文可能离开可见历史，此时按仍在
 * 历史里的 tool_use 调用反查所属 lazy 包并重新注入完整定义；若定义正文仍完整
 * （首尾标记俱在）则跳过，避免重复占用上下文。
 */
describe("UniversalToolsPlugin # LEARNED TOOLKITS 恢复", () => {
  const toolDef = {
    name: "workflow_run",
    description: "run a workflow",
    parameters: { type: "object", properties: {} },
    toolSet: "workflow",
    handler: async () => "ok",
  };

  const makeCtx = (history: any[]) =>
    ({
      session: {
        sessionId: "s1",
        getHistory: async () => history,
        getResolvedPlugins: () => [
          {
            enabled: true,
            plugin: { id: "workflow", name: "workflow" },
            enabledTools: [],
            allTools: [toolDef],
            enabledToolKits: [
              {
                id: "workflow",
                name: "workflow",
                loadMode: "lazy",
                enabled: true,
                toolCount: 1,
                promptCount: 0,
              },
            ],
            workspaceProviders: [],
            attachmentTypes: [],
          },
        ],
      },
      toolCallId: "tc",
    }) as any;

  const makePlugin = () =>
    new UniversalToolsPlugin(
      {} as any,
      new ToolkitCatalogService({} as any, { collectLazyPrompts: async () => [] } as any),
      { collectLazyPrompts: async () => [] } as any,
    );

  const assistantCall = (name: string, args: object) => ({
    id: "m1",
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: "tc1", name, arguments: JSON.stringify(args) },
    ],
  });

  it("定义被压缩裁掉时按 tool_use 历史重建", async () => {
    const plugin = makePlugin();
    const ctx = makeCtx([
      assistantCall("tool_use", { tool_name: "workflow_run", arguments: "{}" }),
      // 旧 tool_learn 定义已被二级压缩遮蔽（历史中无结果正文）
    ]);
    const prompt = await (plugin as any).buildToolkitMemoryPrompt(ctx);
    expect(prompt).toContain("# LEARNED TOOLKITS");
    expect(prompt).toContain('"workflow_run"');
  });

  it("定义正文仍完整时跳过注入", async () => {
    const plugin = makePlugin();
    const complete =
      "<!-- tool-skill:workflow -->\n<tool_definition>{}</tool_definition>\n<!-- /tool-skill:workflow -->";
    const ctx = makeCtx([
      assistantCall("tool_use", { tool_name: "workflow_run", arguments: "{}" }),
      {
        id: "m2",
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc1", name: "skill_learn", content: complete }],
      },
    ]);
    const prompt = await (plugin as any).buildToolkitMemoryPrompt(ctx);
    expect(prompt).toBe("");
  });

  it("skill_learn 调用仍在历史且无完整正文时也不重复注入（按已学名称对齐 kit id）", async () => {
    const plugin = makePlugin();
    const ctx = makeCtx([
      assistantCall("skill_learn", { name: "workflow" }),
      assistantCall("tool_use", { tool_name: "workflow_run", arguments: "{}" }),
    ]);
    const prompt = await (plugin as any).buildToolkitMemoryPrompt(ctx);
    expect(prompt).toBe("");
  });

  it("legacy tool_learn 调用同样对齐", async () => {
    const plugin = makePlugin();
    const ctx = makeCtx([
      assistantCall("tool_learn", { name: "workflow" }),
      assistantCall("tool_use", { tool_name: "workflow_run", arguments: "{}" }),
    ]);
    const prompt = await (plugin as any).buildToolkitMemoryPrompt(ctx);
    expect(prompt).toBe("");
  });

  it("历史无 tool_use 时不注入", async () => {
    const plugin = makePlugin();
    const ctx = makeCtx([assistantCall("skill_learn", { name: "workflow" })]);
    expect(await (plugin as any).buildToolkitMemoryPrompt(ctx)).toBe("");
  });
});
