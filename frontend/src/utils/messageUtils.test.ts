import { describe, it, expect } from "vitest";
import { getThinkingPreview, groupContentsForDisplay, stripSystemReminder, hasVisibleText } from "./messageUtils";
import type { MessageContent } from "@/types/message";

/**
 * 思考内容预览测试（步骤行/分组标题摘要文字）
 *
 * 语义：按 \n 拆行取最后一行（从行首显示、超长结尾截断）——
 * 不是取尾部若干字符；思考中实时跟随最新一行，结束后保留。
 */
describe("getThinkingPreview", () => {
  it("多行内容取最后一个非空行", () => {
    expect(getThinkingPreview("第一行\n第二行\n\n第三行结论")).toBe("第三行结论");
  });

  it("从行首取前 200 字符并追加省略号（结尾截断，而非尾部字符）", () => {
    const longLine = "a".repeat(300);
    const preview = getThinkingPreview(`开头\n${longLine}`);
    expect(preview).toBe("a".repeat(200) + "...");
    expect(preview.startsWith("a")).toBe(true);
    expect(preview).toHaveLength(203);
  });

  it("空/空白内容返回空串", () => {
    expect(getThinkingPreview("")).toBe("");
    expect(getThinkingPreview("\n \n")).toBe("");
    expect(getThinkingPreview(null)).toBe("");
    expect(getThinkingPreview(undefined)).toBe("");
  });

  it("行首尾空白被 trim", () => {
    expect(getThinkingPreview("  带空白的行  ")).toBe("带空白的行");
  });

  it("单行内容原样返回", () => {
    expect(getThinkingPreview("只有一行")).toBe("只有一行");
  });
});

/** 工具块 fixture：一条 assistant 块携带工具调用（metadata.toolCalls 即 DisplayItem.toolCalls 同构数据） */
function toolBlock(id: string, names: string[]): MessageContent {
  return {
    id,
    content: null,
    state: { isStreaming: false },
    metadata: {
      toolCalls: names.map((name, index) => ({
        id: `${id}-tc${index}`,
        index,
        name,
        arguments: JSON.stringify({ plan: `# ${name}` }),
      })),
    },
  };
}

/**
 * 分组规则：content 与「独立渲染工具」（isStandaloneTool，如计划卡）是两类分隔符。
 * 独立工具单独成组且不可折叠——折进"已执行 N 个步骤"标题后计划正文默认不可见。
 * 测试环境 pluginToolDisplays 为空 → 计划卡判定走 BUILTIN_RENDERERS 兜底（submit_plan/ExitPlanMode → plan），
 * 子代理派生行走按工具名的独立集合（subagent_spawn）。
 */
