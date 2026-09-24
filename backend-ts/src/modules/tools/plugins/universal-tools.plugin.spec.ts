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
