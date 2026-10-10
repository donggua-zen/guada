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
 * - 重放/实时的副作用分界：foldEvents（历史重放）不刷计划缓存、不动会话级交互卡；
 *   applyLiveChunk（实时/暂存消费）两者照常执行
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/services/ApiService", () => ({ apiService: {} }));
import {
  foldEvents,
  applyLiveChunk,
  projectChunk,
  resetTurnTransientState,
  resetSessionTurnsTransientState,
  type ProjectorSessionStore,
  type ProjectorSessionState,
} from "./streamProjector";
import type { WireStreamEvent } from "@/types/stream";
import type { Turn } from "@/types/message";

function createStore() {
  // 测试断言按"目标存在"编写：turns/eventLog 放宽为 any[]，让 find/index 访问不必逐处非空断言；
  // mock 本身仍需 satisfies 接口（编译期保证 mock 与投影器契约一致）
  const state = {
    loaded: true,
    turns: [] as any[],
    eventLog: [] as any[],
    pendingAsk: undefined as ProjectorSessionState["pendingAsk"],
  };
  // refreshPlans 必须显式实现：它是可选成员（投影器用 ?. 调用），缺省会静默 no-op，
  // 让"重放期是否误触发计划列表刷新"这一整类 bug 在测试里完全不可观测
  const refreshPlans = vi.fn((_sessionId: string): void => {});
  return {
    state,
    refreshPlans,
    getSessionState: () => state,
    getTurns: () => state.turns,
    setTurns: (_sid: string, t: Turn[]) => { state.turns = t; },
    deleteTurnById: (_sid: string, id: string) => {
      state.turns = state.turns.filter((t) => t.id !== id);
    },
    setSessionIsCompressing: () => {},
    sessionIsCompressing: () => false,
    sessionIsStreaming: (): boolean => false,
    setSessionPendingAsk: (_sid: string, v: ProjectorSessionState["pendingAsk"]) => { state.pendingAsk = v; },
    sessionPendingAsk: () => state.pendingAsk,
  } satisfies ProjectorSessionStore & {
    state: typeof state;
    refreshPlans: typeof refreshPlans;
    sessionPendingAsk: () => typeof state.pendingAsk;
  };
}

