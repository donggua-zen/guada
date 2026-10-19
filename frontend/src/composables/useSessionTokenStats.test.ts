import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
// 切断 ApiService → locales → localStorage 导入链（node 环境无 localStorage）
vi.mock("@/services/ApiService", () => ({ apiService: {} }));
import {
  useSessionTokenStats,
  applyContextStatsFromEvents,
  updateTokenStatsFromSSE,
  clearTokenStats,
} from "./useSessionTokenStats";

/**
 * 上下文占用锚点逆向扫描测试
 *
 * 覆盖：
 * - applyContextStatsFromEvents：事件日志逆序取最后一个锚点（领域 turn/finish、live
 *   chunk、compaction/end 混合形状），按会话填充环形指示器切片
 * - 锚点携带 messageCount/breakdown 时一并写入（新事件）；缺省时保留旧值（旧事件兼容）
 * - 无锚点 / 非法窗口 → 返回 false（调用方显示空状态）
 * - 会话隔离：后台会话的锚点不污染其他会话切片（主会话 × 子代理同屏并存）
 */
describe("applyContextStatsFromEvents（上下文占用锚点逆向扫描）", () => {
  let tokenStats: ReturnType<typeof useSessionTokenStats>["tokenStats"];

  beforeEach(() => {
    setActivePinia(createPinia());
    clearTokenStats();
    tokenStats = useSessionTokenStats(ref("s1")).tokenStats;
  });

  it("取最后一个有效锚点（领域 turn/finish、live turn_end、compaction/end 混合，逆序）", () => {
    const events = [
      { type: "turn/finish", data: { usedTokens: 100, effectiveContextWindow: 1000 } },
      { type: "turn_end", contextStats: { usedTokens: 300, effectiveContextWindow: 1000 } },
      { type: "compaction/end", data: { usedTokens: 150, effectiveContextWindow: 1000 } },
      { type: "user/message", data: { messageId: "u1" } },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(150);
    expect(tokenStats.value?.totalTokens).toBe(1000);
    expect(tokenStats.value?.percentage).toBe(15);
  });

  it("live 形状（compression_end / compaction_summary 携带 contextStats）同样生效", () => {
    const events = [
      { type: "turn/finish", data: { usedTokens: 800, effectiveContextWindow: 1000 } },
      { type: "compression_end", contextStats: { usedTokens: 500, effectiveContextWindow: 1000 } },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(500);
  });

  it("锚点未携带 breakdown/messageCount 时保留已有值（旧事件兼容）", () => {
    updateTokenStatsFromSSE("s1", {
      usedTokens: 0,
      effectiveContextWindow: 1000,
      messageCount: 9,
      breakdown: { systemPrompt: 10, history: 40, tools: 50 },
    });
    const events = [
      { type: "turn/finish", data: { usedTokens: 250, effectiveContextWindow: 1000 } },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.breakdown).toEqual({
      systemPrompt: 10, history: 40, tools: 50,
    });
    expect(tokenStats.value?.messageCount).toBe(9);
  });

  it("锚点携带 breakdown/messageCount（live 或领域形状）时一并写入", () => {
    const events = [
      { type: "turn/finish", data: { usedTokens: 100, effectiveContextWindow: 1000 } },
      {
        type: "turn_end",
        contextStats: {
          usedTokens: 400,
          effectiveContextWindow: 1000,
          messageCount: 12,
          breakdown: { systemPrompt: 50, history: 300, tools: 50 },
        },
      },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(400);
    expect(tokenStats.value?.messageCount).toBe(12);
    expect(tokenStats.value?.breakdown).toEqual({
      systemPrompt: 50, history: 300, tools: 50,
    });
  });

  it("形状非法的 breakdown 被忽略（防御旧数据/脏数据）", () => {
    const events = [
      {
        type: "compaction/end",
        data: {
          usedTokens: 200,
          effectiveContextWindow: 1000,
          messageCount: 3,
          breakdown: { systemPrompt: "x", history: 1 },
        },
      },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.breakdown).toBeUndefined();
    expect(tokenStats.value?.messageCount).toBe(3);
  });

  it("context/stats（小轮次持久化锚点）可恢复中断回合的占用", () => {
    // 模拟流式中意外退出：没有正常 turn/finish 的占用字段，
    // 但最后一个小轮次已写入 context/stats。
    const events = [
      { type: "turn/start", seq: 1, data: { turnId: "t1" } },
      {
        type: "assistant/message",
        seq: 2,
        data: { messageId: "a1", metadata: { usage: { promptTokens: 500 } } },
      },
      {
        type: "context/stats",
        seq: 3,
        data: {
          turnId: "t1",
          usedTokens: 512,
          effectiveContextWindow: 2000,
          messageCount: 6,
          breakdown: { systemPrompt: 100, history: 400, tools: 12 },
        },
      },
      // 冷加载收口合成的中断回合收尾：没有 usedTokens/effectiveContextWindow
      { type: "turn/finish", seq: 4, data: { turnId: "t1", finishReason: "interrupted" } },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(512);
    expect(tokenStats.value?.totalTokens).toBe(2000);
    expect(tokenStats.value?.percentage).toBe(25.6);
    expect(tokenStats.value?.messageCount).toBe(6);
    expect(tokenStats.value?.breakdown).toEqual({
      systemPrompt: 100, history: 400, tools: 12,
    });
  });

  it("已删除回合的锚点被跳过（领域与 live 两种形状）", () => {
    const events = [
      // 有效锚点（更早）
      {
        type: "context/stats",
        data: { turnId: "t_valid", usedTokens: 200, effectiveContextWindow: 1000 },
      },
      // 该回合已被重答/删除：其后的锚点都不能用于恢复
      { type: "turn/delete", data: { turnId: "t_deleted" } },
      {
        type: "context/stats",
        data: { turnId: "t_deleted", usedTokens: 900, effectiveContextWindow: 1000 },
      },
      {
        type: "context_stats",
        turnId: "t_deleted",
        contextStats: { usedTokens: 950, effectiveContextWindow: 1000 },
      },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(true);
    expect(tokenStats.value?.usedTokens).toBe(200);
  });

  it("无锚点返回 false", () => {
    const events = [
      { type: "user/message", data: { messageId: "u1" } },
      { type: "assistant/message", data: { messageId: "a1" } },
    ];
    expect(applyContextStatsFromEvents("s1", events as any)).toBe(false);
    expect(tokenStats.value).toBeNull();
  });

  it("非数组 / 非法窗口 / 缺字段 → false", () => {
    expect(applyContextStatsFromEvents("s1", null as any)).toBe(false);
    expect(applyContextStatsFromEvents("s1", undefined as any)).toBe(false);
    expect(applyContextStatsFromEvents(null, [])).toBe(false);
    expect(
      applyContextStatsFromEvents("s1", [
        { type: "turn/finish", data: { usedTokens: 5, effectiveContextWindow: 0 } },
      ] as any),
    ).toBe(false);
    expect(
      applyContextStatsFromEvents("s1", [
        { type: "turn/finish", data: { usedTokens: 5 } },
      ] as any),
    ).toBe(false);
  });

  it("会话隔离：SSE 锚点按 sessionId 写入，后台会话不污染前台切片", () => {
    const mainStats = useSessionTokenStats(ref("main")).tokenStats;
    const subStats = useSessionTokenStats(ref("sub")).tokenStats;

    applyContextStatsFromEvents("main", [
      { type: "turn/finish", data: { usedTokens: 100, effectiveContextWindow: 1000 } },
    ]);
    // 后台子代理回合结束（真实互染路径：projector 对所有会话喂 updateTokenStatsFromSSE）
    updateTokenStatsFromSSE("sub", {
      usedTokens: 900,
      effectiveContextWindow: 2000,
      messageCount: 4,
    });

    expect(mainStats.value?.usedTokens).toBe(100);
    expect(mainStats.value?.totalTokens).toBe(1000);
    expect(subStats.value?.usedTokens).toBe(900);
    expect(subStats.value?.percentage).toBe(45);
  });
});
