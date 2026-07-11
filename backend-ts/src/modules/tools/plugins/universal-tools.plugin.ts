import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi, ToolExecCtx } from "../../plugins/api/plugin-api";
import { PluginManager } from "../../plugins/plugin.manager";
import { PromptCollector } from "../../plugins/prompt-collector.service";
import {
  PluginContext,
  ToolHandlerDef,
} from "../../plugins/types/plugin.types";
import { ToolOrchestrator } from "../tool-orchestrator.service";

@Injectable()
export class UniversalToolsPlugin extends PluginBase {
  private readonly logger = new Logger(UniversalToolsPlugin.name);

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

  async onLoad(api: PluginApi) {
    // 注册懒加载工具包
    const lazyKit = api.registerToolKit({
      id: "lazy_tools",
      name: "Lazy-Load Toolkit Management",
      loadMode: "eager",
      activator: "Use tool_learn to learn toolkit usage, use tool_use to invoke specific tools",
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
        "学习指定工具包的详细用法，获取该工具包下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
      inputSchema: z.object({
        name: z.string().describe("工具包名称"),
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
        "使用指定工具执行操作。传入工具名称和对应的参数即可调用系统中所有已注册的工具。",
      inputSchema: z.object({
        tool_name: z.string().describe("需要调用的工具名称"),
        arguments: z
          .record(z.string(), z.any())
          .describe(
            "JSON对象，懒加载工具调用的参数，根据具体工具的要求提供相应的参数对象",
          ),
      }),
      execute: async (
        args: { tool_name: string; arguments: Record<string, any> },
        ctx?: ToolExecCtx,
        signal?: AbortSignal,
      ) => {
        const session = ctx?.session;
        if (!session) return "Error: 工具运行时不可用";
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
  }

  private async handleToolLearn(
    name: string,
    ctx: ToolExecCtx,
  ): Promise<string> {
    const resolved = ctx?.session?.getResolvedPlugins();
    if (!resolved || resolved.length === 0) return "Error: 工具运行时不可用";
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
      return `Error: 未知的工具集: ${name}`;
    }

    const plugin = this.pluginManager.getPlugin(targetKit.pluginId);
    if (!plugin || !plugin.enabled) {
      return `Error: 工具集 ${name} 不可用`;
    }

    try {
      const tools = targetKit.tools;

      let toolUsagePrompt = "";
      try {
        const resolved = ctx!.session.getResolvedPlugins();
        const prompts = await this.promptCollector.collectLazyPrompts(
          resolved,
          ctx!,
        );
        const tsPrompts = prompts.filter(
          (p: any) => p.pluginId === targetKit.pluginId,
        );
        if (tsPrompts.length > 0) {
          toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
        }
      } catch {}

      if (tools.length === 0 && !toolUsagePrompt) {
        return `Error: 工具集 ${name} 下没有可加载的内容`;
      }

      const responseParts: string[] = [];

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

        responseParts.push(
          `<toolkit name="${name}">`,
          "",
          toolDescriptions,
          `</toolkit>`,
        );
      }

      if (toolUsagePrompt) {
        if (responseParts.length > 0) responseParts.push("---", "");
        responseParts.push(toolUsagePrompt);
      }

      if (responseParts.length > 0) {
        responseParts.push("---", "", "## Usage:", "Use `tool_use(tool_name, arguments{param1: value1, param2: value2})` to invoke");
      }

      return responseParts.join("\n");
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
