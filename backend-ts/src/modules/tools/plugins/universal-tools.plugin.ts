import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi, ToolExecCtx } from "../../plugins/api/plugin-api";
import { PluginManager } from "../../plugins/plugin.manager";
import { PluginContext } from "../../plugins/types/plugin.types";
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
  };

  constructor(
    private orchestrator: ToolOrchestrator,
    private pluginManager: PluginManager,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerToolSet({
      name: "lazy_tools",
      loadMode: "eager",
      activator: "使用 tool_learn 学习工具集用法，使用 tool_use 调用具体工具",
    });

    // 懒加载工具集激活词提示词（通过 registerPrompt 统一注入 system prompt）
    api.registerPrompt({
      frequency: "REGULAR",
      toolSet: "lazy_tools",
      description: "可用懒加载工具集列表",
      content: async (context: PluginContext) => {
        return this.buildActivators(context);
      },
    });

    // ── tool_learn ──
    api.registerTool({
      name: "tool_learn",
      toolSet: "lazy_tools",
      description:
        "学习指定工具集的详细用法，获取该工具集下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
      inputSchema: z.object({
        toolSet: z
          .string()
          .describe("工具集名称，例如：subagent、browser、session 等"),
      }),
      execute: async (args: { toolSet: string }, ctx?: ToolExecCtx) => {
        return this.handleToolLearn(args.toolSet, ctx!);
      },
      display: { action: "学习工具集", argsKey: "toolSet", icon: "tool" },
    });

    // ── tool_use ──
    api.registerTool({
      name: "tool_use",
      toolSet: "lazy_tools",
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
        const runtime = (ctx as any)?.__runtime;
        if (!runtime) return "Error: 工具运行时不可用";
        const result = await this.orchestrator.executeTool(
          args.tool_name,
          args.arguments,
          "tool_use",
          runtime,
          signal,
        );
        return result.content;
      },
      display: { action: "使用工具", argsKey: "tool_name", icon: "tool" },
    });
  }

  private async handleToolLearn(
    toolSet: string,
    ctx: ToolExecCtx,
  ): Promise<string> {
    // 从 ctx 获取 executeTool 注入的 ToolRuntime
    const runtime = (ctx as any)?.__runtime;
    if (!runtime) return "Error: 工具运行时不可用";

    if (!toolSet || typeof toolSet !== "string") {
      return "Error: 无效的参数：toolSet 必须是字符串";
    }

    // 通过 runtime 的懒加载工具集查表（已含角色权限过滤）
    const lazySet = runtime.getLazyToolSet(toolSet);
    if (!lazySet) {
      return `Error: 未知的工具集: ${toolSet}`;
    }

    const plugin = this.pluginManager.getPlugin(lazySet.pluginId);
    if (!plugin || !plugin.enabled) {
      return `Error: 工具集 ${toolSet} 不可用`;
    }

    try {
      const tools = lazySet.tools;

      let toolUsagePrompt = "";
      try {
        const prompts = await this.pluginManager.collectLazyPrompts(
          runtime.injectParams,
        );
        const tsPrompts = prompts.filter(
          (p: any) => p.pluginId === lazySet.pluginId,
        );
        if (tsPrompts.length > 0) {
          toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
        }
      } catch {}

      if (tools.length === 0 && !toolUsagePrompt) {
        return `Error: 工具集 ${toolSet} 下没有可加载的内容`;
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
          `<tool_set name="${toolSet}">`,
          "",
          toolDescriptions,
          `</tool_set>`,
        );
      }

      if (toolUsagePrompt) {
        if (responseParts.length > 0) responseParts.push("---", "");
        responseParts.push(toolUsagePrompt);
      }

      if (responseParts.length > 0) {
        responseParts.push(
          "---",
          "",
          "**使用方式**:",
          "直接调用工具，或使用`tool_use`间接调用",
          "",
          "现在你可以根据上述说明调用相应的工具了。",
        );
      }

      return responseParts.join("\n");
    } catch (error: any) {
      this.logger.error(`Error loading tool set ${toolSet}`, error);
      return `Error: ${error.message}`;
    }
  }

  private async buildActivators(context: PluginContext): Promise<string> {
    const items = await this.pluginManager.getToolActivators(context);
    if (items.length === 0) return "";
    const xml = items.map(
      (item) => `<tool_set name="${item.name}">${item.activator}</tool_set>`,
    );
    return [
      "# 可用懒加载工具集",
      "你可以使用以下懒加载工具集。当用户请求或任务与工具集的能力相匹配时，您应该主动使用`tool_load`加载对应工具集",
      "",
      "<tool_sets>",
      ...xml,
      "</tool_sets>",
    ].join("\n");
  }
}
