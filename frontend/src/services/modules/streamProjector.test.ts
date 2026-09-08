/**
 * StreamProjector 折叠器测试
 *
 * 覆盖（前端自折叠核心，三层结构 turn → messages(MessageBundle) → blocks）：
 * - foldEvents 事件页折叠 → turn 树（turn_start/user_message/assistant 消息束/turn_end）
 * - 消息级字段（role/kind/source/metadata/usage/finishReason）只挂 MessageBundle，不逐块复制
 * - compaction_summary：in-turn → 回合内 event 消息束；out-of-turn → 独立 event 回合；遮蔽消息束被标记
 * - turn_delete：移除回合
 * - 收敛：replay 完整块（block_end 覆盖）与 live delta（text_delta 累加）折叠到同一棵树
 * - 多块消息在 bundle.blocks 内按 (messageId, index) 寻址；user 多块（文本+文件）同一 bundle；
 *   tool_calls_response 按 toolCallId 挂载到块
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
vi.mock("@/services/ApiService", () => ({ apiService: {} }));
import { foldEvents, applyLiveChunk } from "./streamProjector";
import { useSessionTokenStats } from "@/composables/useSessionTokenStats";
import type { WireStreamEvent } from "@/types/stream";

function createStore() {
  const state: any = { loaded: true, turns: [], eventLog: [] };
  return {
    state,
    getSessionState: () => state,
    getTurns: () => state.turns,
    setTurns: (_sid: string, t: any[]) => { state.turns = t; },
    deleteTurnById: (_sid: string, id: string) => { state.turns = state.turns.filter((t: any) => t.id !== id); },
    setSessionIsCompressing: () => {},
    sessionIsCompressing: () => false,
    setSessionPendingAsk: (_sid: string, v: any) => { state.pendingAsk = v; },
    sessionPendingAsk: () => state.pendingAsk,
  };
}

function blocksOf(turn: any): any[] {
  return (turn?.messages ?? []).flatMap((m: any) => m.blocks ?? []);
}
function bundleOf(turn: any, messageId: string): any {
  return (turn?.messages ?? []).find((m: any) => m.messageId === messageId);
}

function textChunks(mid: string, tid: string, text: string): WireStreamEvent[] {
  return [
    { type: "block_start", messageId: mid, turnId: tid, index: 0, blockType: "text" } as any,
    { type: "block_end", messageId: mid, turnId: tid, index: 0, block: { type: "text", contentId: "c1", text } } as any,
    { type: "usage", messageId: mid, turnId: tid, usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } } as any,
    { type: "finish", messageId: mid, turnId: tid, finishReason: "stop" } as any,
  ];
}
function turnPage(tid: string, userText: string, answer: string): WireStreamEvent[] {
  return [
    { type: "turn_start", turnId: tid, modelName: "m1" } as any,
    { type: "user_message", messageId: `${tid}_u`, turnId: tid, userMessage: { id: `${tid}_u`, role: "user", kind: "user", metadata: {}, content: [{ type: "text", contentId: `${tid}_uc`, text: userText }] } } as any,
    ...textChunks(`${tid}_a`, tid, answer),
    { type: "turn_end", turnId: tid, finishReason: "stop", usage: { promptTokens: 5 } } as any,
  ];
}

describe("StreamProjector 折叠器", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => { store = createStore(); });

  it("foldEvents 事件页 → turn 树（user/assistant 各为消息束，消息级字段挂 bundle）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    const turn = store.state.turns[0];
    expect(turn.id).toBe("T1");
    expect(turn.metadata.modelName).toBe("m1");
    const userB = bundleOf(turn, "T1_u");
    expect(userB.role).toBe("user");
    expect(userB.blocks[0].content).toBe("你好");
    const asstB = bundleOf(turn, "T1_a");
    expect(asstB.role).toBe("assistant");
    expect(asstB.blocks[0].content).toBe("回答");
    expect(asstB.metadata.usage?.promptTokens).toBe(5);
    expect(asstB.metadata.finishReason).toBe("stop");
    expect(asstB.blocks[0].state.isStreaming).toBe(false);
    expect(turn.metadata.finishReason).toBe("stop");
  });

  it("多块 assistant 消息在 bundle.blocks 内按 (messageId, index) 寻址", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "reasoning" } as any,
      { type: "reasoning_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "思考" } as any,
      { type: "block_end", messageId: "T1_a", turnId: "T1", index: 0, block: { type: "reasoning", contentId: "r1", summary: "思考", timing: { startedAt: 1000, finishedAt: 2000 } } } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 1, blockType: "text" } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 1, text: "回答" } as any,
      { type: "block_end", messageId: "T1_a", turnId: "T1", index: 1, block: { type: "text", contentId: "c1", text: "回答" } } as any,
      { type: "usage", messageId: "T1_a", turnId: "T1", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } } as any,
      { type: "finish", messageId: "T1_a", turnId: "T1", finishReason: "stop" } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const bundle = bundleOf(store.state.turns[0], "T1_a");
    const blocks = bundle.blocks;
    expect(blocks).toHaveLength(2);
    const r = blocks.find((b: any) => b.blockIndex === 0);
    const t = blocks.find((b: any) => b.blockIndex === 1);
    expect(r.reasoningContent).toBe("思考");
    expect(r.thinkingDurationMs).toBe(1000);
    expect(t.content).toBe("回答");
    expect(bundle.metadata.usage?.promptTokens).toBe(5);
    expect(t.metadata.usage).toBeUndefined();
  });

  it("user 多块（文本+图片）同一消息束", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "user_message", messageId: "T1_u", turnId: "T1", userMessage: { id: "T1_u", role: "user", kind: "user", metadata: {}, content: [
        { type: "text", contentId: "uc1", text: "看图" },
        { type: "image", contentId: "uc2", attachment: { attachmentId: "att1", mediaType: "image/png", name: "a.png", url: "/files/1" } },
      ] } } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const userBundles = store.state.turns[0].messages.filter((m: any) => m.role === "user");
    expect(userBundles).toHaveLength(1);
    expect(userBundles[0].blocks).toHaveLength(2);
    expect(userBundles[0].blocks[0].content).toBe("看图");
    expect(userBundles[0].blocks[1].files?.[0]?.name).toBe("a.png");
  });

  it("tool_calls_response 按 toolCallId 挂到对应 tool-call 块", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "tool-call" } as any,
      { type: "tool_call_delta", messageId: "T1_a", turnId: "T1", index: 0, toolCallId: "tc1", name: "web_search", argumentsDelta: "{}" } as any,
      { type: "block_end", messageId: "T1_a", turnId: "T1", index: 0, block: { type: "tool-call", contentId: "tc_c1", toolCallId: "tc1", name: "web_search", arguments: "{}" } } as any,
      { type: "tool_calls_response", turnId: "T1", toolCallsResponse: [{ messageId: "m_t1", name: "web_search", content: "结果", toolCallId: "tc1", outcome: "success" }] } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const block = blocksOf(store.state.turns[0]).find((b: any) => b.role === "assistant");
    expect(block.metadata.toolCalls[0].name).toBe("web_search");
    expect(block.metadata.toolCalls[0].outcome).toBe("success");
    expect(block.metadata.toolCallsResponse[0].content).toBe("结果");
  });

  it("compaction_summary in-turn：标记遮蔽 + 回合内 event 消息束", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      { type: "user_message", messageId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "T1", userMessage: { id: "m_01ARZ3NDEKTSV4RRFFQ69G5FAV", role: "user", kind: "user", metadata: {}, content: [{ type: "text", contentId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAVc", text: "旧" }] } } as any,
      { type: "compaction_summary", shadowedEndId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAV", shadowedCount: 1, summary: "已优化对话历史", messageId: "c_01ARZ3NDEKTSV4RRFFQ69G5FAX" } as any,
      { type: "turn_end", turnId: "T1", finishReason: "stop" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const turn = store.state.turns.find((t: any) => t.id === "T1");
    expect(bundleOf(turn, "m_01ARZ3NDEKTSV4RRFFQ69G5FAV").metadata.compacted).toBe(true);
    const evt = turn.messages.find((m: any) => m.role === "event");
    expect(evt.metadata.eventType).toBe("compaction");
    expect(evt.metadata.compactInfo.summary).toBe("已优化对话历史");
    expect(store.state.turns.some((t: any) => t.kind === "event")).toBe(false);
  });

  it("compaction_summary out-of-turn：独立 event 回合", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      { type: "user_message", messageId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "T1", userMessage: { id: "m_01ARZ3NDEKTSV4RRFFQ69G5FAV", role: "user", kind: "user", metadata: {}, content: [{ type: "text", contentId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAVc", text: "你好" }] } } as any,
      ...textChunks("m_01ARZ3NDEKTSV4RRFFQ69G5FAW", "T1", "回答"),
      { type: "turn_end", turnId: "T1", finishReason: "stop" } as any,
      { type: "compaction_summary", shadowedEndId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAW", shadowedCount: 2, summary: "已优化对话历史", messageId: "c_01ARZ3NDEKTSV4RRFFQ69G5FAX" } as any,
    ];
    foldEvents(store as any, "s1", events);
    expect(store.state.turns[0].messages.every((m: any) => m.metadata?.compacted === true)).toBe(true);
    const evtTurn = store.state.turns.find((t: any) => t.kind === "event");
    expect(evtTurn.messages[0].role).toBe("event");
    expect(evtTurn.messages[0].metadata.compactInfo.summary).toBe("已优化对话历史");
  });

  it("compression_start：列表末尾生成'压缩中'占位卡且幂等（维护流/无宿主回合）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    const evtTurns = store.state.turns.filter((t: any) => t.kind === "event");
    expect(evtTurns.length).toBe(1);
    expect(evtTurns[0].metadata.eventType).toBe("compaction");
    expect(evtTurns[0].metadata.compressing).toBe(true);
    expect(evtTurns[0].messages[0].metadata.compressing).toBe(true);
  });

  it("compaction_summary 替换'压缩中'占位为结果卡（仅一张压缩卡）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    applyLiveChunk(store as any, "s1", {
      type: "compaction_summary",
      shadowedEndId: "m_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      shadowedCount: 1,
      summary: "已优化对话历史",
      messageId: "c_01ARZ3NDEKTSV4RRFFQ69G5FAX",
    } as any);
    const evtTurns = store.state.turns.filter((t: any) => t.kind === "event");
    expect(evtTurns.length).toBe(1);
    expect(evtTurns[0].metadata.compressing).toBeUndefined();
    expect(evtTurns[0].messages[0].metadata.compactInfo.summary).toBe("已优化对话历史");
  });

  it("compression_error：移除'压缩中'占位", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    applyLiveChunk(store as any, "s1", { type: "compression_error", error: "llm failed" } as any);
    expect(store.state.turns.some((t: any) => t.kind === "event")).toBe(false);
  });

  it("compression_end（纯裁剪无 summary）：移除'压缩中'占位", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    applyLiveChunk(store as any, "s1", {
      type: "compression_end",
      contextStats: { usedTokens: 100, effectiveContextWindow: 1000 },
    } as any);
    expect(store.state.turns.some((t: any) => t.kind === "event")).toBe(false);
  });

  it("compaction_summary 旧格式 shadowedMessageIds", () => {
    foldEvents(store as any, "s1", [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      { type: "user_message", messageId: "T1_u", turnId: "T1", userMessage: { id: "T1_u", role: "user", kind: "user", metadata: {}, content: [{ type: "text", contentId: "T1_uc", text: "旧" }] } } as any,
      { type: "compaction_summary", shadowedMessageIds: ["T1_u"], summary: "旧格式摘要", messageId: "sum_1" } as any,
    ]);
    expect(bundleOf(store.state.turns[0], "T1_u").metadata.compacted).toBe(true);
  });

  it("turn_delete：移除回合", () => {
    foldEvents(store as any, "s1", [...turnPage("T1", "你好", "回答"), { type: "turn_delete", turnId: "T1" } as any]);
    expect(store.state.turns.some((t: any) => t.id === "T1")).toBe(false);
  });

  it("收敛：replay 完整块与 live delta 折叠到同一内容", () => {
    foldEvents(store as any, "s1", [{ type: "turn_start", turnId: "T1" } as any, ...textChunks("T1_a", "T1", "Hello World"), { type: "turn_end", turnId: "T1" } as any]);
    const ls = createStore();
    foldEvents(ls as any, "s1", [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "text" } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "Hello " } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "World" } as any,
      { type: "block_end", messageId: "T1_a", turnId: "T1", index: 0, block: { type: "text", contentId: "c1", text: "Hello World" } } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ]);
    const r = bundleOf(store.state.turns[0], "T1_a").blocks[0].content;
    const l = bundleOf(ls.state.turns[0], "T1_a").blocks[0].content;
    expect(l).toBe("Hello World");
    expect(r).toBe(l);
  });

  it("applyLiveChunk：live 终态事件追加进 eventLog", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compaction_summary", shadowedMessageIds: [], summary: "x" } as any);
    applyLiveChunk(store as any, "s1", { type: "text_delta", messageId: "T1_a", index: 0, text: "x" } as any);
    expect(store.state.eventLog.map((e: any) => e.type)).toContain("compaction_summary");
    expect(store.state.eventLog.map((e: any) => e.type)).not.toContain("text_delta");
  });

  it("领域事件：user/assistant 各折叠为消息束", () => {
    foldEvents(store as any, "s1", [
      { type: "turn/start", seq: 1, data: { turnId: "T1" } },
      { type: "user/message", seq: 2, data: { messageId: "T1_u", kind: "user", blocks: [{ type: "text", text: "你好" }], metadata: {} } },
      { type: "assistant/message", seq: 3, data: { messageId: "T1_a", content: [
        { type: "reasoning", summary: "思考", timing: { startedAt: 1000, finishedAt: 2000 } },
        { type: "text", text: "回答" },
      ], metadata: { modelName: "m1", finishReason: "stop", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } } } },
      { type: "turn/finish", seq: 4, data: { turnId: "T1", promptTokens: 5, completionTokens: 3, totalTokens: 8, finishReason: "stop", modelName: "m1", totalDurationMs: 1234 } },
    ]);
    const turn = store.state.turns[0];
    const ub = bundleOf(turn, "T1_u");
    expect(ub.blocks[0].content).toBe("你好");
    const ab = bundleOf(turn, "T1_a");
    expect(ab.blocks).toHaveLength(2);
    expect(ab.blocks[0].reasoningContent).toBe("思考");
    expect(ab.blocks[1].content).toBe("回答");
    expect(ab.metadata.modelName).toBe("m1");
    expect(ab.metadata.finishReason).toBe("stop");
    expect(ab.metadata.usage?.promptTokens).toBe(5);
  });

  it("回放 tool/result：按 toolCallId 聚类挂结果", () => {
    foldEvents(store as any, "s1", [
      { type: "turn/start", seq: 1, data: { turnId: "T1" } },
      { type: "user/message", seq: 2, data: { messageId: "m_u1", kind: "user", blocks: [{ type: "text", text: "q" }], metadata: {} } },
      { type: "assistant/message", seq: 3, data: { messageId: "m_a1", content: [
        { type: "text", text: "分析中" },
        { type: "tool-call", toolCallId: "call_1", name: "shell", arguments: "{}" },
        { type: "tool-call", toolCallId: "call_2", name: "read", arguments: "{}" },
      ], metadata: {} } },
      { type: "tool/result", seq: 4, data: { messageId: "m_t1", toolCallId: "call_1", name: "shell", content: "结果A", isError: false } },
      { type: "tool/result", seq: 5, data: { messageId: "m_t2", toolCallId: "call_2", name: "read", content: "结果B", isError: true } },
      { type: "turn/finish", seq: 6, data: { turnId: "T1", promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ]);
    const all = blocksOf(store.state.turns[0]);
    const c1 = all.find((b: any) => (b.metadata?.toolCalls || []).some((tc: any) => tc.id === "call_1"));
    const c2 = all.find((b: any) => (b.metadata?.toolCalls || []).some((tc: any) => tc.id === "call_2"));
    expect(c1.metadata.toolCallsResponse[0].content).toBe("结果A");
    expect(c2.metadata.toolCallsResponse[0].content).toBe("结果B");
    expect(c2.metadata.toolCalls.find((tc: any) => tc.id === "call_2").outcome).toBe("error");
  });

});

// ── 思考态跨块复位（OpenAI 系 adapter block_end 延迟防御） ──
// OpenAI 兼容流（DeepSeek/Gemini 等）的 block_end[reasoning] 可能延迟到流收尾；
// text/tool 通道首见即代表思考已让位，投影器需跨块复位 reasoning 块的 isThinking，
// 保证 UI 在正文输出开始时立即切换为"已深度思考"。
describe("思考态跨块复位", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => { store = createStore(); });

  function seedLiveTurn(tid: string) {
    foldEvents(store as any, "s1", [
      { type: "turn_start", turnId: tid, modelName: "m1" } as any,
    ]);
  }

  function applyThinkStart(mid: string, tid: string) {
    applyLiveChunk(store as any, "s1", { type: "block_start", messageId: mid, turnId: tid, index: 0, blockType: "reasoning" } as any);
    applyLiveChunk(store as any, "s1", { type: "reasoning_delta", messageId: mid, turnId: tid, index: 0, text: "思考中" } as any);
  }

  function thinkBlockOf(mid: string): any {
    return bundleOf(store.state.turns[0], mid).blocks[0];
  }

  it("block_start[text] 到达时复位 reasoning 块的 isThinking", () => {
    seedLiveTurn("T1");
    applyThinkStart("T1_a", "T1");
    expect(thinkBlockOf("T1_a").state.isThinking).toBe(true);

    applyLiveChunk(store as any, "s1", { type: "block_start", messageId: "T1_a", turnId: "T1", index: 1, blockType: "text" } as any);
    expect(thinkBlockOf("T1_a").state.isThinking).toBe(false);
  });

  it("text_delta 到达时复位 reasoning 块的 isThinking", () => {
    seedLiveTurn("T1");
    applyThinkStart("T1_a", "T1");

    applyLiveChunk(store as any, "s1", { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 1, text: "正文" } as any);
    expect(thinkBlockOf("T1_a").state.isThinking).toBe(false);
  });

  it("tool_call_delta 到达时复位 reasoning 块的 isThinking", () => {
    seedLiveTurn("T1");
    applyThinkStart("T1_a", "T1");

    applyLiveChunk(store as any, "s1", {
      type: "tool_call_delta", messageId: "T1_a", turnId: "T1", index: 1,
      toolCallId: "call_1", name: "run_command", argumentsDelta: "{}",
    } as any);
    expect(thinkBlockOf("T1_a").state.isThinking).toBe(false);
  });

  it("block_end[reasoning] 权威路径不受影响：复位 + timing 派生时长", () => {
    seedLiveTurn("T1");
    applyThinkStart("T1_a", "T1");

    applyLiveChunk(store as any, "s1", {
      type: "block_end", messageId: "T1_a", turnId: "T1", index: 0,
      block: { type: "reasoning", contentId: "r1", summary: "思考中", timing: { startedAt: 1000, finishedAt: 3500 } },
    } as any);
    const b = thinkBlockOf("T1_a");
    expect(b.state.isThinking).toBe(false);
    expect(b.reasoningContent).toBe("思考中");
    expect(b.thinkingDurationMs).toBe(2500);
  });
});