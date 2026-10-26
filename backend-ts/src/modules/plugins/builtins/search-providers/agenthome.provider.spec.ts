import { AgentHomeProvider } from "./agenthome.provider";

const SEARCH_TEXT = [
  "Found 2 result(s) · provider 1 · 914ms",
  "",
  "1. [First Title](https://a.example.com)",
  "   first snippet line",
  "second line",
  "2. [Second Title](https://b.example.com)",
  "   second snippet",
  "",
].join("\n");

const FETCH_TEXT = [
  "# Example Domain",
  "URL: https://example.com",
  "Content-Type: text/markdown · 1370 chars",
  "",
  "**标题**: Example Domain",
  "",
  "Body content here.",
].join("\n");

function createProvider(options: { callTool?: jest.Mock } = {}) {
  const mcpClient: any = {
    listTools: jest.fn(),
    callTool:
      options.callTool ??
      jest.fn(async () => ({ success: true, content: SEARCH_TEXT })),
  };
  return { provider: new AgentHomeProvider(mcpClient), mcpClient };
}

describe("AgentHomeProvider", () => {
  it("解析 web_search 纯文本结果（含跨行摘要）", async () => {
    const { provider, mcpClient } = createProvider();

    const response = await provider.search("hello", { size: 3 }, "sk-test");

    expect(mcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "streamableHttp",
        url: "https://token.agenthome.cc/mcp/web-search",
        headers: { Authorization: "Bearer sk-test" },
      }),
      "web_search",
      { query: "hello", max_results: 3 },
      { serverId: "builtin-search:agenthome" },
    );

    expect(response.total).toBe(2);
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual({
      index: 1,
      title: "First Title",
      link: "https://a.example.com",
      score: "unknown",
      summary: "first snippet line\nsecond line",
    });
    expect(response.results[1]).toEqual({
      index: 2,
      title: "Second Title",
      link: "https://b.example.com",
      score: "unknown",
      summary: "second snippet",
    });
  });

  it("size 按上游 1～10 的范围夹取", async () => {
    const { provider, mcpClient } = createProvider();

    await provider.search("hello", { size: 50 }, "sk-test");
    await provider.search("hello", { size: 0 }, "sk-test");

    expect(mcpClient.callTool.mock.calls[0][2].max_results).toBe(10);
    expect(mcpClient.callTool.mock.calls[1][2].max_results).toBe(1);
  });

  it("Key 已带 Bearer 前缀时不会重复拼接", async () => {
    const { provider, mcpClient } = createProvider();

    await provider.search("hello", { size: 1 }, "Bearer sk-test");

    expect(mcpClient.callTool.mock.calls[0][0].headers.Authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("Key 为空时给出可行动的报错", async () => {
    const { provider } = createProvider();

    await expect(provider.search("hello", { size: 1 }, "  ")).rejects.toThrow(
      /AgentHome API Key is not configured/,
    );
  });

  it("上游返回 success=false 时抛错，避免把错误文本当搜索结果", async () => {
    const { provider } = createProvider({
      callTool: jest.fn(async () => ({
        success: false,
        error: "无效或已禁用的 API Key",
      })),
    });

    await expect(provider.search("hello", { size: 1 }, "sk-test")).rejects.toThrow(
      /AgentHome search failed: 无效或已禁用的 API Key/,
    );
  });

  it("web_fetch 的 Markdown 结果直接透传", async () => {
    const { provider, mcpClient } = createProvider({
      callTool: jest.fn(async () => ({ success: true, content: FETCH_TEXT })),
    });

    const result = await provider.readWebpage(
      "https://example.com",
      "markdown",
      "sk-test",
    );

    expect(mcpClient.callTool.mock.calls[0][1]).toBe("web_fetch");
    expect(mcpClient.callTool.mock.calls[0][2]).toEqual({
      url: "https://example.com",
      max_length: 50000,
    });
    expect(result).toBe(FETCH_TEXT);
  });

  it("非 Markdown 格式时解析为 ParseResponse", async () => {
    const { provider } = createProvider({
      callTool: jest.fn(async () => ({ success: true, content: FETCH_TEXT })),
    });

    const result = await provider.readWebpage(
      "https://example.com",
      "json",
      "sk-test",
    );

    expect(result).toEqual({
      title: "Example Domain",
      url: "https://example.com",
      content: "**标题**: Example Domain\n\nBody content here.",
    });
  });

  it("web_fetch 返回空内容时给出提示", async () => {
    const { provider } = createProvider({
      callTool: jest.fn(async () => ({ success: true, content: "  " })),
    });

    await expect(
      provider.readWebpage("https://example.com", "markdown", "sk-test"),
    ).resolves.toBe("No content found for the given URL");
  });

  it("能力声明：搜索只返回摘要，支持网页提取", () => {
    const { provider } = createProvider();

    expect(provider.capabilities).toEqual({
      scope: { supported: false },
      searchReturnsContent: false,
      supportsWebpageExtract: true,
      scoreType: "string",
    });
  });
});