describe("groupContentsForDisplay：独立渲染工具分组", () => {
  it("submit_plan 单独成组且不可折叠（不并入过程组）", () => {
    const groups = groupContentsForDisplay([
      { id: "th1", content: null, reasoningContent: "调研", state: { isStreaming: false } },
      toolBlock("t1", ["submit_plan"]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ type: "process", isCollapsible: true });
    expect(groups[1]).toMatchObject({ type: "process", isCollapsible: false });
    expect(groups[1].id).toBe("standalone-t1-tool");
    expect(groups[1].items[0].type).toBe("tool");
  });

  it("ExitPlanMode（旧转录名）同样单独成组（兜底双名兼容）", () => {
    const groups = groupContentsForDisplay([
      { id: "th1", content: null, reasoningContent: "调研", state: { isStreaming: false } },
      toolBlock("t1", ["ExitPlanMode"]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ type: "process", isCollapsible: false });
    expect(groups[1].id).toBe("standalone-t1-tool");
  });

  it("计划卡切断过程分组：前后普通工具各自聚成可折叠组，顺序保持", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read"]),
      toolBlock("t2", ["submit_plan"]),
      toolBlock("t3", ["glob"]),
    ]);

    expect(groups.map((g) => [g.isCollapsible, g.items.length])).toEqual([
      [true, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(groups[0].items[0].toolCalls?.[0].name).toBe("read");
    expect(groups[2].items[0].toolCalls?.[0].name).toBe("glob");
  });

  it("同块并行调用含计划工具：整项独立、不拆行", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read", "submit_plan"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isCollapsible).toBe(false);
    expect(groups[0].items[0].toolCalls).toHaveLength(2);
  });

  it("子代理派生行独立成组且不可折叠（与计划卡同通路、按工具名判定）", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read"]),
      toolBlock("t2", ["subagent_spawn"]),
      toolBlock("t3", ["glob"]),
    ]);

    expect(groups.map((g) => [g.isCollapsible, g.items.length])).toEqual([
      [true, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(groups[1].items[0].toolCalls?.[0].name).toBe("subagent_spawn");
  });

  it("子代理派生与普通工具同块并行：整项独立、不拆行", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read", "subagent_spawn"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isCollapsible).toBe(false);
    expect(groups[0].items[0].toolCalls).toHaveLength(2);
  });

  it("subagent_manager 不独立：仍并入可折叠过程组", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["subagent_manager"]),
      toolBlock("t2", ["read"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "process", isCollapsible: true });
    expect(groups[0].items).toHaveLength(2);
  });

  it("TODO 独立成组且不可折叠（不并入过程组）", () => {
    const groups = groupContentsForDisplay([
      { id: "th1", content: null, reasoningContent: "规划", state: { isStreaming: false } },
      toolBlock("t1", ["todo"]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ type: "process", isCollapsible: true });
    expect(groups[1]).toMatchObject({ type: "process", isCollapsible: false });
    expect(groups[1].id).toBe("standalone-t1-tool");
    expect(groups[1].items[0].toolCalls?.[0].name).toBe("todo");
  });

  it("TODO 切断过程分组：前后普通工具各自聚成可折叠组，顺序保持", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read"]),
      toolBlock("t2", ["todo"]),
      toolBlock("t3", ["glob"]),
    ]);

    expect(groups.map((g) => [g.isCollapsible, g.items.length])).toEqual([
      [true, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(groups[0].items[0].toolCalls?.[0].name).toBe("read");
    expect(groups[2].items[0].toolCalls?.[0].name).toBe("glob");
  });

  it("TODO 与普通工具同块并行：整项独立、不拆行", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read", "todo"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isCollapsible).toBe(false);
    expect(groups[0].items[0].toolCalls).toHaveLength(2);
  });

  it("普通工具（无独立渲染）仍聚成一个可折叠过程组（回归）", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read"]),
      toolBlock("t2", ["glob"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "process", isCollapsible: true });
    expect(groups[0].items).toHaveLength(2);
  });

  it("content 与独立工具并存：两类分隔符各自生效", () => {
    const groups = groupContentsForDisplay([
      { id: "c1", content: "正文", state: { isStreaming: false } },
      toolBlock("t1", ["submit_plan"]),
    ]);

    expect(groups.map((g) => g.type)).toEqual(["content", "process"]);
    expect(groups[1].isCollapsible).toBe(false);
  });
});

/**
 * <system_reminder> 剥离测试（P5c：多段落支持）
 *
 * 合并批次一条消息可含多段 reminder（如多个 job 同回合完成），
 * 全部剥出按序拼接；无标记原样返回（outline 等消费方依赖此行为）。
 */
describe("stripSystemReminder", () => {
  it("单段 reminder 剥出内部文本", () => {
    expect(
      stripSystemReminder(
        "<system_reminder>\nBackground job job-a finished.\n</system_reminder>",
      ),
    ).toBe("Background job job-a finished.");
  });

  it("多段 reminder 按序拼接（合并批次）", () => {
    const text =
      "<system_reminder>\njob-a finished\n</system_reminder>\n<system_reminder>\njob-b failed\n</system_reminder>";
    expect(stripSystemReminder(text)).toBe("job-a finished\n\njob-b failed");
  });

  it("多段中空段被丢弃", () => {
    const text =
      "<system_reminder>first</system_reminder><system_reminder>   </system_reminder><system_reminder>second</system_reminder>";
    expect(stripSystemReminder(text)).toBe("first\n\nsecond");
  });

  it("无标记原样返回", () => {
    expect(stripSystemReminder("plain text")).toBe("plain text");
    expect(stripSystemReminder("")).toBe("");
  });
});

