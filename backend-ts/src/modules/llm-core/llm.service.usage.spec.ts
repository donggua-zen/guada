import { LLMService } from "./llm.service";
import type { LLMCompletionResult, StreamChunk } from "./types/llm.types";

describe("LLMService usage observation", () => {
  let adapter: { chatCompletion: jest.Mock };
  let usage: { resolveSource: jest.Mock; recordSafely: jest.Mock };
  let service: LLMService;

  beforeEach(() => {
    adapter = { chatCompletion: jest.fn() };
    const registry = { getAdapter: jest.fn(() => adapter) };
    const settings = {
      getSettingValue: jest.fn(
        async (_group: string, _key: string, fallback: unknown) => fallback,
      ),
    };
    const capability = {
      resolveThinkingEffort: jest.fn((_provider, _model, effort) => effort),
      resolveThinkingPatch: jest.fn(() => undefined),
      resolveThinkingPatchExpr: jest.fn(() => undefined),
    };
    usage = {
      resolveSource: jest.fn(({ source, purpose, sessionId }) => {
        if (source) return source;
        if (purpose) return purpose;
        return sessionId ? "main_turn" : "other";
      }),
      recordSafely: jest.fn(),
    };

    service = new LLMService(
      registry as any,
      settings as any,
      capability as any,
      usage as any,
    );
  });

  it("流式调用结束后写入一条完整明细", async () => {
    adapter.chatCompletion.mockReturnValue(streamChunks());

    const result = (await service.completions({
      model: "m1",
      messages: [],
      stream: true,
      providerConfig: { id: "p1", type: "custom", protocol: "mock" },
      usageContext: {
        sessionId: "s1",
        turnId: "t1",
        requestId: "msg-1",
        assistantMessageId: "msg-1",
        source: "main_turn",
        attemptIndex: 2,
      },
    })) as AsyncGenerator<StreamChunk>;

    for await (const _chunk of result) {
      // drain
    }

    expect(usage.recordSafely).toHaveBeenCalledTimes(1);
    expect(usage.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        turnId: "t1",
        logicalRequestId: "msg-1",
        assistantMessageId: "msg-1",
        attemptIndex: 2,
        source: "main_turn",
        providerId: "p1",
        modelId: "m1",
        status: "completed",
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }),
    );
    const observation = usage.recordSafely.mock.calls[0][0];
    expect(observation.firstTokenAt).toEqual(expect.any(Number));
    expect(observation.completedAt).toEqual(expect.any(Number));
  });

  it("非流式调用排空 generator 并返回正文 + usage", async () => {
    adapter.chatCompletion.mockReturnValue(nonStreamChunks());

    const result = (await service.completions({
      model: "m1",
      messages: [],
      stream: false,
      providerConfig: { id: "p1", type: "custom", protocol: "mock" },
      purpose: "session_title",
      usageContext: { sessionId: "s1" },
    })) as LLMCompletionResult;

    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({
      promptTokens: 20,
      completionTokens: 5,
      totalTokens: 25,
    });
    expect(result.finishReason).toBe("stop");
    expect(usage.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "session_title",
        status: "completed",
        usage: expect.objectContaining({ totalTokens: 25 }),
      }),
    );
  });

  it("流异常时记录 error 且不吞掉异常", async () => {
    adapter.chatCompletion.mockReturnValue(failingStream());

    const result = (await service.completions({
      model: "m1",
      messages: [],
      stream: true,
      providerConfig: { id: "p1", type: "custom", protocol: "mock" },
    })) as AsyncGenerator<StreamChunk>;

    await expect(
      (async () => {
        for await (const _chunk of result) {
          // drain
        }
      })(),
    ).rejects.toThrow("boom");

    expect(usage.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorType: "Error",
        errorMessage: "boom",
      }),
    );
  });

  it("消费者提前 break 记为 cancelled", async () => {
    adapter.chatCompletion.mockReturnValue(streamChunks());

    const result = (await service.completions({
      model: "m1",
      messages: [],
      stream: true,
      providerConfig: { id: "p1", type: "custom", protocol: "mock" },
    })) as AsyncGenerator<StreamChunk>;

    for await (const _chunk of result) {
      break;
    }

    expect(usage.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});

async function* streamChunks(): AsyncGenerator<StreamChunk> {
  yield { type: "text_delta", index: 0, text: "hi" };
  yield {
    type: "usage",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
  yield { type: "finish", finishReason: "stop" };
}

async function* nonStreamChunks(): AsyncGenerator<StreamChunk> {
  yield {
    type: "block_end",
    index: 0,
    block: { type: "text", text: "hello" },
  };
  yield {
    type: "usage",
    usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
  };
  yield { type: "finish", finishReason: "stop" };
}

async function* failingStream(): AsyncGenerator<StreamChunk> {
  yield { type: "text_delta", index: 0, text: "partial" };
  throw new Error("boom");
}