// 测试断言按"目标束/块必然存在"编写：返回值保持宽松，避免逐处非空断言噪声
function blocksOf(turn: Turn | undefined): any[] {
  return (turn?.messages ?? []).flatMap((m) => m.blocks ?? []);
}
function bundleOf(turn: Turn | undefined, messageId: string): any {
  return (turn?.messages ?? []).find((m) => m.messageId === messageId);
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

  it("subagent_link 把关联键写到对应 tool-call 条目上（工具结果落库前即可用）", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "tool-call" } as any,
      { type: "tool_call_delta", messageId: "T1_a", turnId: "T1", index: 0, toolCallId: "tc1", name: "subagent_spawn", argumentsDelta: '{"name":"分析架构"}' } as any,
      { type: "block_end", messageId: "T1_a", turnId: "T1", index: 0, block: { type: "tool-call", contentId: "tc_c1", toolCallId: "tc1", name: "subagent_spawn", arguments: '{"name":"分析架构"}' } } as any,
      // 工具结果尚未到达（前台 spawn 阻塞期间），关联键只能来自这条流事件
      { type: "subagent_link", toolCallId: "tc1", subSessionId: "sub-9", name: "分析架构" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const block = blocksOf(store.state.turns[0]).find((b: any) => b.role === "assistant");
    expect(block.metadata.toolCalls[0].subAgentLink).toEqual({
      subSessionId: "sub-9",
      name: "分析架构",
    });
    // 结果还没到：不应误建 toolCallsResponse
    expect(block.metadata.toolCallsResponse).toBeUndefined();
  });

  it("subagent_link 找不到对应 tool-call 时静默忽略（不抛错）", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "subagent_link", toolCallId: "nope", subSessionId: "sub-9" } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    expect(() => foldEvents(store as any, "s1", events)).not.toThrow();
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

  it("compression_end（纯裁剪）：'压缩中'占位替换为压缩结果卡（不再一闪而过）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start" } as any);
    applyLiveChunk(store as any, "s1", {
      type: "compression_end",
      contextStats: { usedTokens: 100, effectiveContextWindow: 1000 },
      pruneEvents: 3,
      compacted: false,
      skipReason: "retain-budget-exceeds-history",
    } as any);
    // 纯裁剪无 compaction_summary：保留一张结果卡说明本次做了什么
    const resultCarrier = (t: any) =>
      t.metadata?.compressResult ??
      t.messages?.find((m: any) => m.metadata?.compressResult)?.metadata
        ?.compressResult;
    const resultTurns = store.state.turns.filter((t: any) => !!resultCarrier(t));
    expect(resultTurns.length).toBe(1);
    expect(resultCarrier(resultTurns[0])).toMatchObject({
      pruneEvents: 3,
      compacted: false,
      skipReason: "retain-budget-exceeds-history",
    });
    // "压缩中"占位不得残留
    expect(store.state.turns.some((t: any) => t.metadata?.compressing)).toBe(false);
  });

  it("compression_end（微压缩）：结果卡携带 tier=micro 与思考剥离数", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    applyLiveChunk(store as any, "s1", { type: "compression_start", tier: "micro" } as any);
    applyLiveChunk(store as any, "s1", {
      type: "compression_end",
      tier: "micro",
      contextStats: { usedTokens: 100, effectiveContextWindow: 1000 },
      pruneEvents: 2,
      thinkingStrippedCount: 5,
      compacted: false,
    } as any);
    const resultCarrier = (t: any) =>
      t.metadata?.compressResult ??
      t.messages?.find((m: any) => m.metadata?.compressResult)?.metadata
        ?.compressResult;
    const resultTurns = store.state.turns.filter((t: any) => !!resultCarrier(t));
    expect(resultTurns.length).toBe(1);
    expect(resultCarrier(resultTurns[0])).toMatchObject({
      tier: "micro",
      pruneEvents: 2,
      thinkingStrippedCount: 5,
      compacted: false,
    });
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

  // ===== 流终止瞬态复位（resetTurnTransientState / resetSessionTurnsTransientState）=====

  it("turn_end 错误收尾（无 finish chunk）复位块级瞬态", () => {
    seedLiveTurn("T1");
    applyThinkStart("T1_a", "T1");
    const bundle = bundleOf(store.state.turns[0], "T1_a");
    expect(bundle.blocks[0].state.isThinking).toBe(true);
    expect(bundle.blocks[0].state.isStreaming).toBe(true);

    // 错误路径：LLM 报错后只有 turn_end，finish chunk 永不到达
    applyLiveChunk(store as any, "s1", { type: "turn_end", turnId: "T1", finishReason: "error", error: "boom" } as any);
    expect(store.state.turns[0].state.isWorking).toBe(false);
    expect(bundle.blocks[0].state.isThinking).toBe(false);
    expect(bundle.blocks[0].state.isStreaming).toBe(false);
  });

  it("resetTurnTransientState：一次性复位回合级与块级全部瞬态", () => {
    const turn: any = {
      id: "T9", kind: "turn", metadata: {},
      messages: [{
        messageId: "m1", role: "assistant", metadata: {},
        blocks: [
          { state: { isStreaming: true, isThinking: true } },
          { state: { isStreaming: true, isThinking: false } },
        ],
        state: { isStreaming: true, isThinking: true },
      }],
      state: { isWorking: true, startedAt: 1, retry: { retryReason: "timeout", retryAttempt: 1, retryMaxAttempts: 3, retryDelayMs: 100 } },
    };
    resetTurnTransientState(turn);
    expect(turn.state.isWorking).toBe(false);
    expect(turn.state.retry).toBeUndefined();
    expect(turn.messages[0].state.isStreaming).toBe(false);
    expect(turn.messages[0].state.isThinking).toBe(false);
    for (const b of turn.messages[0].blocks) {
      expect(b.state.isStreaming).toBe(false);
      expect(b.state.isThinking).toBe(false);
    }
  });

  it("resetTurnTransientState：历史回合（无 state）安全通过", () => {
    const turn: any = { id: "T8", kind: "turn", metadata: {}, messages: [] };
    expect(() => resetTurnTransientState(turn)).not.toThrow();
    expect(turn.state).toBeUndefined();
  });

  it("resetSessionTurnsTransientState：复位会话下所有回合的瞬态", () => {
    foldEvents(store as any, "s1", [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      { type: "turn_start", turnId: "T2", modelName: "m1" } as any,
    ]);
    applyThinkStart("T1_a", "T1");
    for (const t of store.state.turns) t.state.isWorking = true;

    resetSessionTurnsTransientState(store as any, "s1");
    expect(store.state.turns.every((t: any) => !t.state.isWorking)).toBe(true);
    expect(thinkBlockOf("T1_a").state.isThinking).toBe(false);
  });

  it("foldEvents 重放无 turn/finish 的回合不复活工作态（后端重启残留）", () => {
    foldEvents(store as any, "s1", [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      { type: "user_message", messageId: "T1_u", turnId: "T1", userMessage: { id: "T1_u", role: "user", kind: "user", metadata: {}, content: [{ type: "text", contentId: "T1_uc", text: "你好" }] } } as any,
    ]);
    // turn_start 折叠置位的工作态被折叠后复位：会话未在流式中 → 视为已终止
    expect(store.state.turns[0].state.isWorking).toBe(false);
  });

  it("foldEvents 流式中重折保留工作态", () => {
    store.sessionIsStreaming = () => true;
    foldEvents(store as any, "s1", [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
    ]);
    expect(store.state.turns[0].state.isWorking).toBe(true);
  });
});

