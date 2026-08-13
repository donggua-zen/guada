import { Test, TestingModule } from "@nestjs/testing";
import OpenAI from "openai";
import { EmbeddingService, isRetryableEmbeddingError } from "./embedding.service";

// ── Mock retryWithBackoff：模拟真实重试逻辑（无延迟，简化测试）──
jest.mock("../llm-core/utils/retry.util", () => ({
  retryWithBackoff: jest.fn(async <T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; shouldRetry?: (error: any) => boolean },
  ): Promise<T> => {
    const maxRetries = options.maxRetries ?? 0;
    const shouldRetry = options.shouldRetry ?? (() => false);
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error)) throw error;
      }
    }
    throw lastError;
  }),
}));

// ── Mock OpenAI SDK ──
jest.mock("openai", () => {
  class MockAPIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "APIConnectionError";
    }
  }
  class MockAPIConnectionTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "APIConnectionTimeoutError";
    }
  }

  const mockOpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn(),
    },
  }));

  return {
    __esModule: true,
    default: mockOpenAI,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  };
});

const mockOpenAIClient = OpenAI as unknown as jest.Mock;

/** 构造 OpenAI 响应对象 */
function makeResponse(embeddings: number[][]) {
  return {
    data: embeddings.map((val, idx) => ({ index: idx, embedding: val })),
  };
}

/** 获取当前 OpenAI 实例的 embeddings.create mock */
function createMock() {
  const instance = mockOpenAIClient.mock.instances[
    mockOpenAIClient.mock.instances.length - 1
  ] as any;
  return instance?.embeddings?.create as jest.Mock | undefined;
}

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmbeddingService],
    }).compile();
    service = module.get<EmbeddingService>(EmbeddingService);
  });

  // ── 基本功能 ──

  it("空输入返回空数组", async () => {
    const result = await service.getEmbeddings([], "u", "k", "m");
    expect(result).toEqual([]);
    expect(mockOpenAIClient).not.toHaveBeenCalled();
  });

  it("批量成功后返回按序排列的向量", async () => {
    createMock()!.mockResolvedValueOnce(
      makeResponse([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]),
    );

    const result = await service.getEmbeddings(
      ["a", "b", "c"],
      "https://api.example.com",
      "key-123",
      "text-embedding-v3",
    );

    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);
    expect(createMock()!).toHaveBeenCalledTimes(1);
    expect(createMock()!.mock.calls[0][0]).toMatchObject({
      model: "text-embedding-v3",
      input: ["a", "b", "c"],
    });
  });

  it("超过 BATCH_SIZE(10) 时分批处理", async () => {
    createMock()!
      .mockResolvedValueOnce(makeResponse(Array.from({ length: 10 }, (_, i) => [i])))
      .mockResolvedValueOnce(makeResponse([[10], [11]]));

    const texts = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const result = await service.getEmbeddings(texts, "u", "k", "m");

    expect(result).toHaveLength(12);
    expect(createMock()!).toHaveBeenCalledTimes(2);
    expect(createMock()!.mock.calls[0][0].input).toHaveLength(10);
    expect(createMock()!.mock.calls[1][0].input).toHaveLength(2);
  });

  it("进度回调按批次触发", async () => {
    createMock()!
      .mockResolvedValueOnce(makeResponse([[1], [2]]))
      .mockResolvedValueOnce(makeResponse([[3]]));

    const events: Array<[number, number]> = [];
    await service.getEmbeddings(["a", "b", "c"], "u", "k", "m", (c, t) => {
      events.push([c, t]);
    });

    expect(events).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  // ── 重试逻辑 ──

  it("可重试错误（网络抖动）重试后成功", async () => {
    // 首次调用失败，重试后成功
    createMock()!
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(makeResponse([[0.1], [0.2]]));

    const result = await service.getEmbeddings(["a", "b"], "u", "k", "m");
    expect(result).toEqual([[0.1], [0.2]]);
    // 共调用 2 次（1 次失败 + 1 次成功）
    expect(createMock()!).toHaveBeenCalledTimes(2);
  });

  it("429 限流重试后成功", async () => {
    const rateLimit = Object.assign(new Error("rate limit"), { status: 429 });
    createMock()!
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce(makeResponse([[0.1]]));

    const result = await service.getEmbeddings(["a"], "u", "k", "m");
    expect(result).toEqual([[0.1]]);
    expect(createMock()!).toHaveBeenCalledTimes(2);
  });

  // ── 降级逻辑 ──

  it("批量持续失败（可重试错误耗尽）后降级为逐条请求", async () => {
    // 用计数器模拟：批量重试 4 次（1 初始 + 3 重试）全部失败 → 逐条请求成功
    let callIdx = 0;
    createMock()!.mockImplementation(() => {
      callIdx++;
      if (callIdx <= 4) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(makeResponse([[0.1]]));
    });

    const result = await service.getEmbeddings(["a", "b"], "u", "k", "m");
    expect(result).toEqual([[0.1], [0.1]]);
    // 4 次批量 + 2 次逐条 = 6 次
    expect(createMock()!).toHaveBeenCalledTimes(6);
  });

  it("不可重试错误（4xx）批量失败后降级，逐条也失败时抛出汇总错误", async () => {
    const badRequest = Object.assign(new Error("invalid request"), { status: 400 });
    createMock()!.mockRejectedValue(badRequest);

    await expect(
      service.getEmbeddings(["a", "b"], "u", "k", "m"),
    ).rejects.toThrow(/降级后逐条向量化全部失败/);
  });

  it("降级后逐条部分成功时返回成功的向量", async () => {
    let callIdx = 0;
    createMock()!.mockImplementation(() => {
      callIdx++;
      if (callIdx <= 4) return Promise.reject(new Error("ECONNRESET")); // 批量耗尽
      if (callIdx === 5) return Promise.resolve(makeResponse([[0.1]])); // 逐条1成功
      return Promise.reject( // 逐条2失败（不可重试）
        Object.assign(new Error("invalid api key"), { status: 401 }),
      );
    });

    const result = await service.getEmbeddings(["a", "b"], "u", "k", "m");
    expect(result).toEqual([[0.1]]);
  });

  // ── 单条接口 ──

  it("getEmbedding 返回单个向量", async () => {
    createMock()!.mockResolvedValueOnce(makeResponse([[0.42]]));
    const result = await service.getEmbedding("hello", "u", "k", "m");
    expect(result).toEqual([0.42]);
  });
});

