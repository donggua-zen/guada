/**
 * StreamProjector 折叠器测试
 *
 * 覆盖（前端自折叠核心，二级结构 turn → block）：
 * - foldEvents 事件页折叠 → turn 树（turn_start/user_message/assistant 块/turn_end）
 * - compaction_summary：in-turn → 回合内 event 块；out-of-turn → 独立 event 回合；遮蔽块被移除
 * - turn_delete：移除回合
 * - 收敛：replay 完整块（block_end 覆盖）与 live delta（text_delta 累加）折叠到同一棵树
 * - 多块消息按 (messageId, index) 寻址为独立块；user 多块（文本+文件）；tool_calls_response 按 toolCallId 挂载
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
// 折叠器不调用 ApiService（messageToTurnContent 为纯转换）——mock 掉以切断
// ApiService → locales → localStorage 的导入链（node 环境无 localStorage）
vi.mock("@/services/ApiService", () => ({ apiService: {} }));
import { foldEvents, applyLiveChunk } from "./streamProjector";
import type { WireStreamEvent } from "@/types/stream";

/** 最小 sessionStore mock（plain 数组，不依赖 Vue 响应式） */
function createStore() {
  const state: any = { loaded: true, turns: [], eventLog: [] };
  return {
    state,
    getSessionState: () => state,
    getTurns: () => state.turns,
    setTurns: (_sid: string, t: any[]) => {
      state.turns = t;
    },
    deleteTurnById: (_sid: string, id: string) => {
      state.turns = state.turns.filter((t: any) => t.id !== id);
    },
    setSessionIsCompressing: () => {},
    sessionIsCompressing: () => false,
    // 会话级统一交互卡（审批/询问/迭代暂停共用：sessionId 唯一锚点，不挂回合）
    setSessionPendingAsk: (_sid: string, v: any) => {
      state.pendingAsk = v;
    },
    sessionPendingAsk: () => state.pendingAsk,
  };
}

function textChunks(messageId: string, turnId: string, text: string): WireStreamEvent[] {
  return [
    { type: "block_start", messageId, turnId, index: 0, blockType: "text" } as any,
    {
      type: "block_end",
      messageId,
      turnId,
      index: 0,
      block: { type: "text", contentId: "c1", text },
    } as any,
    { type: "usage", messageId, turnId, usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } } as any,
    { type: "finish", messageId, turnId, finishReason: "stop" } as any,
  ];
}

/** 一个完整回合的事件页（turn_start + user + assistant 块 + turn_end） */
function turnPage(turnId: string, userText: string, answer: string): WireStreamEvent[] {
  return [
    { type: "turn_start", turnId, modelName: "m1" } as any,
    {
      type: "user_message",
      messageId: `${turnId}_u`,
      turnId,
      userMessage: {
        id: `${turnId}_u`,
        role: "user",
        kind: "user",
        metadata: {},
        content: [{ type: "text", contentId: `${turnId}_uc`, text: userText }],
      },
    } as any,
    ...textChunks(`${turnId}_a`, turnId, answer),
    { type: "turn_end", turnId, finishReason: "stop", usage: { promptTokens: 5 } } as any,
  ];
}

