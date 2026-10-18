import { describe, it, expect } from "vitest";
import { resolveOutgoingSessionId } from "./usePreviewTabCache";

/**
 * 会话切换的「迁出会话」判定契约：
 * - 本组件实例同步过旧会话 → 旧会话
 * - 组件卸载后重挂载（prev 丢失）→ 依据 tabStore 的归属会话判断
 * - 同会话重挂载 / 首次挂载 → null（保留既有标签）
 */
describe("resolveOutgoingSessionId", () => {
  it("本实例同步过旧会话：返回旧会话", () => {
    expect(resolveOutgoingSessionId("A", "A", "B")).toBe("A");
    expect(resolveOutgoingSessionId("A", "B", "B")).toBe("A");
  });

  it("重挂载且 tabStore 仍归属另一个会话：识别为真实切换", () => {
    expect(resolveOutgoingSessionId(null, "A", "B")).toBe("A");
  });

  it("重挂载但 tabStore 已归属目标会话：不切换（工作区隐藏再打开）", () => {
    expect(resolveOutgoingSessionId(null, "B", "B")).toBeNull();
  });

  it("首次挂载且无归属会话：不切换，保留调用方刚打开的标签", () => {
    expect(resolveOutgoingSessionId(null, null, "B")).toBeNull();
  });

  it("新旧会话相同：不切换", () => {
    expect(resolveOutgoingSessionId("A", "A", "A")).toBeNull();
  });
});
