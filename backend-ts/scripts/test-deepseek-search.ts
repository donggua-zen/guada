/**
 * 手工实测：DeepSeek Search / Fetch 真实链路
 *
 * 用法（backend-ts 目录）：
 *   npx ts-node --transpile-only scripts/test-deepseek-search.ts
 *
 * Key 来源：PROVIDERS_DIR / USERDATA_DIR/providers / ~/.guada/providers / ./data/providers
 * 中第一个含 `type: deepseek` 且带 apiKey 的供应商 yaml。
 * 本脚本只打印掩码 Key，不落盘、不修改任何配置。
 */
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import { DeepSeekProvider } from "../src/modules/plugins/builtins/search-providers/deepseek.provider";
import { WebSearchPlugin } from "../src/modules/plugins/builtins/web-search.plugin";
import { BochaProvider } from "../src/modules/plugins/builtins/search-providers/bocha.provider";
import { MetasoProvider } from "../src/modules/plugins/builtins/search-providers/metaso.provider";
import { TavilyProvider } from "../src/modules/plugins/builtins/search-providers/tavily.provider";

const QUERY = process.argv[2] || "DeepSeek 最新模型 发布";
const FETCH_URL = process.argv[3] || "https://api-docs.deepseek.com/zh-cn/guides/search";

function candidateDirs(): string[] {
  return [
    process.env.PROVIDERS_DIR,
    process.env.USERDATA_DIR ? path.join(process.env.USERDATA_DIR, "providers") : null,
    path.join(os.homedir(), ".guada", "providers"),
    path.join(process.cwd(), "data", "providers"),
    path.join(process.cwd(), "backend-ts", "data", "providers"),
  ].filter((v): v is string => !!v);
}

function findDeepSeekConfig(): { file: string; config: any } {
  for (const dir of candidateDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
      const file = path.join(dir, name);
      let doc: any;
      try {
        doc = yaml.load(fs.readFileSync(file, "utf-8"));
      } catch {
        continue;
      }
      if (doc?.type === "deepseek" && typeof doc.apiKey === "string" && doc.apiKey.trim()) {
        return { file, config: doc };
      }
    }
  }
  throw new Error(
    `未找到可用的 DeepSeek 供应商配置。已尝试：\n${candidateDirs().join("\n")}`,
  );
}

function mask(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`   ⏱  ${label} 耗时 ${Date.now() - start}ms`);
  return result;
}

async function main() {
  const { file, config } = findDeepSeekConfig();
  console.log("== 配置 ==");
  console.log(`文件: ${file}`);
  console.log(`供应商: ${config.name} (id=${config.id}, enabled=${config.enabled})`);
  console.log(`Key: ${mask(config.apiKey)}`);

  const provider = new DeepSeekProvider();

  console.log("\n== 1. Provider.search（真实 API）==");
  const search = await timed("search", () =>
    provider.search(QUERY, { size: 3 }, config.apiKey),
  );
  console.log(`query: ${QUERY}`);
  console.log(`total: ${search.total}`);
  for (const item of search.results) {
    console.log(`--- [${item.index}] ${item.title}`);
    console.log(`    ${item.link}`);
    console.log(
      `    score=${item.score} date=${item.date || "-"} summary=${item.summary?.length || 0}字 content=${item.content?.length || 0}字`,
    );
    console.log(`    ${(item.summary || item.content || "").slice(0, 80).replace(/\s+/g, " ")}...`);
  }

  console.log("\n== 2. Provider.readWebpage（Fetch API）==");
  const page = await timed("readWebpage", () =>
    provider.readWebpage(FETCH_URL, "markdown", config.apiKey),
  );
  const text = typeof page === "string" ? page : page.content || "";
  console.log(`url: ${FETCH_URL}`);
  console.log(`返回长度: ${text.length} 字`);
  console.log(text.slice(0, 160).replace(/\n/g, " ⏎ "));

  console.log("\n== 3. 插件全链路（settings: deepseek + useProviderKey=true）==");
  const settingsStorage: any = {
    getSettings: async () => ({
      provider: "deepseek",
      deepseek: { apiKey: "", useProviderKey: true },
    }),
  };
  const providerStore: any = {
    listProviders: () => [config],
  };
  const plugin = new WebSearchPlugin(
    settingsStorage,
    new BochaProvider(),
    new MetasoProvider(),
    new TavilyProvider(),
    provider,
    providerStore,
  );

  const tools: Record<string, any> = {};
  const toolkit = {
    registerTool: (def: any) => {
      tools[def.name] = def;
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

  const toolResult = await timed("web_search.execute", () =>
    tools.web_search.execute({ q: "DeepSeek API 文档", size: 2 }),
  );
  console.log(toolResult.slice(0, 500));

  console.log("\n✅ 实测完成");
}

main().catch((error) => {
  console.error("\n❌ 实测失败:", error?.message || error);
  process.exitCode = 1;
});