// ── isRetryableEmbeddingError 纯函数测试 ──

describe("isRetryableEmbeddingError", () => {
  it("429 限流 → 可重试", () => {
    expect(isRetryableEmbeddingError({ status: 429 })).toBe(true);
  });

  it("5xx 服务器错误 → 可重试", () => {
    expect(isRetryableEmbeddingError({ status: 500 })).toBe(true);
    expect(isRetryableEmbeddingError({ statusCode: 503 })).toBe(true);
    expect(isRetryableEmbeddingError({ code: 502 })).toBe(true);
  });

  it("4xx 客户端错误 → 不可重试", () => {
    expect(isRetryableEmbeddingError({ status: 400 })).toBe(false);
    expect(isRetryableEmbeddingError({ status: 401 })).toBe(false);
    expect(isRetryableEmbeddingError({ status: 403 })).toBe(false);
    expect(isRetryableEmbeddingError({ status: 404 })).toBe(false);
  });

  it("APIConnectionError → 可重试", () => {
    // openai v6+ APIConnectionError 构造函数签名：{ message?, cause? }
    const err = new OpenAI.APIConnectionError({ message: "connection lost" });
    expect(isRetryableEmbeddingError(err)).toBe(true);
  });

  it("网络/超时错误关键词 → 可重试", () => {
    expect(isRetryableEmbeddingError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableEmbeddingError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableEmbeddingError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableEmbeddingError(new Error("timeout"))).toBe(true);
    expect(isRetryableEmbeddingError(new Error("connection lost"))).toBe(true);
  });

  it("其他错误 / 空值 → 不可重试", () => {
    expect(isRetryableEmbeddingError(null)).toBe(false);
    expect(isRetryableEmbeddingError(undefined)).toBe(false);
    expect(isRetryableEmbeddingError(new Error("something else"))).toBe(false);
    expect(isRetryableEmbeddingError({})).toBe(false);
  });
});