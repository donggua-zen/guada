import { describe, it, expect } from "vitest";
import {
  hasUnfinishedSteps,
  nextGroupExpandOverride,
  resolveGroupExpanded,
  resolveGroupTitlePhase,
} from "./groupExpansion";
import type { DisplayItem } from "@/utils/messageUtils";
import type { ToolCall } from "@/utils/toolDisplay";
import type { ToolCallResponseEntry } from "@/types/message";

/**
 * 分组展开规则：
 * - 无显式覆盖时，进行中的最后一组展开、其余收起；
 * - 一旦用户点击，覆盖值优先，且不随运行态变化（结束后手动展开的组保持展开）。
 */
describe("resolveGroupExpanded", () => {
  const noOverrides = new Map<string, boolean>();

  it("无覆盖：进行中的组默认展开", () => {
    expect(resolveGroupExpanded(noOverrides, "process-a", true)).toBe(true);
  });

  it("无覆盖：非进行中的组默认收起", () => {
    expect(resolveGroupExpanded(noOverrides, "process-a", false)).toBe(false);
  });

  it("显式收起优先于进行中默认展开", () => {
    expect(resolveGroupExpanded(new Map([["process-a", false]]), "process-a", true)).toBe(false);
  });

  it("显式展开优先于非进行中默认收起", () => {
    expect(resolveGroupExpanded(new Map([["process-a", true]]), "process-a", false)).toBe(true);
  });

  it("覆盖按 group.id 隔离，不影响其它分组", () => {
    const overrides = new Map([["process-a", false]]);
    expect(resolveGroupExpanded(overrides, "process-b", true)).toBe(true);
  });

  it("回合结束后（active 从 true 变 false）：自动展开的组回落收起", () => {
    const overrides = new Map<string, boolean>();
    expect(resolveGroupExpanded(overrides, "process-a", true)).toBe(true);
    expect(resolveGroupExpanded(overrides, "process-a", false)).toBe(false);
  });

  it("回合结束后：用户手动展开过的组保持展开", () => {
    const overrides = new Map<string, boolean>();
    const firstClick = nextGroupExpandOverride(overrides, "process-a", true);
    expect(firstClick).toBe(false); // 点一下先收起
    overrides.set("process-a", firstClick);
    const secondClick = nextGroupExpandOverride(overrides, "process-a", true);
    expect(secondClick).toBe(true); // 再点展开，形成显式覆盖
    overrides.set("process-a", secondClick);
    expect(resolveGroupExpanded(overrides, "process-a", false)).toBe(true);
  });
});

describe("nextGroupExpandOverride", () => {
  const noOverrides = new Map<string, boolean>();

  it("进行中的组点击后收起", () => {
    expect(nextGroupExpandOverride(noOverrides, "process-a", true)).toBe(false);
  });

  it("非进行中的组点击后展开", () => {
    expect(nextGroupExpandOverride(noOverrides, "process-a", false)).toBe(true);
  });

  it("已有覆盖时基于覆盖取反（而非运行态）", () => {
    const overrides = new Map([["process-a", false]]);
    expect(nextGroupExpandOverride(overrides, "process-a", true)).toBe(true);
  });
});

/**
 * 分组忙碌判定（标题「正在…」的依据）：
 * 忙碌 = 流式中 && 组内存在未完成步骤（思考中 / 工具无 outcome 且匹配不到响应）。
 * 工具全部执行完、等待模型下次响应时不算忙碌——标题应显示「已执行 N 个步骤」。
 */
