import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi, ToolExecCtx } from "../../plugins/api/plugin-api";
import { PluginManager } from "../../plugins/plugin.manager";
import { PromptCollector } from "../../plugins/prompt-collector.service";
import {
  PluginContext,
  ToolHandlerDef,
  ResolvedPluginInfo,
} from "../../plugins/types/plugin.types";
import { ToolOrchestrator } from "../tool-orchestrator.service";

@Injectable()
export class UniversalToolsPlugin extends PluginBase {
  private readonly logger = new Logger(UniversalToolsPlugin.name);

  /** sessionId → 工具包记忆提示词缓存（压缩后失效） */
  private toolkitMemoryCache = new Map<string, string>();

  manifest = {
    id: "universal_tools",
    name: "通用工具",
    description: "tool_learn / tool_use 系统级通用工具",
    version: "1.0.0",
    category: "system" as const,
    essential: true,
  };

  constructor(
    private orchestrator: ToolOrchestrator,
    private pluginManager: PluginManager,
    private promptCollector: PromptCollector,
  ) {
    super();
  }

  /** 压缩发生后清除对应 session 的缓存，下次 getMessages 时自动重建 */
  @OnEvent("memory.compacted")
  handleCompacted(payload: { sessionId: string }) {
    if (this.toolkitMemoryCache.has(payload.sessionId)) {
      this.toolkitMemoryCache.delete(payload.sessionId);
      this.logger.debug(
        `Toolkit memory cache cleared for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    // 注册懒加载工具包
    const lazyKit = api.registerToolKit({
      id: "lazy_tools",
      name: "Lazy-Load Toolkit Management",
      loadMode: "eager",
      activator:
        "Use tool_learn to learn toolkit usage, use tool_use to invoke specific tools",
    });

    // 懒加载工具包激活词提示词
    lazyKit.registerPrompt({
      frequency: "REGULAR",
      description: "可用懒加载工具包列表",
      content: async (context: PluginContext) => {
        return this.buildActivators(context);
      },
    });

    // tool_learn
    lazyKit.registerTool({
      name: "tool_learn",
      description:
        "Learn the detailed usage of a specified toolkit, including parameter definitions and usage examples for all tools within that toolkit.",
      inputSchema: z.object({
        name: z.string().describe("Toolkit name"),
      }),
      execute: async (args: { name: string }, ctx?: ToolExecCtx) => {
        return this.handleToolLearn(args.name, ctx!);
      },
      display: { action: "学习工具包", argsKey: "name", icon: "tool" },
    });

    // tool_use
    lazyKit.registerTool({
      name: "tool_use",
      description:
        "Use a specified tool to perform an operation. Pass the tool name and corresponding parameters to invoke any registered tool in the system.",
      inputSchema: z.object({
        tool_name: z.string().describe("Name of the tool to be called"),
        arguments: z
          .record(z.string(), z.any())
          .describe(
            "JSON object containing parameters for the lazy-loaded tool call, providing the appropriate parameter object according to the specific tool's requirements",
          ),
      }),
      execute: async (
        args: { tool_name: string; arguments: Record<string, any> },
        ctx?: ToolExecCtx,
        signal?: AbortSignal,
      ) => {
        const session = ctx?.session;
        if (!session) return "Error: Tool execution context not available";
        const result = await this.orchestrator.executeTool(
          args.tool_name,
          args.arguments,
          "tool_use",
          session,
          signal,
        );
        return result.content;
      },
      display: { action: "使用工具", argsKey: "tool_name", icon: "tool" },
    });

    // 工具包记忆提示词：注入到 user 消息（压缩后自动恢复 AI 正在使用的工具包定义）
    api.registerPrompt({
      frequency: "VOLATILE",
      type: "system",
      description: "已加载工具包的工具定义（压缩后自动恢复）",
      content: async (context: PluginContext) => {
        return this.buildToolkitMemoryPrompt(context);
      },
    });
  }

  /**
   * 构建工具包记忆提示词。
   * 缓存命中 → 直接返回；缓存未命中 → 扫描历史 → 反查工具包 → 构建文本 → 回填缓存。
   *
   * 优化：如果历史中仍存在 tool_learn 返回的完整工具定义（未被压缩裁掉），
   * 则跳过注入，避免重复占用 context。
   */
  private async buildToolkitMemoryPrompt(
    context: PluginContext,
  ): Promise<string> {
    const sessionId = context.session.sessionId;

    // 缓存命中，直接返回（未压缩则一直命中）
    const cached = this.toolkitMemoryCache.get(sessionId);
    if (cached !== undefined) return cached;
    this.toolkitMemoryCache.set(sessionId, "");
    const history = await context.session.getHistory();
    if (!history || history.length === 0) return "";

    // ── 1. 单次遍历，同时收集 tool_use 调用 和 已有的 tool_learn 调用 ──
    const usedTools = new Set<string>();
    const existingToolkits = new Set<string>();

    for (const msg of history) {
      if (msg.role !== "assistant" || !msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        try {
          const args =
            typeof tc.arguments === "string"
              ? JSON.parse(tc.arguments)
              : tc.arguments;
          if (tc.name === "tool_use") {
            const toolName: string | undefined = args?.tool_name;
            if (toolName && typeof toolName === "string") {
              usedTools.add(toolName);
            }
          } else if (tc.name === "tool_learn") {
            const kitName: string | undefined = args?.name;
            if (kitName && typeof kitName === "string") {
              existingToolkits.add(kitName);
            }
          }
        } catch {
          // JSON 解析失败，跳过
        }
      }
    }

    if (usedTools.size === 0) return "";

    // ── 3. 反查每个工具所属的懒加载工具包，跳过已存在于历史中的 ──
    const resolved = context.session.getResolvedPlugins();
    if (!resolved || resolved.length === 0) return "";

    // kitName → { tools, pluginId }
    const kitToolsMap = new Map<
      string,
      { tools: ToolHandlerDef[]; pluginId: string }
    >();

    for (const rp of resolved) {
      if (!rp.enabled) continue;

      // 预处理本插件中懒加载工具包的 id → 显示名映射（避免 nested loop + filter）
      const lazyKitMeta = new Map<string, { kitName: string }>();
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled || tk.loadMode !== "lazy") continue;
        lazyKitMeta.set(tk.id, { kitName: tk.name || tk.id });
      }
      if (lazyKitMeta.size === 0) continue;

      // 单次遍历 allTools，直接查懒加载映射
      for (const t of rp.allTools) {
        if (!usedTools.has(t.name) || !t.toolSet) continue;
        const meta = lazyKitMeta.get(t.toolSet);
        if (!meta) continue;
        // existingToolkits 存的是工具包 ID（tool_learn 的参数），用 t.toolSet（即 tk.id）匹配
        if (existingToolkits.has(t.toolSet)) continue;

        let entry = kitToolsMap.get(meta.kitName);
        if (!entry) {
          entry = { tools: [], pluginId: rp.plugin.id };
          kitToolsMap.set(meta.kitName, entry);
        }
        entry.tools.push(t);
      }
    }

    if (kitToolsMap.size === 0) {
      return "";
    }

    // ── 4. 逐工具包构建完整描述（工具定义 + 使用说明），回填缓存 ──
    const parts: string[] = [
      "The following are toolkits you learned earlier in the conversation and are still actively using.",
      "",
    ];

    for (const [kitName, { tools, pluginId }] of kitToolsMap) {
      const content = await this.buildToolkitContent(
        kitName,
        tools,
        pluginId,
        resolved,
        context,
      );
      if (content) parts.push(content);
    }

    const result = "# LEARNED TOOLKITS\n" + parts.join("\n\n");

    // 回填缓存
    this.toolkitMemoryCache.set(sessionId, result);
    return result;
  }

  /**
   * 构建单个工具包的完整内容（工具定义 XML + 使用说明 prompt）。
   *
   * 内部自动收集该插件对应的 lazy prompts（使用指南/说明），
   * 按工具包维度组装：先工具定义 XML，再使用说明。
   *
   * 被 handleToolLearn 和 buildToolkitMemoryPrompt 共用，
   * 保证 tool_learn 返回的内容与压缩后自动注入的内容格式一致。
   */
  private async buildToolkitContent(
    kitName: string,
    tools: ToolHandlerDef[],
    pluginId: string,
    resolved: ResolvedPluginInfo[],
    context: PluginContext,
  ): Promise<string> {
    const parts: string[] = [];

    // 1. 工具定义 XML
    if (tools.length > 0) {
      const toolDescriptions = tools
        .map((tool) => {
          const params = tool.parameters?.properties || {};
          const required = tool.parameters?.required || [];

          const paramList = Object.entries(params)
            .map(([key, value]: [string, any]) => {
              const isRequired = required.includes(key);
              const entry: Record<string, any> = {
                type: value.type || "string",
                description: value.description || "",
                required: isRequired,
              };
              if (value.enum) entry.enum = value.enum;
              if (value.default !== undefined) entry.default = value.default;
              return `        "${key}": ${JSON.stringify(entry)}`;
            })
            .join(",\n");

          return [
            `  <tool name="${tool.name}">`,
            `    <description>${tool.description}</description>`,
            `    <parameters>`,
            paramList,
            `    </parameters>`,
            `  </tool>`,
          ].join("\n");
        })
        .join("\n");

      parts.push(`toolkit ${kitName}`, "", toolDescriptions);
    }

    // 2. 使用说明 prompt（lazy prompts）
    let toolUsagePrompt = "";
    try {
      const prompts = await this.promptCollector.collectLazyPrompts(
        resolved,
        context,
      );
      const tsPrompts = prompts.filter((p: any) => p.pluginId === pluginId);
      if (tsPrompts.length > 0) {
        toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
      }
    } catch {}

    if (toolUsagePrompt) {
      parts.push(toolUsagePrompt);
    }
    parts.push("---");
    return parts.join("\n");
  }

  private async handleToolLearn(
    name: string,
    ctx: ToolExecCtx,
  ): Promise<string> {
    const resolved = ctx?.session?.getResolvedPlugins();
    if (!resolved || resolved.length === 0)
      return "Error: no available toolkits";
    // 遍历 resolved 查找指定工具包
    let targetKit:
      | {
          tools: ToolHandlerDef[];
          pluginId: string;
        }
      | undefined;
    for (const rp of resolved) {
      if (!rp.enabled) continue;
      const kitInfo = rp.enabledToolKits.find(
        (k) => k.id === name || k.name === name,
      );
      if (!kitInfo) continue;
      // 懒加载工具包的工具存在 allTools 中（enabledTools 不含未激活的懒加载工具）
      const kitTools = rp.allTools.filter((t) => t.toolSet === kitInfo.id);
      if (kitTools.length > 0 || kitInfo.loadMode === "lazy") {
        targetKit = { tools: kitTools, pluginId: rp.plugin.id };
        break;
      }
    }

    if (!targetKit) {
      return `Error: unknown toolkit set: ${name}`;
    }

    const plugin = this.pluginManager.getPlugin(targetKit.pluginId);
    if (!plugin || !plugin.enabled) {
      return `Error: toolkit set ${name} not available`;
    }

    try {
      const resolved = ctx!.session.getResolvedPlugins();
      const content = await this.buildToolkitContent(
        name,
        targetKit.tools,
        targetKit.pluginId,
        resolved,
        ctx!,
      );
      if (!content) {
        return `Error: toolkit set ${name} has no available tools`;
      }

      // tool_learn 专属尾部：告诉 AI 如何使用
      return (
        content +
        "\n\n## Usage:\nUse `tool_use(tool_name, arguments{param1: value1, param2: value2})` to invoke"
      );
    } catch (error: any) {
      this.logger.error(`Error loading tool set ${name}`, error);
      return `Error: ${error.message}`;
    }
  }

  private async buildActivators(context: PluginContext): Promise<string> {
    const resolved = context.session.getResolvedPlugins();
    const items = await this.pluginManager.getToolActivators(resolved);
    if (items.length === 0) return "";
    const xml = items.map(
      (item) => `<toolkit name="${item.name}">${item.activator}</toolkit>`,
    );
    return [
      "# Available Lazy-Load Toolkits",
      "You can use the following lazy-load toolkits. When a user's request or task matches a toolkit's capabilities, you should proactively use `tool_learn` to load the corresponding toolkit.",
      "",
      "<toolkits>",
      ...xml,
      "</toolkits>",
    ].join("\n");
  }
}
