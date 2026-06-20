import { Injectable, Logger } from "@nestjs/common";
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";

import {
  UniversalToolHandler,
  UNIVERSAL_TOOLS,
} from "./universal-tool-handler";
import { ToolRuntime } from "./tool-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { PluginInstance, PluginManager } from "../plugins/plugin.manager";
import {
  PluginContext,
  PluginManifest,
  ToolHandlerDef,
  ToolLoadMode,
  PluginConfig,
} from "../plugins/types/plugin.types";

/**
 * MCP 配置以 toolsConfig.mcp 字段形式存在
 */

@Injectable()
export class ToolOrchestrator {
  private readonly logger = new Logger(ToolOrchestrator.name);
  private universalHandler: UniversalToolHandler;

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly pluginManager: PluginManager,
  ) {
    this.universalHandler = new UniversalToolHandler();
  }
  async resolveAvailableTools(
    role?: PluginConfig,
    mcpServersConfig?: any,
  ): Promise<
    {
      enabled: boolean;
      effective: "global" | "role";
      plugin: PluginManifest;
      enabledTools: ToolHandlerDef[];
      allTools: ToolHandlerDef[];
    }[]
  > {
    const rawGlobal = await this.settingsStorage.getSettings("plugins");
    const globalCfg = this.normalizePluginConfig(rawGlobal, undefined);
    const rawRole = role;
    const roleCfg = this.normalizePluginConfig(rawRole, mcpServersConfig);
    const pluginToosList: {
      enabled: boolean;
      effective: "global" | "role";
      plugin: PluginManifest;
      enabledTools: ToolHandlerDef[];
      allTools: ToolHandlerDef[];
    }[] = [];
    for (const instance of this.pluginManager.getAllPluginRegistrations()) {
      const pluginId = instance.manifest.id;
      // 即使 disabled 也要获取 tools（onLoad 始终调用，PluginRegistry 有数据）
      const tools = this.pluginManager.getPluginTools(pluginId);
      const manifest = instance.manifest;
      const result = this.resolvePluginEnabledTools(
        globalCfg,
        roleCfg,
        manifest,
        tools,
      );
      // console.log(result);
      pluginToosList.push({
        enabled: result.enabled,
        effective: result.effective,
        plugin: manifest,
        enabledTools: result.tools,
        allTools: tools,
      });
    }
    return pluginToosList;
  }
  // ── 构建工具运行时 ──

  async buildToolRuntime(
    injectParams: PluginContext,
    toolsConfig: PluginConfig,
    mcpServersConfig?: any,
  ): Promise<ToolRuntime> {
    const pluginAvailableTools = await this.resolveAvailableTools(
      toolsConfig,
      mcpServersConfig,
    );
    const allToolSets =
      await this.pluginManager.getPluginToolSets(injectParams);

    // // 1. 读取全局配置并标准化
    // const rawGlobal = await this.settingsStorage.getSettings("plugins");
    // const globalCfg = this.normalizePluginConfig(rawGlobal, undefined);

    // // 2. 标准化角色/会话配置 + 合并 MCP
    // const roleCfg = this.normalizePluginConfig(toolsConfig, mcpServersConfig);

    const eagerTools = new Map<string, ToolDefinition>();
    const lazyToolSets = new Map<
      string,
      { tools: ToolDefinition[]; pluginId: string }
    >();
    const toolNames = new Set<string>();

    // 先获取所有已解析运行时的 ToolSet 信息
    // const allToolSets =
    // await this.pluginManager.getPluginToolSets(injectParams);
    // 构建 toolSet → loadMode 查找表
    const toolSetLoadModes = new Map<string, ToolLoadMode>();
    for (const group of allToolSets) {
      for (const ts of group.toolSets) {
        toolSetLoadModes.set(ts.name, ts.loadMode);
      }
    }

    for (const { enabled, plugin, enabledTools } of pluginAvailableTools) {
      // const enabled = this.resolvePluginEnabledTools(
      //   globalCfg,
      //   roleCfg,
      //   plugin.id,
      //   manifest?.category,
      // );
      if (!enabled) continue;

      const lazyByToolSet = new Map<string, ToolDefinition[]>();

      for (const tool of enabledTools) {
        // 根据 tool.toolSet 查表获取加载模式
        const loadMode = tool.toolSet
          ? (toolSetLoadModes.get(tool.toolSet) ?? "eager")
          : "eager";

        // 细粒度过滤：如果 enabled 是 string[]，只包含数组中的工具
        let toolAllowed = true;
        if (Array.isArray(enabled)) {
          toolAllowed = enabled.includes(tool.name);
        }
        if (!toolAllowed) continue;

        const def: ToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as any,
          action: tool.action,
          icon: tool.icon,
          argsKey: tool.argsKey,
        };

        if (toolNames.has(tool.name)) {
          this.logger.warn(`Duplicate tool name: ${tool.name}`);
          continue;
        }
        toolNames.add(tool.name);

        if (loadMode === "lazy") {
          const ts = tool.toolSet || "__default";
          if (!lazyByToolSet.has(ts)) lazyByToolSet.set(ts, []);
          lazyByToolSet.get(ts)!.push(def);
        } else if (loadMode === "eager") {
          eagerTools.set(tool.name, def);
        }
        // loadMode === "none" 则跳过
      }

      // 注册懒加载工具集
      for (const [ts, tsTools] of lazyByToolSet) {
        lazyToolSets.set(ts, { tools: tsTools, pluginId: plugin.id });
      }
    }

    // 有懒加载工具集时添加通用工具
    if (lazyToolSets.size > 0) {
      for (const ut of UNIVERSAL_TOOLS) {
        eagerTools.set(ut.name, ut);
      }
    }

    return new ToolRuntime(injectParams, eagerTools, lazyToolSets, toolsConfig);
  }

  /**
   * 标准化 toolsConfig：旧格式转对象 + 合并 MCP 配置
   */
  private normalizePluginConfig(
    toolsConfig: PluginConfig,
    mcpServersConfig?: any,
  ): PluginConfig {
    let merged: Record<string, boolean | string[]>;

    // 旧格式转换
    if (typeof toolsConfig === "boolean") {
      // 旧版 true/false → 空对象（后续由 resolvePluginEnabledTools 按类型推导）
      merged = {};
    } else if (Array.isArray(toolsConfig)) {
      // 旧版 string[] → { pluginId: true }
      merged = {};
      for (const id of toolsConfig) merged[id] = true;
    } else {
      merged = { ...toolsConfig };
    }

    // MCP 配置直接存入 merged.mcp
    if (
      mcpServersConfig &&
      typeof mcpServersConfig === "object" &&
      merged.mcp !== false
    ) {
      merged.mcp = mcpServersConfig;
    }

    return merged;
  }

  /**
   * 判断插件是否启用：全局与角色直接传入，不提前合并
   *
   * 规则：
   * 1. 全局禁用（值为 false）→ 角色不可覆盖
   * 2. 角色有配置 → 全局已定义则采纳；全局未定义时仅 core 可采纳
   * 3. 角色未配置、全局有值 → 用全局
   * 4. 完全未配置 → core=true，其余=false
   */
  public resolvePluginEnabledTools(
    global: PluginConfig,
    role: PluginConfig,
    plugin: PluginManifest,
    tools: ToolHandlerDef[],
  ): {
    enabled: boolean;
    effective: "global" | "role";
    tools: ToolHandlerDef[];
  } {
    const resolve = (
      val: boolean | string[] | undefined,
      effective: "global" | "role",
    ) => {
      if (val === true) return { enabled: true, effective, tools };
      if (Array.isArray(val) && val.length > 0) {
        return {
          enabled: true,
          effective,
          tools: val.map((id) => tools.find((t) => t.name === id))!,
        };
      }
      return { enabled: false, effective, tools: [] };
    };

    // 1. 全局禁用 → 不可覆盖
    if (plugin.id in global && global[plugin.id] === false)
      return { enabled: false, effective: "global", tools: [] };

    const defaultEnabled = plugin.category === "core";

    // 2. 角色有配置
    if (plugin.id in role) {
      // 全局已定义 → 角色可覆盖
      if (plugin.id in global) return resolve(role[plugin.id], "role");
      // 全局未定义 + core → 采纳角色
      if (defaultEnabled) return resolve(role[plugin.id], "role");
      // 全局未定义 + 非 core → 不可激活
      return { enabled: false, effective: "global", tools: [] };
    }

    // 3. 角色未配置，全局有值
    if (plugin.id in global) return resolve(global[plugin.id], "global");

    // 4. 完全未配置 → 按类型默认
    return { enabled: defaultEnabled, effective: "global", tools: tools };
  }

  // ── 批量执行工具 ──

  async executeBatch(
    requests: ToolCallRequest[],
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse[]> {
    const responses: ToolCallResponse[] = new Array(requests.length);
    const MAX_CONCURRENCY = 10;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < requests.length) {
        if (abortSignal?.aborted) break;
        const index = nextIndex++;
        const req = requests[index];
        try {
          responses[index] = await this.execute(req, context, abortSignal);
        } catch (error: any) {
          responses[index] = {
            toolCallId: req.id,
            name: req.name,
            content: `Error: ${error.message || String(error)}`,
            isError: true,
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, requests.length) }, () =>
        worker(),
      ),
    );

    if (abortSignal?.aborted) {
      for (let i = 0; i < requests.length; i++) {
        if (!responses[i])
          responses[i] = {
            toolCallId: requests[i].id,
            name: requests[i].name,
            content: "Error: Request was aborted",
            isError: true,
          };
      }
    }
    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    if (request.name === "tool_load") {
      return await this.handleToolLoad(request, context);
    }
    if (request.name === "tool_call") {
      const { fullToolName, toolArgs } =
        this.universalHandler.parseToolCall(request);
      return await this.executeTool(
        fullToolName,
        toolArgs,
        request.id,
        context,
        abortSignal,
      );
    }
    return await this.executeTool(
      request.name,
      request.arguments,
      request.id,
      context,
      abortSignal,
    );
  }

  /**
   * 处理 tool_load 请求：通过 PluginManager 加载插件详细说明
   */
  private async handleToolLoad(
    request: ToolCallRequest,
    context: ToolRuntime,
  ): Promise<ToolCallResponse> {
    const { toolSet } = request.arguments;

    if (!toolSet || typeof toolSet !== "string") {
      return {
        toolCallId: request.id,
        name: request.name,
        content: "Error: 无效的参数：toolSet 必须是字符串",
        isError: true,
      };
    }

    // 通过 runtime 预建结构直接获取懒加载工具集
    const lazySet = context.getLazyToolSet(toolSet);
    if (!lazySet) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 未知的工具集: ${toolSet}`,
        isError: true,
      };
    }

    const plugin = this.pluginManager.getPlugin(lazySet.pluginId);
    if (!plugin || !plugin.enabled) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 工具集 ${toolSet} 不可用`,
        isError: true,
      };
    }

    try {
      // 直接从 lazySet 获取工具定义
      const tools = lazySet.tools;

      // 获取该 toolSet 关联的 lazy 提示词
      let toolUsagePrompt = "";
      try {
        const prompts = await this.pluginManager.collectLazyPrompts(
          context.injectParams,
        );
        const tsPrompts = prompts.filter(
          (p: any) => p.pluginId === lazySet.pluginId,
        );
        if (tsPrompts.length > 0) {
          toolUsagePrompt = tsPrompts.map((p: any) => p.content).join("\n\n");
        }
      } catch {}

      // 工具和提示词都为 0 才报错
      if (tools.length === 0 && !toolUsagePrompt) {
        return {
          toolCallId: request.id,
          name: request.name,
          content: `Error: 工具集 ${toolSet} 下没有可加载的内容`,
          isError: true,
        };
      }

      const responseParts: string[] = [];

      if (tools.length > 0) {
        const toolDescriptions = tools
          .map((tool) => {
            const params = tool.parameters?.properties || {};
            const required = tool.parameters?.required || [];

            const paramList = Object.entries(params)
              .map(([key, value]: [string, any]) => {
                const isRequired = required.includes(key)
                  ? "（必填）"
                  : "（可选）";
                const defaultValue =
                  value.default !== undefined
                    ? ` 默认值: ${value.default}`
                    : "";
                return `  - ${key}: ${value.description || "无描述"} ${isRequired}${defaultValue}`;
              })
              .join("\n");

            return [
              `### ${tool.name}`,
              `**功能**: ${tool.description}`,
              `**参数**:\n${paramList}`,
              "",
            ].join("\n");
          })
          .join("\n");

        responseParts.push(
          `# ${toolSet} 工具集详细说明`,
          "",
          `该工具集包含以下 ${tools.length} 个工具：`,
          "",
          toolDescriptions,
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
          "直接调用工具，格式为：`tool_name`，或者使用`tool_call`间接调用",
          "",
          "现在你可以根据上述说明调用相应的工具了。",
        );
      }

      return {
        toolCallId: request.id,
        name: request.name,
        content: responseParts.join("\n"),
        isError: false,
      };
    } catch (error: any) {
      this.logger.error(`Error executing tool_load`, error);
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: ${error.message}`,
        isError: true,
      };
    }
  }

  private async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    if (!context.hasTool(fullToolName))
      throw new Error(`Tool ${fullToolName} is not available or disabled`);

    const allGroups = await this.pluginManager.getTools(context.injectParams);
    const allTools = allGroups.flatMap((g) => g.tools);
    const toolEntry = allTools.find((t) => t.name === fullToolName);
    if (!toolEntry) throw new Error(`Tool handler not found: ${fullToolName}`);

    try {
      // Zod 运行时校验（仅当工具通过 inputSchema 注册时）
      let validatedArgs = toolArgs;
      if (toolEntry._zodSchema) {
        const result = toolEntry._zodSchema.safeParse(toolArgs);
        if (!result.success) {
          return {
            toolCallId,
            name: fullToolName,
            content: `参数校验失败：${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
            isError: true,
          };
        }
        validatedArgs = result.data;
      }

      let content = await toolEntry.handler(
        validatedArgs,
        context.injectParams,
        abortSignal,
      );

      const MAX_CONTENT_LENGTH = 50000;
      if (content && content.length > MAX_CONTENT_LENGTH) {
        const omittedLength = content.length - MAX_CONTENT_LENGTH;
        content = JSON.stringify({
          warning: `Content truncated. Omitted ${omittedLength} characters.`,
          tool_truncated: content.substring(0, MAX_CONTENT_LENGTH),
          omitted_length: omittedLength,
        });
      }
      return { toolCallId, name: fullToolName, content, isError: false };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing tool ${fullToolName}: ${errorMsg}`);
      return {
        toolCallId,
        name: fullToolName,
        content: JSON.stringify({ success: false, message: errorMsg }),
        isError: true,
      };
    }
  }

  // ── 工具列表（前端 UI 用） ──

  async getLocalToolsList(roleCfg?: PluginConfig): Promise<any[]> {
    const toolsList: any[] = [];

    for (const instance of await this.resolveAvailableTools(roleCfg)) {
      const { enabled, effective, plugin, enabledTools, allTools } = instance;

      toolsList.push({
        pluginId: plugin.id,
        effective,
        name: plugin.id,
        displayName: plugin.name,
        description: plugin.description,
        category: plugin.category,
        enabled,
        isMcp: plugin.id === "mcp",
        tools: allTools.map((t) => ({
          enabled: enabledTools.some((e) => e.name === t.name),
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
        })),
      });
    }
    return toolsList;
  }
}
