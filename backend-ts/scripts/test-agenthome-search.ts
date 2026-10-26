/**
 * 手工实测：AgentHome MCP 搜索端点（web_search / web_fetch）
 *
 * 用法（backend-ts 目录）：
 *   AGENTHOME_API_KEY=sk-xxx npx ts-node --transpile-only scripts/test-agenthome-search.ts [query] [url]
 *
 * 只读：打印 tools/list 的 schema 与两次真实调用的原始结果，不修改任何配置。
 */
import "reflect-metadata";
import { McpConnectionManager } from "../src/common/mcp/mcp-connection-manager.service";
import { McpClientService } from "../src/common/mcp/mcp-client.service";
import { McpServerConfig } from "../src/common/mcp/mcp.types";
import { AgentHomeProvider } from "../src/modules/plugins/builtins/search-providers/agenthome.provider";
import { WebSearchPlugin } from "../src/modules/plugins/builtins/web-search.plugin";
import { BochaProvider } from "../src/modules/plugins/builtins/search-providers/bocha.provider";
import { MetasoProvider } from "../src/modules/plugins/builtins/search-providers/metaso.provider";
import { TavilyProvider } from "../src/modules/plugins/builtins/search-providers/tavily.provider";
import { DeepSeekProvider } from "../src/modules/plugins/builtins/search-providers/deepseek.provider";

const URL = "https://token.agenthome.cc/mcp/web-search";
const QUERY = process.argv[2] || "NestJS 最新版本";
const FETCH_URL = process.argv[3] || "https://example.com";

function mask(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

function config(apiKey: string): McpServerConfig {
  return {
    type: "streamableHttp",
    url: URL,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

async function main() {
  const apiKey = (process.env.AGENTHOME_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("缺少 AGENTHOME_API_KEY 环境变量");
  }
  console.log("== 配置 ==");
  console.log(`url: ${URL}`);
  console.log(`key: ${mask(apiKey)}`);

  const connections = new McpConnectionManager();
  const client = new McpClientService(connections);

  console.log("\n== 1. tools/list ==");
  const tools = await client.listTools(config(apiKey), { serverId: "probe:agenthome" });
  console.log(JSON.stringify(tools, null, 2));

  console.log("\n== 2. web_search 原始返回 ==");
  const searchRaw = await client.callTool(
    config(apiKey),
    "web_search",
    { query: QUERY, max_results: 3 },
    { serverId: "probe:agenthome" },
  );
  console.log(JSON.stringify(searchRaw, null, 2));

  console.log("\n== 3. web_fetch 原始返回 ==");
  const fetchRaw = await client.callTool(
    config(apiKey),
    "web_fetch",
    { url: FETCH_URL },
    { serverId: "probe:agenthome" },
  );
  console.log(JSON.stringify(fetchRaw, null, 2));

  console.log("\n== 4. Provider 归一化结果 ==");
  const provider = new AgentHomeProvider(client);
  console.log("capabilities:", JSON.stringify(provider.capabilities));
  const search = await provider.search(QUERY, { size: 3 }, apiKey);
  console.log(JSON.stringify(search, null, 2));
  const page = await provider.readWebpage(FETCH_URL, "markdown", apiKey);
  console.log(typeof page === "string" ? page.slice(0, 800) : JSON.stringify(page, null, 2));

  console.log("\n== 5. 插件全链路（settings: agenthome）==");
  const settingsStorage: any = {
    getSettings: async () => ({
      provider: "agenthome",
      agenthome: { apiKey },
    }),
  };
  const providerStore: any = { listProviders: () => [] };
  const plugin = new WebSearchPlugin(
    settingsStorage,
    new BochaProvider(),
    new MetasoProvider(),
    new TavilyProvider(),
    new DeepSeekProvider(),
    provider,
    providerStore,
  );

  const pluginTools: Record<string, any> = {};
  const toolkit = {
    registerTool: (def: any) => {
      pluginTools[def.name] = def;
    },
    registerPrompt: () => {},
  };
  await plugin.onLoad({
    registerNls: () => {},
    registerToolKit: (def: any) => {
      def.onLoad?.(toolkit);
      return toolkit;
    },
  } as any);

  console.log(`注册工具: ${Object.keys(pluginTools).join(", ")}`);
  console.log(await pluginTools.web_search.execute({ q: QUERY, size: 2 }));
  const parserOutput = await pluginTools.web_parser.execute({ url: FETCH_URL });
  console.log(parserOutput.slice(0, 400));

  await connections.shutdown();
  console.log("\n✅ 实测完成");
}

main().catch((error) => {
  console.error("\n❌ 实测失败:", error?.message || error);
  process.exitCode = 1;
});
