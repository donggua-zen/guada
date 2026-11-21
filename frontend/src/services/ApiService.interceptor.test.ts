/**
 * ApiService JSON 响应兜底防线测试
 *
 * 背景:移动端拿到 2xx 但 body 不是 JSON 的响应(网络中间层注入 HTML / 半开连接上的
 * 截断响应)时,axios 默认 transformResponse 会静默把原始字符串当解析结果返回,业务代码
 * 解构报 "Se.events is not iterable" 且无诊断信息。本防线:
 * - parseJsonBody:解析失败返回标记对象(带 body 摘要),空 body 归一为 null
 * - 响应拦截器:命中标记 → reject ApiError(message 含摘要);空 body → null
 *   (不再回落整个 AxiosResponse 对象)
 *
 * fake adapter 替换 axiosInstance.defaults.adapter,让请求流经真实的
 * transformResponse + 响应拦截器,端到端验证三态。
 */
import { describe, it, expect, vi } from "vitest";

// ApiService 实例在 import 时即构造(shouldEnableMock 读 localStorage),而 vitest node
// 环境的 localStorage 全局不完整(getItem 非函数)——先 stub 再动态 import。
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

const { apiService, parseJsonBody } = await import("./ApiService");

type AxiosLike = {
  axiosInstance: { defaults: { adapter: unknown } };
};

/** 替换为 fake adapter:绕过网络,直接返回指定原始 body(仍走真实解析+拦截器链) */
function setFakeAdapter(data: unknown, status = 200): void {
  const instance = (apiService as unknown as AxiosLike).axiosInstance;
  instance.defaults.adapter = async () => ({
    data,
    status,
    statusText: "OK",
    headers: {},
    config: {} as never,
  });
}

describe("parseJsonBody(JSON body 解析器)", () => {
  it("有效 JSON 字符串 → 解析为对象", () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonBody("  [1,2] ")).toEqual([1, 2]);
  });

  it("非 JSON 文本 → 标记对象(不再静默降级为原始字符串)", () => {
    const page = parseJsonBody("<html>portal injected</html>") as {
      __invalidJson: boolean;
      snippet: string;
    };
    expect(page.__invalidJson).toBe(true);
    expect(page.snippet).toContain("portal injected");
  });

  it("空 body → null", () => {
    expect(parseJsonBody("")).toBeNull();
    expect(parseJsonBody("   \n")).toBeNull();
  });

  it("非字符串(二进制/已解析) → 原样返回", () => {
    const blob = { size: 1 };
    expect(parseJsonBody(blob)).toBe(blob);
    expect(parseJsonBody(null)).toBeNull();
  });
});

describe("响应拦截器兜底(fake adapter 端到端)", () => {
  it("200 + HTML 注入 → reject ApiError,message 含 body 摘要", async () => {
    setFakeAdapter("<html>gateway page</html>");
    await expect(
      (apiService as unknown as { _request: (u: string) => Promise<unknown> })._request("/x"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("gateway page"),
    });
  });

  it("200 + 空 body → 返回 null(不再回落整个 AxiosResponse)", async () => {
    setFakeAdapter("");
    await expect(
      (apiService as unknown as { _request: (u: string) => Promise<unknown> })._request("/x"),
    ).resolves.toBeNull();
  });

  it("200 + 正常 JSON → 解析为对象(原行为不回归)", async () => {
    setFakeAdapter(JSON.stringify({ events: [], hasMore: false }));
    await expect(
      (apiService as unknown as { _request: (u: string) => Promise<unknown> })._request("/x"),
    ).resolves.toEqual({ events: [], hasMore: false });
  });

  it("截断 JSON(半开连接常见)→ reject 且摘要含截断片段", async () => {
    setFakeAdapter('{"events":[{"id":"t1","content":"截断"]');
    await expect(
      (apiService as unknown as { _request: (u: string) => Promise<unknown> })._request("/x"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("截断"),
    });
  });

  it("诊断 console.error 记录非 JSON 响应体", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      setFakeAdapter("<html>x</html>");
      await (
        apiService as unknown as { _request: (u: string) => Promise<unknown> }
      )._request("/x").catch(() => {});
      expect(errSpy).toHaveBeenCalledWith(
        "API 返回非 JSON 响应体:",
        expect.stringContaining("<html>x</html>"),
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});
