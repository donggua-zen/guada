import { PluginLlmService, toMessages } from "./plugin-llm.service";

/**
 * 用替身构造 service：`LLMService` 与 `ProviderFileStore` 都是外部依赖，
 * 单测只关心"模型解析 + message 转换 + chunk 归一化"这三段逻辑。
 */
function makeService(options: {
  models?: any[];
  chunks?: any[];
  failWith?: Error;
} = {}) {
  const models = options.models ?? [
    {
      id: "m1",
      modelName: "gpt-test",
      provider: { id: "prov1", name: "Provider 1", type: "openai", protocol: "openai" },
      config: { contextWindow: 8000, maxOutputTokens: 1024, features: ["text"] },
    },
  ];
  const providerStore = {
    findModel: (id: string) => models.find((m) => m.id === id),
    listModels: () => models,
  };
  const calls: any[] = [];
  const llm = {
    completions: async (params: any) => {
      calls.push(params);
      if (options.failWith) throw options.failWith;
      // 非流式：LLMService 直接返回结果对象
      if (!params.stream) {
        return {
          content: options.chunks
            ? options.chunks
                .filter((c: any) => c.type === "text_delta")
                .map((c: any) => c.text)
                .join("")
            : "hello world",
          usage: { promptTokens: 3, completionTokens: 2 },
          finishReason: "stop",
        };
      }
      const chunks = options.chunks ?? [
        { type: "text_delta", text: "hello" },
        { type: "text_delta", text: " world" },
        { type: "finish", finishReason: "stop" },
      ];
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
  return { service: new PluginLlmService(llm as any, providerStore as any), calls };
}

describe("PluginLlmService", () => {
  it("lists configured models", async () => {
    const { service } = makeService();
    const models = await service.listModels();
    expect(models).toEqual([
      expect.objectContaining({
        id: "m1",
        name: "gpt-test",
        providerId: "prov1",
        providerName: "Provider 1",
        contextWindow: 8000,
      }),
    ]);
  });

  it("completes with the explicit model and accumulates text", async () => {
    const { service, calls } = makeService();
    const result = await service.complete("p1", { modelId: "m1", prompt: "hi" });
    expect(result.text).toBe("hello world");
    expect(result.model).toBe("gpt-test");
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
    expect(calls[0].purpose).toBe("plugin:p1");
    expect(calls[0].model).toBe("gpt-test");
    expect(calls[0].stream).toBe(false);
  });

  it("falls back to the first model when modelId is absent", async () => {
    const { service, calls } = makeService();
    await service.complete("p1", { prompt: "hi" });
    expect(calls[0].model).toBe("gpt-test");
  });

  it("rejects an unknown model id instead of silently switching", async () => {
    const { service } = makeService();
    await expect(service.complete("p1", { modelId: "nope", prompt: "hi" })).rejects.toThrow(
      /not configured/,
    );
  });

  it("rejects when no model is configured", async () => {
    const { service } = makeService({ models: [] });
    await expect(service.complete("p1", { prompt: "hi" })).rejects.toThrow(
      /no model configured/,
    );
  });

  it("streams normalized chunks", async () => {
    const { service } = makeService({
      chunks: [
        { type: "reasoning_delta", text: "think" },
        { type: "text_delta", text: "a" },
        { type: "text_delta", text: "b" },
        { type: "finish", finishReason: "stop" },
      ],
    });
    const out: any[] = [];
    for await (const chunk of service.completeStream("p1", { prompt: "hi" })) out.push(chunk);
    expect(out).toEqual([
      { type: "reasoning", text: "think" },
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("surfaces upstream errors", async () => {
    const { service } = makeService({ failWith: new Error("rate limited") });
    await expect(service.complete("p1", { prompt: "hi" })).rejects.toThrow("rate limited");
  });

  it("reports a clear error when the host has no LLM service", async () => {
    const service = new PluginLlmService(undefined, {
      findModel: () => undefined,
      listModels: () => [],
    } as any);
    await expect(service.complete("p1", { prompt: "hi" })).rejects.toThrow(
      /no model configured|not available/,
    );
  });
});

describe("toMessages", () => {
  it("converts role/content pairs and appends prompt", () => {
    const messages = toMessages({
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
      prompt: "c",
    });
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("user");
    expect((messages[0].content as any[])[0].text).toBe("a");
    expect((messages[2].content as any[])[0].text).toBe("c");
  });

  it("drops invalid items", () => {
    const messages = toMessages({
      messages: [{ role: "system" as any, content: "x" }, { role: "user", content: "ok" }],
    });
    expect(messages).toHaveLength(1);
  });

  it("requires at least one message", () => {
    expect(() => toMessages({})).toThrow(/prompt or messages is required/);
  });
});