describe("hasUnfinishedSteps", () => {
  const thinkItem = (opts: { thinking?: boolean } = {}): DisplayItem =>
    ({ id: "t1", type: "think", source: { state: { isThinking: opts.thinking } } }) as DisplayItem;

  const toolItem = (
    tools: Partial<ToolCall>[],
    responses: Partial<ToolCallResponseEntry>[] = [],
  ): DisplayItem =>
    ({
      id: "tl1",
      type: "tool",
      toolCalls: tools as ToolCall[],
      toolResponses: responses as ToolCallResponseEntry[],
      source: {},
    }) as DisplayItem;

  it("非流式：一律不忙碌（含无 outcome 的工具）", () => {
    const items = [toolItem([{ id: "c1", name: "read" }])];
    expect(hasUnfinishedSteps(items, false)).toBe(false);
  });

  it("isStreaming 未定义：与历史回放同口径，不忙碌", () => {
    const items = [toolItem([{ id: "c1", name: "read" }])];
    expect(hasUnfinishedSteps(items)).toBe(false);
  });

  it("流式中：无 outcome 且无响应的工具算执行中", () => {
    const items = [toolItem([{ id: "c1", name: "read" }])];
    expect(hasUnfinishedSteps(items, true)).toBe(true);
  });

  it("流式中：有 outcome 终态的工具不算执行中", () => {
    const items = [toolItem([{ id: "c1", name: "read", outcome: "success" }])];
    expect(hasUnfinishedSteps(items, true)).toBe(false);
  });

  it("流式中：按 toolCallId 匹配到响应（缺 outcome）不算执行中", () => {
    const items = [
      toolItem([{ id: "c1", name: "read" }], [{ toolCallId: "c1", name: "read", content: "ok" }]),
    ];
    expect(hasUnfinishedSteps(items, true)).toBe(false);
  });

  it("流式中：混合组部分完成仍算忙碌", () => {
    const items = [
      toolItem(
        [
          { id: "c1", name: "read", outcome: "success" },
          { id: "c2", name: "glob" },
        ],
        [{ toolCallId: "c1", name: "read", content: "ok" }],
      ),
    ];
    expect(hasUnfinishedSteps(items, true)).toBe(true);
  });

  it("流式中：思考中的块算忙碌，结束后不算", () => {
    expect(hasUnfinishedSteps([thinkItem({ thinking: true })], true)).toBe(true);
    expect(hasUnfinishedSteps([thinkItem({})], true)).toBe(false);
  });

  it("流式中：工具完成但块仍在思考 → 忙碌", () => {
    const items = [
      toolItem([{ id: "c1", name: "read", outcome: "success" }], [{ toolCallId: "c1", name: "read", content: "ok" }]),
      thinkItem({ thinking: true }),
    ];
    expect(hasUnfinishedSteps(items, true)).toBe(true);
  });

  it("无 outcome 但无 id 的工具按数组下标回退匹配响应", () => {
    const items = [
      toolItem([{ name: "read" }], [{ toolCallId: "other", name: "x", content: "unmatched" }]),
    ];
    // 下标 0 回退命中 responses[0]（与 findToolResponse 口径一致）→ 不算执行中
    expect(hasUnfinishedSteps(items, true)).toBe(false);
  });
});

/**
 * 标题阶段优先级（回归）：组内有工具且全部完成时，即使组里还有思考项，
 * 也必须走 completed-tools（聚合完成文案），不能被思考摘要截胡。
 */
describe("resolveGroupTitlePhase", () => {
  const thinkItem = (opts: { thinking?: boolean } = {}): DisplayItem =>
    ({ id: "t1", type: "think", source: { state: { isThinking: opts.thinking } } }) as DisplayItem;

  const toolItem = (
    tools: Partial<ToolCall>[],
    responses: Partial<ToolCallResponseEntry>[] = [],
  ): DisplayItem =>
    ({
      id: "tl1",
      type: "tool",
      toolCalls: tools as ToolCall[],
      toolResponses: responses as ToolCallResponseEntry[],
      source: {},
    }) as DisplayItem;

  it("纯思考组（无工具）→ thinking", () => {
    expect(resolveGroupTitlePhase([thinkItem({})], true)).toBe("thinking");
    expect(resolveGroupTitlePhase([thinkItem({ thinking: true })], true)).toBe("thinking");
  });

  it("工具执行中 → executing-tools", () => {
    expect(resolveGroupTitlePhase([toolItem([{ id: "c1", name: "read" }])], true)).toBe("executing-tools");
  });

  it("工具全部完成、非流式 → completed-tools（不因组内有思考项而显示思考）", () => {
    const items = [
      toolItem([{ id: "c1", name: "web_search", outcome: "success" }], [
        { toolCallId: "c1", name: "web_search", content: "ok" },
      ]),
      thinkItem({}),
    ];
    expect(resolveGroupTitlePhase(items, false)).toBe("completed-tools");
    expect(resolveGroupTitlePhase(items)).toBe("completed-tools");
  });

  it("工具全部完成、等待下次响应（流式中但无未完成步骤）→ completed-tools", () => {
    const items = [toolItem([{ id: "c1", name: "web_search", outcome: "success" }], [
      { toolCallId: "c1", name: "web_search", content: "ok" },
    ])];
    expect(resolveGroupTitlePhase(items, true)).toBe("completed-tools");
  });

  it("工具全部完成但新一轮思考已在流式 → thinking（标题跟随当前思考）", () => {
    const items = [
      toolItem([{ id: "c1", name: "web_search", outcome: "success" }], [
        { toolCallId: "c1", name: "web_search", content: "ok" },
      ]),
      thinkItem({ thinking: true }),
    ];
    expect(resolveGroupTitlePhase(items, true)).toBe("thinking");
  });

  it("工具执行中且思考也在流式 → 工具优先 executing-tools", () => {
    const items = [toolItem([{ id: "c1", name: "read" }]), thinkItem({ thinking: true })];
    expect(resolveGroupTitlePhase(items, true)).toBe("executing-tools");
  });
});
