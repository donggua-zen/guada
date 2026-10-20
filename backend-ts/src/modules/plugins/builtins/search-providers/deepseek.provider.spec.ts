import { DeepSeekProvider } from "./deepseek.provider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetch(impl: (url: string | URL, init: any) => Promise<Response>): jest.Mock {
  const mock = jest.fn(impl);
  global.fetch = mock as any;
  return mock;
}

function parseBody(init: any): any {
  return JSON.parse(init.body);
}

describe("DeepSeekProvider", () => {
  const provider = new DeepSeekProvider();

  describe("search", () => {
    it("映射请求字段：count / need_content / Bearer 鉴权", async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));

      await provider.search("deepseek 发布", { size: 5 }, "sk-test");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/v1/tools/search");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer sk-test");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(parseBody(init)).toEqual({
        query: "deepseek 发布",
        count: 5,
        need_content: true,
      });
    });

    it("count 夹在 1～50 之间（防御性）", async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));

      await provider.search("q", { size: 999 }, "sk-test");
      await provider.search("q", { size: 0 }, "sk-test");

      expect(parseBody(fetchMock.mock.calls[0][1]).count).toBe(50);
      expect(parseBody(fetchMock.mock.calls[1][1]).count).toBe(1);
    });

    it("映射响应字段：rerank_score / summary 优先 / date / content", async () => {
      stubFetch(async () =>
        jsonResponse({
          results: [
            {
              rerank_score: 2.4,
              title: "DeepSeek V4 发布",
              url: "https://example.com/a",
              snippet: "短摘要",
              summary: "长摘要",
              content: "正文",
              site_name: "Example",
              authority: 3,
              date: "2026-06-01T00:00:00+00:00",
            },
            {
              title: "无分数",
              url: "https://example.com/b",
              snippet: "仅有短摘要",
            },
          ],
        }),
      );

      const result = await provider.search("q", { size: 10 }, "sk-test");

      expect(result.total).toBe(2);
      expect(result.results[0]).toEqual({
        index: 1,
        title: "DeepSeek V4 发布",
        link: "https://example.com/a",
        score: "2.4",
        date: "2026-06-01T00:00:00+00:00",
        summary: "长摘要",
        content: "正文",
      });
      expect(result.results[1].score).toBe("unknown");
      expect(result.results[1].summary).toBe("仅有短摘要");
      expect(result.results[1].content).toBeUndefined();
    });

    it("空结果返回 total=0", async () => {
      stubFetch(async () => jsonResponse({ results: [] }));

      const result = await provider.search("q", { size: 10 }, "sk-test");

      expect(result).toEqual({ total: 0, results: [] });
    });

    it("超过 128 字符的 query 会被截断后再发出", async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));

      await provider.search("a".repeat(200), { size: 10 }, "sk-test");

      expect(parseBody(fetchMock.mock.calls[0][1]).query).toHaveLength(128);
    });

    it("正文超过 5000 字符会被截断", async () => {
      stubFetch(async () =>
        jsonResponse({
          results: [{ title: "t", url: "https://example.com", content: "x".repeat(6000) }],
        }),
      );

      const result = await provider.search("q", { size: 10 }, "sk-test");

      expect(result.results[0].content).toHaveLength(5000);
    });

    it("401 抛出可读错误且不重试", async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse(
          { error: { message: "Authentication Fails", type: "authentication_error", param: null, code: "invalid_api_key" } },
          401,
        ),
      );

      await expect(provider.search("q", { size: 10 }, "bad-key")).rejects.toThrow(
        /invalid API key.*Authentication Fails/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("429 后重试成功", async () => {
      jest.useFakeTimers();
      const fetchMock = stubFetch(async () => {
        if (fetchMock.mock.calls.length === 1) {
          return jsonResponse({ error: { message: "Too many requests" } }, 429, { "retry-after": "0" });
        }
        return jsonResponse({ results: [{ title: "ok", url: "https://example.com" }] });
      });

      const promise = provider.search("q", { size: 10 }, "sk-test");
      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result.results[0].title).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("402 余额不足给出可操作提示", async () => {
      stubFetch(async () => jsonResponse({ error: { message: "Insufficient Balance" } }, 402));

      await expect(provider.search("q", { size: 10 }, "sk-test")).rejects.toThrow(
        /insufficient balance.*Insufficient Balance/,
      );
    });
  });

  describe("readWebpage", () => {
    it("调用 Fetch 接口并返回 Markdown 正文", async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse({ title: "Example article", content: "# Example article\n\nBody." }),
      );

      const result = await provider.readWebpage("https://example.com/article", "markdown", "sk-test");

      expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/v1/tools/fetch");
      expect(parseBody(fetchMock.mock.calls[0][1])).toEqual({ url: "https://example.com/article" });
      expect(result).toContain("# Example article");
      expect(result).toContain("> Source: https://example.com/article");
      expect(result).toContain("Body.");
    });

    it("返回对象格式时携带 title/url/content", async () => {
      stubFetch(async () => jsonResponse({ title: "T", content: "C" }));

      const result = await provider.readWebpage("https://example.com/x", "text", "sk-test");

      expect(result).toEqual({ title: "T", url: "https://example.com/x", content: "C" });
    });

    it("正文为空时返回可读兜底文案", async () => {
      stubFetch(async () => jsonResponse({ title: "", content: "" }));

      const result = await provider.readWebpage("https://example.com/empty", "markdown", "sk-test");

      expect(result).toBe("No content found for the given URL");
    });

    it("403 说明被安全策略拒绝且不重试", async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse({ error: { message: "blocked" } }, 403),
      );

      await expect(
        provider.readWebpage("https://example.com/private", "markdown", "sk-test"),
      ).rejects.toThrow(/safety policy.*blocked/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
