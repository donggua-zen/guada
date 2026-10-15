import { z } from "zod";
import { Toolkit } from "../../plugins/toolkit/toolkit";
import { UniversalToolsPlugin } from "./universal-tools.plugin";
import type { ToolCallResponse } from "../interfaces/tool-provider.interface";

/**
 * tool_use 通道的结果透传契约。
 *
 * tool_use 是懒加载工具的调用入口，它把内层工具的结果重新包一层返回。若只透传
 * content（旧行为），内层工具的 meta 会在此被静默丢弃——例如 todo 的待办列表
 * meta，会导致分支会话无法从历史还原 TODO。images 同理（多模态图片返回）。
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
    {} as any,
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
  return { execute: toolUse.execute as any, calls };
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
});

/**
 * tool_learn 的 schema 形状透传契约。
 *
 * 懒加载工具（workflow 的 workflow_run 等）模型只能经 tool_learn 学到定义，
 * 所以这里是"模型到底看得见什么形状"的唯一入口。此前 buildToolkitContent 手写投影
 * 只保留 type/description/required/enum/default，嵌套的 items/properties 被丢弃，
 * 模型看不到 phases 的元素形状（写成字符串数组 → 参数校验失败）。
 * 现改为按原生 {name, description, parameters} 形状输出单个 JSON 对象，
 * parameters 直接复用 toolkit 已限深展平的 JSON Schema，与 eager 工具形态一致。
 */
describe("UniversalToolsPlugin tool_learn：schema 形状透传", () => {
  /** 经真实 Toolkit 注册，复现 workflow_run 的注册链路（z.toJSONSchema + 限深展平） */
  const makeToolDef = (inputSchema: any) => {
    const tk = new Toolkit({ id: "t", name: "t" } as any, "plugin-x");
    tk.registerTool({
      name: "workflow_run",
      description: "run a workflow",
      inputSchema,
      execute: async () => "ok",
    } as any);
    return tk.getTools()[0];
  };

  const buildContent = async (toolDef: any) => {
    const plugin = new UniversalToolsPlugin({} as any, {} as any, {} as any);
    return (plugin as any).buildToolkitContent("workflow", [toolDef], "plugin-x", [], {
      session: { sessionId: "s1" },
      toolCallId: "tc",
    } as any) as Promise<string>;
  };

  /** 取出 <tool_definition> 块并解析为 JSON（同时验证其内容确为合法 JSON） */
  const parseTool = (content: string) =>
    JSON.parse(
      content
        .split("<tool_definition>")[1]
        .split("</tool_definition>")[0]
        .trim(),
    );

  it("按原生 {name, description, parameters} 形状输出单个 JSON 对象", async () => {
    const toolDef = makeToolDef(
      z.object({ name: z.string().describe("Workflow name") }),
    );

    const tool = parseTool(await buildContent(toolDef));

    expect(Object.keys(tool)).toEqual(["name", "description", "parameters"]);
    expect(tool.name).toBe("workflow_run");
    expect(tool.description).toBe("run a workflow");
    expect(tool.parameters.type).toBe("object");
  });

  it("保留嵌套 items/properties/required —— phases 元素形状对模型可见", async () => {
    const toolDef = makeToolDef(
      z.object({
        name: z.string().describe("Workflow name"),
        phases: z
          .array(
            z.object({
              title: z.string().describe("Phase title"),
              detail: z
                .string()
                .optional()
                .describe("What happens in this phase"),
            }),
          )
          .optional()
          .describe("Optional phase declarations"),
      }),
    );

    const { parameters } = parseTool(await buildContent(toolDef));

    expect(parameters.required).toEqual(["name"]);
    expect(parameters.properties.phases.type).toBe("array");
    expect(parameters.properties.phases.items.type).toBe("object");
    expect(parameters.properties.phases.items.properties.title).toEqual({
      type: "string",
      description: "Phase title",
    });
    expect(parameters.properties.phases.items.required).toEqual(["title"]);
  });

  it("标量参数形状不变（回归）", async () => {
    const toolDef = makeToolDef(
      z.object({
        name: z.string().describe("Workflow name"),
        description: z.string().optional().describe("One-line description"),
      }),
    );

    const { parameters } = parseTool(await buildContent(toolDef));

    expect(parameters.properties.name).toEqual({
      type: "string",
      description: "Workflow name",
    });
    expect(parameters.properties.description).toEqual({
      type: "string",
      description: "One-line description",
    });
    expect(parameters.required).toEqual(["name"]);
  });

  it("描述里的裸尖括号走 JSON 转义，不再产生畸形标签", async () => {
    const desc = "end with `return <value>` and `return <json-value>`";
    const toolDef = makeToolDef(
      z.object({ name: z.string().describe("Workflow name") }),
    );
    toolDef.description = desc; // 复现 workflow_run 的真实描述内容

    const content = await buildContent(toolDef);

    expect(parseTool(content).description).toBe(desc);
    expect(content).not.toContain("<description>");
  });
});
