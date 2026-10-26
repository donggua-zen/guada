import { WebSearchPlugin } from "./web-search.plugin";
import { BochaProvider } from "./search-providers/bocha.provider";
import { TavilyProvider } from "./search-providers/tavily.provider";
import { MetasoProvider } from "./search-providers/metaso.provider";
import { DeepSeekProvider } from "./search-providers/deepseek.provider";
import { AgentHomeProvider } from "./search-providers/agenthome.provider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(impl: (url: string | URL, init: any) => Promise<Response>): jest.Mock {
  const mock = jest.fn(impl);
  global.fetch = mock as any;
  return mock;
}

/** 复用真实 Provider，替身只包住设置与模型供应商读取 */
async function createSearchTool(options: {
  searchSettings: Record<string, any>;
  modelProviders?: Array<{ type: string; enabled?: boolean; apiKey?: string }>;
  mcpClient?: any;
}) {
  const settingsStorage: any = {
    getSettings: jest.fn(async () => options.searchSettings),
  };
  const providerStore: any = {
    listProviders: jest.fn(() => options.modelProviders ?? []),
  };
  const mcpClient = options.mcpClient ?? {
    listTools: jest.fn(async () => ({})),
    callTool: jest.fn(async () => ({ success: false, error: "not used" })),
  };

  const plugin = new WebSearchPlugin(
    settingsStorage,
    new BochaProvider(),
    new MetasoProvider(),
    new TavilyProvider(),
    new DeepSeekProvider(),
    new AgentHomeProvider(mcpClient),
    providerStore,
  );

  const tools: Record<string, any> = {};
  const toolkit = {
    registerTool: (def: any) => {
      tools[def.name] = def;
    },
    registerPrompt: () => {},
  };
  const api: any = {
    registerNls: () => {},
    registerToolKit: (def: any) => {
      def.onLoad?.(toolkit);
      return toolkit;
    },
  };

  await plugin.onLoad(api);
  return tools;
}

describe("WebSearchPlugin × DeepSeek 模型侧 Key 复用", () => {
  it("勾选 useProviderKey 时使用模型服务中启用的 DeepSeek Key", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));
    const tools = await createSearchTool({
      searchSettings: { provider: "deepseek", deepseek: { apiKey: "", useProviderKey: true } },
      modelProviders: [
        { type: "openai", enabled: true, apiKey: "sk-openai" },
        { type: "deepseek", enabled: false, apiKey: "sk-disabled" },
        { type: "deepseek", enabled: true, apiKey: "sk-model" },
      ],
    });

    await tools.web_search.execute({ q: "hello", size: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(init.headers.Authorization).toBe("Bearer sk-model");
    expect(JSON.parse(init.body).count).toBe(3);
  });

  it("useProviderKey 优先于手动填写的 Key", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));
    const tools = await createSearchTool({
      searchSettings: {
        provider: "deepseek",
        deepseek: { apiKey: "sk-manual", useProviderKey: true },
      },
      modelProviders: [{ type: "deepseek", enabled: true, apiKey: "sk-model" }],
    });

    await tools.web_search.execute({ q: "hello" });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-model");
  });

  it("未勾选时使用手动填写的 Key", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));
    const tools = await createSearchTool({
      searchSettings: {
        provider: "deepseek",
        deepseek: { apiKey: "sk-manual", useProviderKey: false },
      },
      modelProviders: [{ type: "deepseek", enabled: true, apiKey: "sk-model" }],
    });

    await tools.web_search.execute({ q: "hello" });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-manual");
  });

  it("勾选但模型服务里没有 DeepSeek Key 时报错可行动作", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ results: [] }));
    const tools = await createSearchTool({
      searchSettings: { provider: "deepseek", deepseek: { useProviderKey: true } },
      modelProviders: [{ type: "openai", enabled: true, apiKey: "sk-openai" }],
    });

    await expect(tools.web_search.execute({ q: "hello" })).rejects.toThrow(
      /No DeepSeek API Key found in Models settings/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未勾选且 Key 为空时保持原有提示", async () => {
    const tools = await createSearchTool({
      searchSettings: { provider: "deepseek", deepseek: { apiKey: "" } },
      modelProviders: [{ type: "deepseek", enabled: true, apiKey: "sk-model" }],
    });

    await expect(tools.web_search.execute({ q: "hello" })).rejects.toThrow(
      /Please configure the DeepSeek API Key/,
    );
  });

  it("DeepSeek 供应商会注册 web_parser（Fetch 能力）", async () => {
    const tools = await createSearchTool({
      searchSettings: { provider: "deepseek", deepseek: { useProviderKey: true } },
      modelProviders: [{ type: "deepseek", enabled: true, apiKey: "sk-model" }],
    });

    expect(Object.keys(tools)).toEqual(["web_search", "web_parser"]);
  });
});

describe("WebSearchPlugin × AgentHome（MCP 上游）", () => {
  const searchText =
    "Found 1 result(s) · provider 0 · 10ms\n\n1. [Example](https://example.com)\n   snippet\n";

  function agentHomeMcp() {
    return {
      listTools: jest.fn(async () => ({})),
      callTool: jest.fn(async () => ({ success: true, content: searchText })),
    };
  }

  it("注册 web_search 与 web_parser，并通过 MCP 调用上游工具", async () => {
    const mcpClient = agentHomeMcp();
    const tools = await createSearchTool({
      searchSettings: { provider: "agenthome", agenthome: { apiKey: "sk-agent" } },
      mcpClient,
    });

    expect(Object.keys(tools)).toEqual(["web_search", "web_parser"]);

    const output = await tools.web_search.execute({ q: "hello", size: 3 });

    expect(output).toContain("https://example.com");
    expect(mcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://token.agenthome.cc/mcp/web-search",
        headers: { Authorization: "Bearer sk-agent" },
      }),
      "web_search",
      { query: "hello", max_results: 3 },
      { serverId: "builtin-search:agenthome" },
    );
  });

  it("未配置 Key 时提示到搜索设置里填写", async () => {
    const tools = await createSearchTool({
      searchSettings: { provider: "agenthome", agenthome: { apiKey: "" } },
      mcpClient: agentHomeMcp(),
    });

    await expect(tools.web_search.execute({ q: "hello" })).rejects.toThrow(
      /Please configure the AgentHome API Key/,
    );
  });
});
