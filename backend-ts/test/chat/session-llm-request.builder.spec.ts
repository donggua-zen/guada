/// <reference types="jest" />

import type {
  ContentBlock,
  FileRef,
  Message,
} from "../../src/common/types/conversation.types";
import type { ISessionContext } from "../../src/modules/chat/session-context";
import { buildSessionLlmParams } from "../../src/modules/chat/session-llm-request.builder";
import { clearMediaBudgetPressure } from "../../src/modules/llm-core/media-budget";

/**
 * 请求组装器集成契约：ensureToolPairing → 工具图片派生 → 媒体字节预算。
 * 这里只验证请求视图的可观察结果（哪些图还在、占位是否存在）。
 */

function imageRef(name: string, bytes = 150 * 1024): FileRef {
  return {
    mediaType: "image/jpeg",
    bytes,
    name,
    url: `sessions/s1/images/${name}`,
    refType: "session",
  };
}

function toolMessage(id: string, callId: string, name: string, refs: FileRef[]): Message {
  return {
    id,
    role: "tool",
    kind: "model",
    source: { kind: "tool", toolCallId: callId },
    metadata: {},
    content: [
      {
        type: "tool-result",
        toolCallId: callId,
        name,
        content: "ok",
        images: refs,
      },
    ],
  };
}

function assistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    kind: "model",
    source: { kind: "model", provider: "p", model: "m" },
    metadata: {},
    content: [{ type: "text", text: "done" }],
  };
}

/** 带 tool-call 的 assistant 消息（配对兜底要求 tool 结果必须有对应调用） */
function assistantWithCall(id: string, callId: string, name: string): Message {
  return {
    id,
    role: "assistant",
    kind: "model",
    source: { kind: "model", provider: "p", model: "m" },
    metadata: {},
    content: [
      {
        type: "tool-call",
        toolCallId: callId,
        name,
        arguments: "{}",
      },
    ],
  };
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    role: "user",
    kind: "user",
    source: { kind: "user" },
    metadata: {},
    content: [{ type: "text", text }],
  };
}

function createContext(
  messages: Message[],
  opts: { inputCapabilities?: string[] } = {},
): ISessionContext {
  const modelConfig = {
    id: "m1",
    modelName: "test-model",
    name: "test",
    provider: {},
    modelType: "chat",
    thinkingEfforts: [],
    config: {
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      inputCapabilities: opts.inputCapabilities ?? ["image"],
    },
  };
  return {
    sessionId: "s1",
    sessionType: "web",
    getModelConfig: () => modelConfig as any,
    getSystemText: () => "system",
    getResolvedPlugins: () => [],
    getThinkingEffort: () => undefined,
    getWorkspacePath: () => null,
  } as unknown as ISessionContext;
}

function imageBlocks(messages: Message[]): number {
  return messages.reduce(
    (sum, m) => sum + m.content.filter((b) => b.type === "image").length,
    0,
  );
}

describe("buildSessionLlmParams 媒体预算集成", () => {
  afterEach(() => clearMediaBudgetPressure("s1"));

  it("预算充足：全部工具图进入请求视图", () => {
    const messages = [
      userMessage("u1", "go"),
      assistantWithCall("a1", "c1", "browser_run"),
      toolMessage("t1", "c1", "browser_run", [imageRef("a.jpg")]),
      assistantWithCall("a2", "c2", "browser_run"),
      toolMessage("t2", "c2", "browser_run", [imageRef("b.jpg")]),
    ];
    const params = buildSessionLlmParams(createContext(messages), {
      messages,
      requestMediaBudgetBytes: 8 * 1024 * 1024,
    });
    expect(imageBlocks(params.messages)).toBe(2);
  });

  it("超预算：较旧的工具图退化为占位文本，最新的保留", () => {
    const messages = [
      userMessage("u1", "go"),
      assistantWithCall("a1", "c1", "browser_run"),
      toolMessage("t1", "c1", "browser_run", [imageRef("old.jpg")]),
      assistantWithCall("a2", "c2", "browser_run"),
      toolMessage("t2", "c2", "browser_run", [imageRef("new.jpg")]),
    ];
    const params = buildSessionLlmParams(createContext(messages), {
      messages,
      // 只装得下一张（150KB → base64 ~200KB）
      requestMediaBudgetBytes: 210 * 1024,
    });
    expect(imageBlocks(params.messages)).toBe(1);
    const texts = params.messages
      .flatMap((m) => m.content)
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    expect(texts.some((t) => t.includes("media budget"))).toBe(true);
  });

  it("非多模态模型：仍不派生图片（预算投影不制造 image 块）", () => {
    const messages = [
      userMessage("u1", "go"),
      assistantWithCall("a1", "c1", "browser_run"),
      toolMessage("t1", "c1", "browser_run", [imageRef("a.jpg")]),
    ];
    const params = buildSessionLlmParams(
      createContext(messages, { inputCapabilities: [] }),
      { messages },
    );
    expect(imageBlocks(params.messages)).toBe(0);
  });
});
