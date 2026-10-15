/**
 * mapFinishReason —— SubAgentManager 的纯映射函数，此前未导出、无测试。
 *
 * 语义要紧的是「未知原因不误报成功」（对齐 DSH 的 SubagentStopReason）：
 * 缺失/空视为正常完成，但任何非空未知值都必须保守降级为 error。
 */
import { mapFinishReason } from "../../src/modules/sub-agent/sub-agent.manager";

describe("mapFinishReason", () => {
  it.each([
    ["stop", "completed"],
    ["tool-calls", "completed"],
    ["tool_calls", "completed"],
    ["length", "max_tokens"],
    ["max_tokens", "max_tokens"],
    ["content_filter", "refusal"],
    ["refusal", "refusal"],
    ["user_cancel", "aborted"],
    ["aborted", "aborted"],
  ])("已知原因 %s → %s", (input, expected) => {
    expect(mapFinishReason(input)).toBe(expected);
  });

  it("undefined → completed（无显式原因视为正常完成）", () => {
    expect(mapFinishReason(undefined)).toBe("completed");
  });

  it("空字符串 → completed", () => {
    expect(mapFinishReason("")).toBe("completed");
  });

  it.each(["timeout", "error", "rate_limit", "某个未来新增的原因"])(
    "非空未知原因 %s → error（保守降级，不误报成功）",
    (unknown) => {
      expect(mapFinishReason(unknown)).toBe("error");
    },
  );
});