// ── 重放不带实时副作用 ──
// foldEvents（历史重放）与 applyLiveChunk（实时）共用同一折叠器，但副作用必须分家：
// 重放每个历史回合都刷计划缓存 = 首屏数十次 GET /plans（load-more 重折还会累加）；
// 重放清会话级交互卡 = 把 SSE 补发回来的待批卡当场抹掉（刷新后待批状态丢失的真凶）。
describe("重放不带实时副作用", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => { store = createStore(); });

  /** 事件页真实形状：领域事件 turn/finish（非流式 turn_end） */
  function domainTurnPage(tid: string): any[] {
    return [
      { type: "turn/start", seq: 1, data: { turnId: tid, modelName: "m1" } },
      { type: "user/message", seq: 2, data: { messageId: `${tid}_u`, kind: "user", blocks: [{ type: "text", text: "你好" }], metadata: {} } },
      { type: "assistant/message", seq: 3, data: { messageId: `${tid}_a`, content: [{ type: "text", text: "回答" }], metadata: {} } },
      { type: "turn/finish", seq: 4, data: { turnId: tid, finishReason: "stop", promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
    ];
  }

  it("foldEvents 折叠历史（含 turn/finish）不触发计划列表刷新", () => {
    foldEvents(store as any, "s1", domainTurnPage("T1"));
    expect(store.state.turns[0].metadata.finishReason).toBe("stop");
    expect(store.refreshPlans).not.toHaveBeenCalled();
  });

  it("applyLiveChunk 实时 turn_end 照常触发计划列表刷新", () => {
    applyLiveChunk(store as any, "s1", { type: "turn_end", turnId: "T1", finishReason: "stop" } as any);
    expect(store.refreshPlans).toHaveBeenCalledTimes(1);
    expect(store.refreshPlans).toHaveBeenCalledWith("s1");
  });

  it("foldEvents 重放不清理会话级交互卡（刷新后待批卡存活的关键）", () => {
    store.state.pendingAsk = { requestId: "req1", kind: "approval", title: "计划审批", questions: [] } as any;
    foldEvents(store as any, "s1", domainTurnPage("T1"));
    expect(store.state.pendingAsk?.requestId).toBe("req1");
  });

  it("applyLiveChunk 实时 turn_end 仍清理会话级交互卡", () => {
    store.state.pendingAsk = { requestId: "req1", kind: "approval", title: "计划审批", questions: [] } as any;
    applyLiveChunk(store as any, "s1", { type: "turn_end", turnId: "T1", finishReason: "stop" } as any);
    expect(store.state.pendingAsk).toBeUndefined();
  });

  it("重放 plan_mode_changed 仍恢复计划模式状态，但不刷计划缓存", () => {
    const applied: Array<{ sid: string; enabled: boolean }> = [];
    (store as any).applyRemotePlanEnabled = (sid: string, enabled: boolean) => { applied.push({ sid, enabled }); };
    // plan_mode_changed 是终态流事件：会进 eventLog，load-more 重折时会再次命中该分支
    foldEvents(store as any, "s1", [{ type: "plan_mode_changed", planEnabled: false } as any]);
    expect(applied).toEqual([{ sid: "s1", enabled: false }]);
    expect(store.refreshPlans).not.toHaveBeenCalled();
  });
});

// ── projectChunk：会话级交互卡先于缓存门控 ──
// 侧边栏等会话级消费者要看到「未打开过内容的会话」的待批状态（刷新后的非当前会话、
// 另一窗口正在跑的会话）：ask_requested/ask_resolved 必须先于 hasCache 门控直写 store，
// 否则这些会话只进暂存、pendingAsk 永远为空。
describe("projectChunk 会话级交互卡先于缓存门控", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => { store = createStore(); });

  it("无缓存会话收到 ask_requested 也写入交互卡（仍只暂存不建树）", () => {
    store.state.loaded = false;
    store.state.turns = [];

    projectChunk(store as any, "s-uncached", {
      type: "ask_requested",
      requestId: "req1",
      kind: "approval",
      title: "计划审批",
      questions: [],
    } as any);

    expect(store.state.pendingAsk?.requestId).toBe("req1");
    expect(store.state.pendingAsk?.title).toBe("计划审批");
    // stash 语义不变：无缓存路径不建回合树（打开会话时才应用暂存）
    expect(store.state.turns).toHaveLength(0);
  });

  it("无缓存会话收到 ask_resolved 清除交互卡", () => {
    store.state.loaded = false;
    store.state.turns = [];
    store.state.pendingAsk = { requestId: "req1", kind: "approval", questions: [] } as any;

    projectChunk(store as any, "s-uncached", {
      type: "ask_resolved",
      requestId: "req1",
      outcome: "answered",
    } as any);

    expect(store.state.pendingAsk).toBeUndefined();
  });
});