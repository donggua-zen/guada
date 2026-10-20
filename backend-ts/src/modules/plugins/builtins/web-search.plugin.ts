import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../base-plugin";
import { PluginApi } from "../api/plugin-api";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { ProviderFileStore } from "../../llm-core/provider-file.store";
import { BochaProvider } from "./search-providers/bocha.provider";
import { DeepSeekProvider } from "./search-providers/deepseek.provider";
import { MetasoProvider } from "./search-providers/metaso.provider";
import { TavilyProvider } from "./search-providers/tavily.provider";
import { SearchProvider } from "./search-providers/search-provider.interface";
import { z } from "zod";
import langZh from "./web-search.lang.zh.json";
import langEn from "./web-search.lang.en.json";

@Injectable()
export class WebSearchPlugin extends PluginBase {
  private readonly logger = new Logger(WebSearchPlugin.name);

  manifest = {
    id: "web-search",
    name: "%webSearch.name%",
    description: "%webSearch.description%",
    version: "1.0.0",
    category: "extended" as const,
  };

  private providers: SearchProvider[] = [];

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly bochaProvider: BochaProvider,
    private readonly metasoProvider: MetasoProvider,
    private readonly tavilyProvider: TavilyProvider,
    private readonly deepSeekProvider: DeepSeekProvider,
    private readonly providerStore: ProviderFileStore,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    this.providers = [
      this.bochaProvider,
      this.tavilyProvider,
      this.metasoProvider,
      this.deepSeekProvider,
    ];

    // 读取当前供应商，动态决定注册哪些参数
    const settings = await this.settingsStorage.getSettings("search");
    const providerName = settings.provider || "bocha";
    const provider = this.providers.find((p) => p.name === providerName) || this.bochaProvider;
    const cap = provider.capabilities;

    const providerDesc = provider.displayName;