/**
 * 纯空白文本块不参与展示（GPT6 每轮在正文前注入一个只含空格的 message item）。
 *
 * 后端按原文保留该块（对齐 ZCode：存储不删内容），展示层负责不把它渲染成正文、
 * 不算作"有内容"（大纲摘要 / 首轮标题生成判定），也不能成为复制/编辑锚点。
 */
describe("纯空白文本块", () => {
  it("hasVisibleText：空白/换行/空串都不算可见内容", () => {
    expect(hasVisibleText(" ")).toBe(false);
    expect(hasVisibleText("\n\n")).toBe(false);
    expect(hasVisibleText("\t ")).toBe(false);
    expect(hasVisibleText("")).toBe(false);
    expect(hasVisibleText(null)).toBe(false);
    expect(hasVisibleText(undefined)).toBe(false);
    expect(hasVisibleText("正文")).toBe(true);
    expect(hasVisibleText(" 正文 ")).toBe(true);
  });

  it("单个纯空白块不产生任何展示分组", () => {
    const groups = groupContentsForDisplay([
      { id: "ws", content: " ", state: { isStreaming: false } },
    ]);
    expect(groups).toHaveLength(0);
  });

  it("空白块 + 思考 + 正文：只输出思考组与正文组，空白不占正文位", () => {
    const groups = groupContentsForDisplay([
      { id: "ws", content: " ", state: { isStreaming: false } },
      { id: "th", content: null, reasoningContent: "思考", state: { isStreaming: false } },
      { id: "body", content: "正文", state: { isStreaming: false } },
    ]);

    expect(groups.map((g) => g.type)).toEqual(["process", "content"]);
    expect(groups[1].items[0].content).toBe("正文");
  });
});

/**
 * 纯空白思考块不渲染。
 *
 * 与正文前的占位 item 同源：上游没有思考内容时会发占位空格，落库后是只有空白的
 * reasoning 块。渲染它只会在过程组里留下「已思考」空行（一次回复里可能连着好几个）。
 * 存储原文不动，只在展示投影层过滤。
 */
describe("纯空白思考块", () => {
  const thinkBlock = (id: string, reasoningContent: any, extra: any = {}): MessageContent =>
    ({
      id,
      content: null,
      reasoningContent,
      state: { isStreaming: false, isThinking: false },
      ...extra,
    }) as MessageContent;

  it("单个纯空白思考不产生展示分组", () => {
    expect(groupContentsForDisplay([thinkBlock("a", " ")])).toHaveLength(0);
    expect(groupContentsForDisplay([thinkBlock("b", "\n\n")])).toHaveLength(0);
    expect(groupContentsForDisplay([thinkBlock("c", "")])).toHaveLength(0);
  });

  it("多个空思考 + 一个有效思考：只保留有效那一条", () => {
    const groups = groupContentsForDisplay([
      thinkBlock("c", " "),
      thinkBlock("d", " "),
      thinkBlock("e", " "),
      thinkBlock("f", "真实思考"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].reasoningContent).toBe("真实思考");
  });

  it("流式中的空思考也不渲染（底部 ThinkingStatus 承担指示）", () => {
    const groups = groupContentsForDisplay([
      thinkBlock("g", " ", { state: { isStreaming: true, isThinking: true } }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("有效思考照常渲染", () => {
    const groups = groupContentsForDisplay([thinkBlock("h", "思考内容")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].type).toBe("think");
  });
});
