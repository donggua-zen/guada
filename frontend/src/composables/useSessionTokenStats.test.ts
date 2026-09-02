import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
// 切断 ApiService → locales → localStorage 导入链（node 环境无 localStorage）
vi.mock("@/services/ApiService", () => ({ apiService: {} }));
import {
  useSessionTokenStats,
  applyContextStatsFromEvents,
} from "./useSessionTokenStats";

/**
 * 上下文占用锚点逆向扫描测试
 *
 * 覆盖：
 * - applyContextStatsFromEvents：事件日志逆序取最后一个锚点（领域 turn/finish、live
 *   chunk、compaction/end 混合形状），填充环形指示器
 * - 无锚点 / 非法窗口 → 返回 false（调用方 fallback REST）
 */
describe("applyContextStatsFromEvents（上下文占用锚点逆向扫描）", () => {
  let tokenStats: ReturnType<typeof useSessionTokenStats>["tokenStats"];

  beforeEach(() => {
    setActivePinia(createPinia());
    tokenStats = useSessionTokenStats(ref("s1")).tokenStats;
    tokenStats.value = null;
  });

  it("取最后一个有效锚点（领域 turn/finish、live turn_end、compaction/end 混合，逆序）", () => {
    const events = [
      { type: "turn/finish", data: { usedTokens: 100, effectiveContextWindow: 1000 } },
      { type: "turn_end", contextStats: { usedTokens: 300, effectiveContextWindow: 1000 } },
      { type: "compaction/end", data: { usedTokens: 150, effectiveContextWindow: 1000 } },
      { type: "user/message", data: { messageId: "u1" } },
    ];
    expect(applyContextStatsFromEvents(events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(150);
    expect(tokenStats.value?.totalTokens).toBe(1000);
    expect(tokenStats.value?.percentage).toBe(15);
  });

  it("live 形状（compression_end / compaction_summary 携带 contextStats）同样生效", () => {
    const events = [
      { type: "turn/finish", data: { usedTokens: 800, effectiveContextWindow: 1000 } },
      { type: "compression_end", contextStats: { usedTokens: 500, effectiveContextWindow: 1000 } },
    ];
    expect(applyContextStatsFromEvents(events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(500);
  });

  it("保留已有 breakdown（扫描锚点只更新轻量字段）", () => {
    tokenStats.value = {
      usedTokens: 0,
      totalTokens: 1000,
      remainingTokens: 1000,
      percentage: 0,
      modelName: "m",
      messageCount: 9,
      breakdown: { systemPrompt: 10, summary: 20, userPrompt: 30, history: 40, tools: 50 },
    };
    const events = [
      { type: "turn/finish", data: { usedTokens: 250, effectiveContextWindow: 1000 } },
    ];
    expect(applyContextStatsFromEvents(events as any)).toBe(true);
    expect(tokenStats.value?.breakdown).toEqual({
      systemPrompt: 10, summary: 20, userPrompt: 30, history: 40, tools: 50,
    });
    expect(tokenStats.value?.messageCount).toBe(9);
  });

  it("无锚点返回 false", () => {
    const events = [
      { type: "user/message", data: { messageId: "u1" } },
      { type: "assistant/message", data: { messageId: "a1" } },
    ];
    expect(applyContextStatsFromEvents(events as any)).toBe(false);
    expect(tokenStats.value).toBeNull();
  });

  it("非数组 / 非法窗口 / 缺字段 → false", () => {
    expect(applyContextStatsFromEvents(null as any)).toBe(false);
    expect(applyContextStatsFromEvents(undefined as any)).toBe(false);
    expect(
      applyContextStatsFromEvents([
        { type: "turn/finish", data: { usedTokens: 5, effectiveContextWindow: 0 } },
      ] as any),
    ).toBe(false);
    expect(
      applyContextStatsFromEvents([
        { type: "turn/finish", data: { usedTokens: 5 } },
      ] as any),
    ).toBe(false);
  });
});
