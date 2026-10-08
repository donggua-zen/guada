import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// workspacePreview 会拖进 element-plus（node 环境不需要），只保留本组应用时要调的 setter
vi.mock("@/utils/workspacePreview", () => ({
  setLinkOpenMode: vi.fn(),
  setAutoShowSidebar: vi.fn(),
}));

// 切断 ApiService → locales → localStorage 导入链（node 环境无 localStorage）；
// 用 vi.hoisted 让 mock 函数在 resetModules 之后仍是同一个引用
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/services/ApiService", () => ({
  apiService: { fetchGroupSettings: fetchMock },
}));

import { extractBrowserSettings } from "./browserViewport";

/**
 * browser 分组加载测试
 *
 * 该分组（视口 + 链接打开方式 + 侧边栏自动展开）由启动流程一次拉取：
 * - extractBrowserSettings 是纯函数，脏值必须被丢弃，否则会写进
 *   browserWebview store 与 localStorage 缓存
 * - loadBrowserSettings 是幂等的单飞入口（设置页与启动加载共享同一次请求），
 *   失败不留缓存以便下次重试
 */
describe("extractBrowserSettings", () => {
  it("合法视口：取整后产出", () => {
    expect(
      extractBrowserSettings({ viewportWidth: 1366, viewportHeight: 768.4 }),
    ).toEqual({ viewport: { width: 1366, height: 768 } });
  });

  it("越界 / 非数值视口：不产出 viewport", () => {
    expect(extractBrowserSettings({ viewportWidth: 100, viewportHeight: 768 })).toEqual({});
    expect(extractBrowserSettings({ viewportWidth: 5000, viewportHeight: 768 })).toEqual({});
    expect(extractBrowserSettings({ viewportWidth: "wide", viewportHeight: null })).toEqual({});
    expect(extractBrowserSettings({ viewportWidth: 1280 })).toEqual({});
  });

  it("链接打开方式：仅接受三个枚举值", () => {
    expect(extractBrowserSettings({ linkOpenMode: "internal" })).toEqual({
      linkOpenMode: "internal",
    });
    expect(extractBrowserSettings({ linkOpenMode: "external" })).toEqual({
      linkOpenMode: "external",
    });
    expect(extractBrowserSettings({ linkOpenMode: "ask" })).toEqual({ linkOpenMode: "ask" });
    expect(extractBrowserSettings({ linkOpenMode: "new-tab" })).toEqual({});
    expect(extractBrowserSettings({ linkOpenMode: 1 })).toEqual({});
  });

  it("autoShowSidebar：仅接受 boolean", () => {
    expect(extractBrowserSettings({ autoShowSidebar: true })).toEqual({
      autoShowSidebar: true,
    });
    expect(extractBrowserSettings({ autoShowSidebar: false })).toEqual({
      autoShowSidebar: false,
    });
    expect(extractBrowserSettings({ autoShowSidebar: "true" })).toEqual({});
  });

  it("三项同时存在：一次产出；空/缺失响应：产出空对象", () => {
    expect(
      extractBrowserSettings({
        viewportWidth: 1920,
        viewportHeight: 1080,
        linkOpenMode: "internal",
        autoShowSidebar: true,
      }),
    ).toEqual({
      viewport: { width: 1920, height: 1080 },
      linkOpenMode: "internal",
      autoShowSidebar: true,
    });
    expect(extractBrowserSettings({})).toEqual({});
    expect(extractBrowserSettings(null)).toEqual({});
    expect(extractBrowserSettings(undefined)).toEqual({});
  });
});

describe("loadBrowserSettings", () => {
  beforeEach(() => {
    // 单飞状态在模块级：每个用例拿一份干净的模块实例
    vi.resetModules();
    setActivePinia(createPinia());
    fetchMock.mockReset();
  });

  it("并发/重复调用只发一次请求，并返回同一份归一化结果", async () => {
    const { loadBrowserSettings } = await import("./browserViewport");
    fetchMock.mockResolvedValue({
      viewportWidth: 1600,
      viewportHeight: 900,
      linkOpenMode: "internal",
    });

    const [first, second] = await Promise.all([
      loadBrowserSettings(),
      loadBrowserSettings(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      viewport: { width: 1600, height: 900 },
      linkOpenMode: "internal",
    });
    expect(second).toEqual(first);
  });

  it("请求失败：返回 null 且不留缓存，下次调用会重试", async () => {
    const { loadBrowserSettings } = await import("./browserViewport");
    fetchMock.mockRejectedValueOnce(new Error("backend down"));
    expect(await loadBrowserSettings()).toBeNull();

    fetchMock.mockResolvedValueOnce({ linkOpenMode: "external" });
    expect(await loadBrowserSettings()).toEqual({ linkOpenMode: "external" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
