import { describe, it, expect } from "vitest";
import { getThinkingPreview, groupContentsForDisplay } from "./messageUtils";
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
 * 测试环境 pluginToolDisplays 为空 → 判定走 BUILTIN_RENDERERS 兜底（ExitPlanMode → plan）。
 */
describe("groupContentsForDisplay：独立渲染工具分组", () => {
  it("ExitPlanMode 单独成组且不可折叠（不并入过程组）", () => {
    const groups = groupContentsForDisplay([
      { id: "th1", content: null, reasoningContent: "调研", state: { isStreaming: false } },
      toolBlock("t1", ["ExitPlanMode"]),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ type: "process", isCollapsible: true });
    expect(groups[1]).toMatchObject({ type: "process", isCollapsible: false });
    expect(groups[1].id).toBe("standalone-t1-tool");
    expect(groups[1].items[0].type).toBe("tool");
  });

  it("计划卡切断过程分组：前后普通工具各自聚成可折叠组，顺序保持", () => {
    const groups = groupContentsForDisplay([
      toolBlock("t1", ["read"]),
      toolBlock("t2", ["ExitPlanMode"]),
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
      toolBlock("t1", ["read", "ExitPlanMode"]),
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
      toolBlock("t1", ["ExitPlanMode"]),
    ]);

    expect(groups.map((g) => g.type)).toEqual(["content", "process"]);
    expect(groups[1].isCollapsible).toBe(false);
  });
});
