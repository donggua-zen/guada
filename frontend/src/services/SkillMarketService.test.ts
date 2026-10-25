import { describe, it, expect, beforeEach, vi } from "vitest";

// 只桩掉 axios：node 测试环境无网络；localStorage 由 happy-dom 环境提供
// （vitest 配置沿用项目现有 environment，若无 DOM 则在 beforeEach 里注入内存实现）。
const axiosMocks = vi.hoisted(() => {
  const get = vi.fn();
  return {
    get,
    create: vi.fn(() => ({ get })),
    isAxiosError: vi.fn((v: unknown) => !!v && typeof v === "object" && "isAxiosError" in v),
  };
});
vi.mock("axios", () => ({ default: axiosMocks, ...axiosMocks }));

import { SkillMarketService, localeToMarketLang } from "./SkillMarketService";
import type { SkillListResponse } from "./SkillMarketService";

// node 环境兜底：模块代码直接读写 localStorage。Node 23+ 自带实验性实现（缺 clear
// 且依赖 --localstorage-file），统一用内存实现覆盖，行为可控。
{
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
}

const zhResponse = (overrides: Partial<SkillListResponse> = {}): SkillListResponse => ({
  lang: "zh",
  requestedLang: "zh",
  items: [
    {
      id: "xlsx",
      name: "Excel 表格处理",
      description: "创建、编辑、分析 Excel 表格。",
      lang: "zh",
      requestedLang: "zh",
      labels: [{ id: "data-analysis", name: "数据分析", lang: "zh" }],
      icon: null,
      installUrls: [{ type: "zip", url: "https://ai.dingd.cn/downloads/skills/xlsx/xlsx.zip" }],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  axiosMocks.get.mockReset();
});

describe("localeToMarketLang", () => {
  it("zh-CN → zh", () => {
    expect(localeToMarketLang("zh-CN")).toBe("zh");
  });

  it("en-US → en", () => {
    expect(localeToMarketLang("en-US")).toBe("en");
  });

  it("未知语言兜底为 zh", () => {
    expect(localeToMarketLang("fr-FR")).toBe("zh");
  });
});

describe("SkillMarketService.fetchMarketSkills", () => {
  it("调用 v2 接口并携带 limit 与 lang，解 items 信封", async () => {
    axiosMocks.get.mockResolvedValue({ data: zhResponse() });

    const items = await SkillMarketService.fetchMarketSkills("en");

    expect(axiosMocks.get).toHaveBeenCalledWith("/api/v2/market/skills", {
      params: { limit: 12, lang: "en" },
    });
    expect(items).toHaveLength(1);
    // labels 透传为对象数组（v2 字段形态）
    expect(items[0].labels[0]).toMatchObject({ id: "data-analysis", name: "数据分析" });
  });

  it("命中同语言缓存时不发请求", async () => {
    axiosMocks.get.mockResolvedValue({ data: zhResponse() });

    await SkillMarketService.fetchMarketSkills("zh");
    await SkillMarketService.fetchMarketSkills("zh");

    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });

  it("缓存按语言隔离：en 请求不会命中 zh 缓存", async () => {
    axiosMocks.get.mockResolvedValue({ data: zhResponse() });
    await SkillMarketService.fetchMarketSkills("zh");

    axiosMocks.get.mockResolvedValue({
      data: zhResponse({ lang: "en", requestedLang: "en", items: [] }),
    });
    const enItems = await SkillMarketService.fetchMarketSkills("en");

    expect(axiosMocks.get).toHaveBeenCalledTimes(2);
    expect(enItems).toEqual([]);
  });

  it("响应缺 items 时兜底为空数组", async () => {
    axiosMocks.get.mockResolvedValue({ data: { lang: "zh", requestedLang: "zh" } });

    const items = await SkillMarketService.fetchMarketSkills("zh");
    expect(items).toEqual([]);
  });

  it("提取 v2 嵌套错误 { error: { message } }", async () => {
    axiosMocks.get.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 500",
      response: {
        status: 500,
        data: { error: { code: "INTERNAL_ERROR", message: "boom" } },
      },
    });

    await expect(SkillMarketService.fetchMarketSkills("zh")).rejects.toThrow("boom");
  });

  it("非 AxiosError 原样转为 Error", async () => {
    axiosMocks.get.mockRejectedValue(new Error("network down"));

    await expect(SkillMarketService.fetchMarketSkills("zh")).rejects.toThrow("network down");
  });
});