describe("StreamProjector 折叠器", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it("foldEvents 事件页 → turn 树（user + assistant 块，二级结构）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    expect(store.state.turns).toHaveLength(1);
    const turn = store.state.turns[0];
    expect(turn.id).toBe("T1");
    expect(turn.metadata.modelName).toBe("m1");
    // 用户块（role 打标 + messageId 锚点）
    const user = turn.blocks.find((b: any) => b.role === "user");
    expect(user.content).toBe("你好");
    expect(user.messageId).toBe("T1_u");
    // 助手块：block_end 覆盖完整内容 + usage + finish 复位流式态
    const assistant = turn.blocks.find((b: any) => b.role === "assistant");
    expect(assistant.content).toBe("回答");
    expect(assistant.messageId).toBe("T1_a");
    expect(assistant.metadata.usage?.promptTokens).toBe(5);
    expect(assistant.metadata.finishReason).toBe("stop");
    expect(assistant.state.isStreaming).toBe(false);
    // 回合收尾元数据
    expect(turn.metadata.finishReason).toBe("stop");
    expect(turn.state.isWorking).toBe(false);
  });

  it("多块 assistant 消息按 (messageId, index) 寻址为独立块（reasoning + text 不合并）", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "reasoning" } as any,
      { type: "reasoning_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "思考" } as any,
      {
        type: "block_end",
        messageId: "T1_a",
        turnId: "T1",
        index: 0,
        block: { type: "reasoning", contentId: "r1", summary: "思考", timing: { startedAt: 1000, finishedAt: 2000 } },
      } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 1, blockType: "text" } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 1, text: "回答" } as any,
      {
        type: "block_end",
        messageId: "T1_a",
        turnId: "T1",
        index: 1,
        block: { type: "text", contentId: "c1", text: "回答" },
      } as any,
      { type: "usage", messageId: "T1_a", turnId: "T1", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } } as any,
      { type: "finish", messageId: "T1_a", turnId: "T1", finishReason: "stop" } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const blocks = store.state.turns[0].blocks.filter((b: any) => b.role === "assistant");
    // 两个独立块（不再合并单桶），contentId 回填
    expect(blocks).toHaveLength(2);
    const reasoning = blocks.find((b: any) => b.blockIndex === 0);
    const text = blocks.find((b: any) => b.blockIndex === 1);
    expect(reasoning.id).toBe("r1");
    expect(reasoning.reasoningContent).toBe("思考");
    expect(reasoning.thinkingDurationMs).toBe(1000);
    expect(text.id).toBe("c1");
    expect(text.content).toBe("回答");
    // usage 为消息级：仅挂最后一块（tokenUsage 逐块求和不重复计数）
    expect(text.metadata.usage?.promptTokens).toBe(5);
    expect(reasoning.metadata.usage).toBeUndefined();
    expect(text.state.isStreaming).toBe(false);
  });

  it("user 多块（文本 + 图片）独立块，role/messageId 打标", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      {
        type: "user_message",
        messageId: "T1_u",
        turnId: "T1",
        userMessage: {
          id: "T1_u",
          role: "user",
          kind: "user",
          metadata: {},
          content: [
            { type: "text", contentId: "uc1", text: "看图" },
            {
              type: "image",
              contentId: "uc2",
              attachment: { attachmentId: "att1", mediaType: "image/png", name: "a.png", url: "/files/1" },
            },
          ],
        },
      } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const users = store.state.turns[0].blocks.filter((b: any) => b.role === "user");
    expect(users).toHaveLength(2);
    expect(users[0].content).toBe("看图");
    expect(users[1].files?.[0]?.name).toBe("a.png");
    expect(users[1].messageId).toBe("T1_u");
    expect(users[0].messageId).toBe("T1_u");
  });

  it("tool_calls_response 按 toolCallId 挂到对应 tool-call 块（outcome + toolCallsResponse）", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      {
        type: "block_start",
        messageId: "T1_a",
        turnId: "T1",
        index: 0,
        blockType: "tool-call",
      } as any,
      {
        type: "tool_call_delta",
        messageId: "T1_a",
        turnId: "T1",
        index: 0,
        toolCallId: "tc1",
        name: "web_search",
        argumentsDelta: "{}",
      } as any,
      {
        type: "block_end",
        messageId: "T1_a",
        turnId: "T1",
        index: 0,
        block: { type: "tool-call", contentId: "tc_c1", toolCallId: "tc1", name: "web_search", arguments: "{}" },
      } as any,
      {
        type: "tool_calls_response",
        messageId: "T1_a",
        turnId: "T1",
        toolCallsResponse: [
          { name: "web_search", content: "结果", toolCallId: "tc1", outcome: "success" },
        ],
      } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const assistant = store.state.turns[0].blocks.find((b: any) => b.role === "assistant");
    expect(assistant.metadata.toolCalls[0].name).toBe("web_search");
    expect(assistant.metadata.toolCalls[0].outcome).toBe("success");
    expect(assistant.metadata.toolCallsResponse[0].content).toBe("结果");
  });

  it("compaction_summary in-turn：遮蔽块被移除 + 回合内 event 占位（压缩在 turn_end 前）", () => {
    // 自动压缩发生在回合内（turn_end 之前）
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      {
        type: "user_message",
        messageId: "T1_u",
        turnId: "T1",
        userMessage: {
          id: "T1_u",
          role: "user",
          kind: "user",
          metadata: {},
          content: [{ type: "text", contentId: "T1_uc", text: "旧" }],
        },
      } as any,
      {
        type: "compaction_summary",
        shadowedMessageIds: ["T1_u"],
        summary: "已优化对话历史",
        messageId: "sum_1",
      } as any,
      { type: "turn_end", turnId: "T1", finishReason: "stop" } as any,
    ];
    foldEvents(store as any, "s1", events);
    const turn = store.state.turns.find((t: any) => t.id === "T1");
    // 遮蔽块的 messageId 被移除
    expect(turn.blocks.some((b: any) => b.messageId === "T1_u")).toBe(false);
    // in-turn（当前回合 T1）→ 回合内 event 占位块
    const placeholder = turn.blocks.find((b: any) => b.role === "event");
    expect(placeholder).toBeDefined();
    expect(placeholder.metadata.eventType).toBe("compaction");
    expect(placeholder.metadata.compactInfo.summary).toBe("已优化对话历史");
    // 无独立 event 回合
    expect(store.state.turns.some((t: any) => t.kind === "event")).toBe(false);
  });

  it("compaction_summary out-of-turn：独立 kind:event 回合（无宿主回合）", () => {
    const events: WireStreamEvent[] = [
      ...turnPage("T1", "你好", "回答"),
      // 回合已结束（turn_end 清除 currentTurnId）→ 之后的 compaction 无宿主
      {
        type: "compaction_summary",
        shadowedMessageIds: ["T1_u", "T1_a"],
        summary: "已优化对话历史",
        messageId: "sum_2",
      } as any,
    ];
    foldEvents(store as any, "s1", events);
    // 遮蔽块（user + assistant）已从 T1 移除
    const turn = store.state.turns.find((t: any) => t.id === "T1");
    expect(turn.blocks).toHaveLength(0);
    // 独立 event 回合
    const eventTurn = store.state.turns.find((t: any) => t.kind === "event");
    expect(eventTurn).toBeDefined();
    expect(eventTurn.blocks[0].role).toBe("event");
    expect(eventTurn.blocks[0].metadata.compactInfo.summary).toBe("已优化对话历史");
  });

  it("turn_delete：移除回合（重答语义）", () => {
    const events: WireStreamEvent[] = [
      ...turnPage("T1", "你好", "回答"),
      { type: "turn_delete", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", events);
    expect(store.state.turns.some((t: any) => t.id === "T1")).toBe(false);
  });

  it("收敛：replay 完整块（block_end 覆盖）与 live delta（text_delta 累加）折叠到同一内容", () => {
    // replay 风格：block_start + block_end（完整文本）
    const replayEvents: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      ...textChunks("T1_a", "T1", "Hello World"),
      { type: "turn_end", turnId: "T1" } as any,
    ];
    foldEvents(store as any, "s1", replayEvents);

    // live 风格：text_delta 逐段累加 + block_end 覆盖
    const liveEvents: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1" } as any,
      { type: "block_start", messageId: "T1_a", turnId: "T1", index: 0, blockType: "text" } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "Hello " } as any,
      { type: "text_delta", messageId: "T1_a", turnId: "T1", index: 0, text: "World" } as any,
      {
        type: "block_end",
        messageId: "T1_a",
        turnId: "T1",
        index: 0,
        block: { type: "text", contentId: "c1", text: "Hello World" },
      } as any,
      { type: "turn_end", turnId: "T1" } as any,
    ];
    const liveStore = createStore();
    foldEvents(liveStore as any, "s1", liveEvents);

    const replayContent =
      store.state.turns[0].blocks.find((b: any) => b.role === "assistant").content;
    const liveContent =
      liveStore.state.turns[0].blocks.find((b: any) => b.role === "assistant").content;
    expect(liveContent).toBe("Hello World");
    expect(replayContent).toBe(liveContent);
  });

  it("applyLiveChunk：live 终态事件追加进 eventLog（delta 不记录）", () => {
    foldEvents(store as any, "s1", turnPage("T1", "你好", "回答"));
    // live：一个终态事件 + 一个 delta
    applyLiveChunk(store as any, "s1", {
      type: "compaction_summary",
      shadowedMessageIds: [],
      summary: "x",
    } as any);
    applyLiveChunk(store as any, "s1", {
      type: "text_delta",
      messageId: "T1_a",
      index: 0,
      text: "增量",
    } as any);
    const types = store.state.eventLog.map((e: any) => e.type);
    expect(types).toContain("compaction_summary");
    expect(types).not.toContain("text_delta");
  });

  it("ask_requested（approval 特例）：会话级标记统一交互卡并携带问题单（对齐 DSH：不挂回合）", () => {
    const events: WireStreamEvent[] = [
      { type: "turn_start", turnId: "T1", modelName: "m1" } as any,
      {
        type: "ask_requested",
        kind: "approval",
        requestId: "uuid-request-1",
        title: "需要审批",
        toolCallId: "tc1",
        toolName: "run_command",
        questions: [
          { id: "approval", question: "是否同意？", options: [{ label: "同意" }, { label: "拒绝" }] },
        ],
      } as any,
    ];
    foldEvents(store as any, "s1", events);
    // 会话级容器（不依赖回合存在/turnId）；新架构无超时字段
    expect(store.state.pendingAsk).toEqual({
      requestId: "uuid-request-1",
      kind: "approval",
      title: "需要审批",
      toolCallId: "tc1",
      toolName: "run_command",
      questions: [
        { id: "approval", question: "是否同意？", options: [{ label: "同意" }, { label: "拒绝" }] },
      ],
    });
    // 回合不携带交互态
    const turn = store.state.turns.find((t: any) => t.id === "T1");
    expect(turn?.state?.pendingAsk).toBeUndefined();
    // turn_end 清除
    foldEvents(store as any, "s1", [
      { type: "turn_end", turnId: "T1", finishReason: "stop" } as any,
    ]);
    expect(store.state.pendingAsk).toBeUndefined();
  });

  it("ask_requested（ask 多问题）原样透传问题单；ask_resolved 清卡（多窗口同步）", () => {
    const questions = [
      { id: "q1", question: "哪种方案？", options: [{ label: "方案A" }, { label: "方案B" }] },
      { id: "q2", question: "补充说明？", options: [{ label: "是" }], multiSelect: true },
    ];
    foldEvents(store as any, "s1", [
      {
        type: "ask_requested",
        kind: "ask",
        requestId: "uuid-request-2",
        title: "选择方案",
        questions,
      } as any,
    ]);
    expect(store.state.pendingAsk).toMatchObject({
      requestId: "uuid-request-2",
      kind: "ask",
      questions,
    });
    // ask_resolved：answered/cancelled 均清卡（多窗口收卡同步由此保证）
    foldEvents(store as any, "s1", [
      { type: "ask_resolved", requestId: "uuid-request-2", outcome: "answered" } as any,
    ]);
    expect(store.state.pendingAsk).toBeUndefined();
  });

  it("领域事件：assistant/message 一条 = 全部块，turn/finish 直接写回合元数据", () => {
    const events: any[] = [
      { type: "turn/start", seq: 1, data: { turnId: "T1" } },
      { type: "user/message", seq: 2, data: { messageId: "T1_u", kind: "user", content: "你好", metadata: {} } },
      {
        type: "assistant/message",
        seq: 3,
        data: {
          messageId: "T1_a",
          content: [
            { type: "reasoning", contentId: "r1", summary: "思考", timing: { startedAt: 1000, finishedAt: 2000 } },
            { type: "text", contentId: "c1", text: "回答" },
          ],
          metadata: { modelName: "m1", finishReason: "stop", usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
        },
      },
      { type: "turn/finish", seq: 4, data: { turnId: "T1", promptTokens: 5, completionTokens: 3, totalTokens: 8, finishReason: "stop", modelName: "m1" } },
    ];
    foldEvents(store as any, "s1", events);
    const turn = store.state.turns[0];
    // user 块 + 2 个独立 assistant 块（reasoning/text，领域事件一条=全部块）
    const user = turn.blocks.find((b: any) => b.role === "user");
    expect(user.content).toBe("你好");
    const assistants = turn.blocks.filter((b: any) => b.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].reasoningContent).toBe("思考");
    expect(assistants[0].thinkingDurationMs).toBe(1000);
    expect(assistants[1].content).toBe("回答");
    // turn/finish → 回合元数据（后端零预扫，直接来自领域事件）
    expect(turn.metadata.modelName).toBe("m1");
    expect(turn.metadata.finishReason).toBe("stop");
    expect(turn.metadata.usage?.promptTokens).toBe(5);
    expect(turn.state.isWorking).toBe(false);
  });

  it("领域事件：tool/result 挂 toolCallsResponse，compaction/summary 遮蔽，turn/delete 移除", () => {
    const events: any[] = [
      { type: "turn/start", seq: 1, data: { turnId: "T1" } },
      { type: "user/message", seq: 2, data: { messageId: "T1_u", kind: "user", content: "q", metadata: {} } },
      {
        type: "assistant/message",
        seq: 3,
        data: {
          messageId: "T1_a",
          content: [{ type: "tool-call", contentId: "tc_c", toolCallId: "tc1", name: "shell", arguments: "{}" }],
          metadata: {},
        },
      },
      { type: "tool/result", seq: 4, data: { messageId: "T1_a", toolCallId: "tc1", name: "shell", content: "结果", isError: false } },
      { type: "turn/finish", seq: 5, data: { turnId: "T1", promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    ];
    foldEvents(store as any, "s1", events);
    const turn = store.state.turns[0];
    const assistant = turn.blocks.find((b: any) => b.role === "assistant");
    expect(assistant.metadata.toolCalls[0].name).toBe("shell");
    expect(assistant.metadata.toolCallsResponse[0].content).toBe("结果");
    expect(assistant.metadata.toolCallsResponse[0].outcome).toBe("success");

    // compaction/summary（领域，回合已结束 → out-of-turn）：遮蔽移除 + 独立 event 回合占位
    applyLiveChunk(store as any, "s1", {
      type: "compaction/summary",
      seq: 6,
      data: { shadowedMessageIds: ["T1_u", "T1_a"], summary: "已压缩", summaryMessageId: "sum_1" },
    } as any);
    expect(store.state.turns[0].blocks.some((b: any) => b.messageId === "T1_u")).toBe(false);
    expect(store.state.turns.some((t: any) => t.kind === "event")).toBe(true);

    // turn/delete（领域）：移除整回合
    applyLiveChunk(store as any, "s1", {
      type: "turn/delete",
      seq: 7,
      data: { turnId: "T1" },
    } as any);
    expect(store.state.turns.some((t: any) => t.id === "T1")).toBe(false);
  });
});