    api.registerToolKit({
      id: "web_search",
      description: "%webSearch.toolkitDescription%",
      name: "%webSearch.toolkitName%",
      loadMode: "eager",
      activator:
        "Use this toolkit when the user asks to search the internet, look up information, find current news, or when you need to retrieve the content of a specific URL.",
      onLoad: (toolkit) => {
        // ===== web_search =====
        const searchProps: Record<string, z.ZodTypeAny> = {
          q: z.string().describe(
            "Search query. Use precise and specific keywords for better results.",
          ),
          size: z.number().int().min(1).max(50).optional().default(10)
            .describe("Number of results to return, max 50."),
        };

        const searchDescParts: string[] = [
          `Execute web search using ${providerDesc} and return a list of results.`,
          "Use when the user asks for real-time information, latest news, or needs internet search.",
        ];

        if (cap.scope?.supported && cap.scope.values) {
          searchProps.scope = z.enum(cap.scope.values as [string, ...string[]]).optional().default("webpage")
            .describe("Search scope: " + cap.scope.values.join(", "));
          searchDescParts.push(`Supports scope filtering: ${cap.scope.values.join(", ")}.`);
        }

        if (!cap.searchReturnsContent) {
          searchDescParts.push("Note: search results do not include full page content. Use web_parser to read specific URLs.");
        }

        toolkit.registerTool({
          name: "web_search",
          description: searchDescParts.join(" "),
          inputSchema: z.object(searchProps),
          execute: async (args) => {
            return await this.executeSearch(args, provider);
          },
          display: {
            actionType: "web_search",
            text: { executing: "%web_search.executing%", completed: "%web_search.completed%" },
            aggregate: { executing: "%web_search.aggregate.executing%", completed: "%web_search.aggregate.completed%" },
            argsKey: "q",
            icon: "search",
          },
          readOnly: true,
        });

        // ===== web_parser =====
        if (cap.supportsWebpageExtract) {
          toolkit.registerTool({
            name: "web_parser",
            description:
              `Read the full content of a specific URL using ${providerDesc}. ` +
              "Returns formatted text. Use when you need the complete article content from a known webpage.",
            inputSchema: z.object({
              url: z.string().describe("The URL of the webpage to read."),
            }),
            execute: async (args) => {
              return await this.executeReadWebpage(args, provider);
            },
            display: {
              actionType: "web_parser",
              text: { executing: "%web_parser.executing%", completed: "%web_parser.completed%" },
              aggregate: { executing: "%web_parser.aggregate.executing%", completed: "%web_parser.aggregate.completed%" },
              argsKey: "url",
              icon: "browser",
            },
            readOnly: true,
          });
        }

        // Prompt
        const promptLines = [
          "# Web Search Tools",
          "",
          `- Current provider: ${providerDesc}.`,
          "- Use `web_search` for real-time information, news, or facts you're not sure about.",
        ];
        if (cap.supportsWebpageExtract) {
          promptLines.push("- Use `web_parser` when you have a specific URL and need to read the full article content.");
        }
        if (cap.scope?.supported) {
          promptLines.push(`- Supports search scope: ${cap.scope.values?.join(", ")}.`);
        }

        toolkit.registerPrompt({
          frequency: "REGULAR",
          description: "网络搜索工具使用说明",
          content: promptLines.join("\n"),
        });
      },
    });
  }

  /**
   * 获取当前供应商和 API Key
   */
  private async getProviderWithKey(): Promise<{
    provider: SearchProvider;
    apiKey: string;
  }> {
    const settings = await this.settingsStorage.getSettings("search");
    const providerName = settings.provider || "bocha";

    const provider = this.providers.find((p) => p.name === providerName) || this.bochaProvider;

    const providerCfg = settings[providerName];
    const apiKey = this.resolveApiKey(providerName, providerCfg);

    if (!apiKey) {
      throw new Error(
        `Please configure the ${provider.displayName} API Key in the system settings > Search settings.`,
      );
    }

    return { provider, apiKey };
  }

  /**
   * 解析搜索用的 API Key
   *
   * DeepSeek 支持勾选「使用模型服务 Key」：直接复用 Models 设置里同类型供应商的 Key，
   * 避免用户在搜索设置里重复粘贴。
   */
  private resolveApiKey(providerName: string, providerCfg: any): string {
    if (providerName === "deepseek" && providerCfg?.useProviderKey === true) {
      const modelKey = this.findModelProviderKey(providerName);
      if (!modelKey) {
        throw new Error(
          "No DeepSeek API Key found in Models settings. Configure a DeepSeek provider there, " +
            'or uncheck "Use model provider key" in Settings > Search.',
        );
      }
      return modelKey;
    }

    return providerCfg?.apiKey || "";
  }

  /** 从模型供应商配置中取同类型且已启用的 Key（优先 enabled，其次任意非空） */
  private findModelProviderKey(type: string): string {
    try {
      const candidates = this.providerStore
        .listProviders()
        .filter((p) => p.type === type && p.apiKey?.trim());
      const preferred = candidates.find((p) => p.enabled) || candidates[0];
      return preferred?.apiKey?.trim() || "";
    } catch (error: any) {
      this.logger.warn(`Failed to read model provider key: ${error.message}`);
      return "";
    }
  }

  /**
   * 执行网络搜索
   */
  private async executeSearch(args: Record<string, any>, provider: SearchProvider): Promise<string> {
    const { q, size = 10 } = args;

    if (!q?.trim()) {
      throw new Error("Search query is required");
    }

    const { apiKey } = await this.getProviderWithKey();

    try {
      const result = await provider.search(q, { size }, apiKey);

      if (!result.results || result.results.length === 0) {
        return `No results found for: "${q}"`;
      }

      const parts: string[] = [`${result.total} results found:`];
      for (const item of result.results) {
        parts.push(`--- [${item.index}] ${item.title} ---`);
        parts.push(`URL: ${item.link}`);
        if (item.date) parts.push(`Date: ${item.date}`);
        parts.push("");
        parts.push(item.content || item.summary || "");
      }
      return parts.join("\n");
    } catch (error: any) {
      this.logger.error(`Search failed (${provider.name}): ${error.message}`);
      if (error.message.includes("fetch")) {
        throw new Error(
          `Network request failed, please check your connection: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * 读取指定 URL 的网页内容
   */
  private async executeReadWebpage(args: { url: string; format?: string }, provider: SearchProvider): Promise<string> {
    const { url } = args;

    if (!url?.trim()) {
      throw new Error("URL is required");
    }

    const { apiKey } = await this.getProviderWithKey();

    try {
      // Always use markdown format for clean plain-text output
      const result = await provider.readWebpage(url, "markdown", apiKey);

      if (typeof result === "string") {
        return result;
      }

      // Fallback: format ParseResponse as plain text
      const lines: string[] = [];
      if (result.title) lines.push(`# ${result.title}`);
      lines.push(`URL: ${result.url}`);
      if (result.date) lines.push(`Date: ${result.date}`);
      lines.push("");
      lines.push(result.content || result.summary || "No content");
      return lines.join("\n");
    } catch (error: any) {
      this.logger.error(`Webpage read failed (${provider.name}): ${error.message}`);
      if (error.message.includes("fetch")) {
        throw new Error(
          `Network request failed, please check your connection: ${error.message}`,
        );
      }
      throw error;
    }
  }
}