describe("SkillMarketService.fetchMarketLabels", () => {
  // labelMemo 是模块级缓存，每个用例重置模块拿到干净实例（vi.mock 对动态导入依然生效）
  let fresh: typeof import("./SkillMarketService").SkillMarketService;
  beforeEach(async () => {
    vi.resetModules();
    ({ SkillMarketService: fresh } = await import("./SkillMarketService"));
  });

  it("请求 labels 端点并携带 lang，返回 items", async () => {
    axiosMocks.get.mockResolvedValue({
      data: {
        lang: "en",
        requestedLang: "en",
        items: [{ id: "development", name: "Development", nameI18n: { zh: "编程开发", en: "Development" } }],
      },
    });

    const labels = await fresh.fetchMarketLabels("en");

    expect(axiosMocks.get).toHaveBeenCalledWith("/api/v2/market/labels", { params: { lang: "en" } });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: "development", name: "Development" });
  });

  it("同语言命中内存缓存，不发第二次请求", async () => {
    axiosMocks.get.mockResolvedValue({ data: { items: [{ id: "ai", name: "AI", nameI18n: {} }] } });

    await fresh.fetchMarketLabels("zh");
    await fresh.fetchMarketLabels("zh");

    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });

  it("响应缺 items 时兜底为空数组并缓存", async () => {
    axiosMocks.get.mockResolvedValue({ data: {} });

    const labels = await fresh.fetchMarketLabels("en");
    expect(labels).toEqual([]);

    await fresh.fetchMarketLabels("en");
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });
});

describe("SkillMarketService.fetchMarketList", () => {
  it("请求 list 端点并透传分页/关键词/标签参数，解 items 与 pagination", async () => {
    axiosMocks.get.mockResolvedValue({
      data: {
        lang: "zh",
        requestedLang: "zh",
        items: zhResponse().items,
        pagination: { page: 2, pageSize: 12, total: 58, totalPages: 5 },
      },
    });

    const res = await SkillMarketService.fetchMarketList({
      page: 2,
      pageSize: 12,
      keyword: "chat",
      labelId: "development",
      lang: "zh",
    });

    expect(axiosMocks.get).toHaveBeenCalledWith("/api/v2/market/list", {
      params: { page: 2, pageSize: 12, keyword: "chat", labelId: "development", lang: "zh" },
    });
    expect(res.items).toHaveLength(1);
    expect(res.pagination).toEqual({ page: 2, pageSize: 12, total: 58, totalPages: 5 });
  });

  it("缺省 keyword/labelId 时不传对应参数", async () => {
    axiosMocks.get.mockResolvedValue({
      data: {
        lang: "zh",
        requestedLang: "zh",
        items: [],
        pagination: { page: 1, pageSize: 12, total: 0, totalPages: 1 },
      },
    });

    await SkillMarketService.fetchMarketList({ page: 1, pageSize: 12, lang: "zh" });

    expect(axiosMocks.get).toHaveBeenCalledWith("/api/v2/market/list", {
      params: { page: 1, pageSize: 12, keyword: undefined, labelId: undefined, lang: "zh" },
    });
  });

  it("pagination 缺失时兜底为单页空结果", async () => {
    axiosMocks.get.mockResolvedValue({ data: { lang: "zh", requestedLang: "zh", items: [] } });

    const res = await SkillMarketService.fetchMarketList({ page: 1, pageSize: 12, lang: "zh" });
    expect(res.pagination).toEqual({ page: 1, pageSize: 0, total: 0, totalPages: 1 });
  });
});
