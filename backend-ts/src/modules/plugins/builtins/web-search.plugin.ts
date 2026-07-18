import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../base-plugin";
import { PluginApi } from "../api/plugin-api";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { BochaProvider } from "./search-providers/bocha.provider";
import { MetasoProvider } from "./search-providers/metaso.provider";
import { TavilyProvider } from "./search-providers/tavily.provider";
import { SearchProvider } from "./search-providers/search-provider.interface";
import { z } from "zod";

@Injectable()
export class WebSearchPlugin extends PluginBase {
  private readonly logger = new Logger(WebSearchPlugin.name);

  manifest = {
    id: "web-search",
    name: "网络搜索",
    description: "网络搜索与网页内容提取工具，支持多供应商",
    version: "1.0.0",
    category: "extended" as const,
  };

  private providers: SearchProvider[] = [];

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly bochaProvider: BochaProvider,
    private readonly metasoProvider: MetasoProvider,
    private readonly tavilyProvider: TavilyProvider,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    this.providers = [this.bochaProvider, this.tavilyProvider, this.metasoProvider];

    // 读取当前供应商，动态决定注册哪些参数
    const settings = await this.settingsStorage.getSettings("search");
    const providerName = settings.provider || "bocha";
    const provider = this.providers.find((p) => p.name === providerName) || this.bochaProvider;
    const cap = provider.capabilities;

    const providerDesc = provider.displayName;

    api.registerToolKit({
      id: "web_search",
      name: "Web Search",
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
            action: "网络搜索",
            argsKey: "q",
            icon: "search",
          },
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
              action: "Read webpage content",
              argsKey: "url",
              icon: "browser",
            },
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
    const apiKey = providerCfg?.apiKey || "";

    if (!apiKey) {
      const names: Record<string, string> = {
        bocha: "博查",
        tavily: "Tavily",
        metaso: "秘塔",
      };
      throw new Error(
        `Please configure the ${names[providerName] || providerName} API Key in the system settings > Search settings.`,
      );
    }

    return { provider, apiKey };
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
