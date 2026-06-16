import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolDisplayInfo,
  ToolDefinition,
  PromptFrequency,
} from "./interfaces/tool-provider.interface";

import {
  UniversalToolHandler,
  UNIVERSAL_TOOLS,
} from "./universal-tool-handler";
import { ToolRuntime } from "./tool-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/**
 * 提示词片段，附带排序元信息
 */
interface PromptPiece {
  content: string;
  /** 排序优先级：STATIC=0, REGULAR=1, VOLATILE=2 */
  sortKey: number;
  pluginId: string;
}

/**
 * 获取指定插件的工具启用配置
 * @param toolsConfig 角色工具配置
 * @param mcpServersConfig MCP 服务器配置
 * @param pluginId 插件标识
 * @param isMcp 是否为 MCP 工具
 * @returns 启用配置（boolean | string[]）
 */
function getEnabledConfig(
  toolsConfig: any,
  mcpServersConfig: any,
  pluginId: string,
  isMcp: boolean,
): boolean | string[] {
  if (isMcp) {
    return mcpServersConfig;
  }
  if (toolsConfig === true) {
    return true;
  }
  return toolsConfig?.[pluginId] || false;
}

export interface ToolMetadata {
  pluginId: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  isMcp: boolean;
  tools?: any[];
}

@Injectable()
export class ToolOrchestrator {
  private readonly logger = new Logger(ToolOrchestrator.name);
  private providers = new Map<string, IToolProvider>();
  private universalHandler: UniversalToolHandler;

  constructor(private readonly settingsStorage: SettingsStorage) {
    // 初始化通用工具处理器
    this.universalHandler = new UniversalToolHandler();
  }

  addProvider(provider: IToolProvider) {
    if (provider.pluginId) {
      this.providers.set(provider.pluginId, provider);
      this.logger.log(`Added tool provider: ${provider.pluginId}`);
    }
  }

  /**
   * 获取所有工具提供者（用于动态配置）
   */
  getProviders(): Map<string, IToolProvider> {
    return this.providers;
  }

  /**
   * 获取指定插件标识的工具提供者
   */
  getProvider(pluginId: string): IToolProvider | undefined {
    return this.providers.get(pluginId);
  }

  /**
   * 生成工具调用的展示文案（结构化）
   * @param request 工具调用请求
   * @param isExecuting 工具是否正在执行（true=正在进行，false=已完成）
   * @returns 结构化的展示信息
   */
  generateDisplayMessage(
    request: ToolCallRequest,
    isExecuting: boolean = true,
    runtime?: ToolRuntime,
  ): ToolDisplayInfo {
    try {
      // 特殊处理 tool_call 工具：从参数中提取实际调用的工具名
      if (request.name === "tool_call") {
        if (request.arguments?.tool_name) {
          const actualToolName = request.arguments.tool_name as string;
          const actualArgs = request.arguments.arguments || {};

          // 递归调用，使用实际的工具名和参数
          return this.generateDisplayMessage(
            { id: request.id, name: actualToolName, arguments: actualArgs },
            isExecuting,
            runtime,
          );
        }
        return {
          action: isExecuting ? "正在调用工具" : "已调用工具",
          args: request.arguments?.pluginId,
          toolName: request.name,
          toolType: "generic",
        };
      }
      if (request.name === "tool_load") {
        return {
          action: isExecuting ? "正在加载工具" : "已加载工具",
          args: request.arguments?.pluginId,
          toolName: request.name,
          toolType: "generic",
        };
      }

      // 解析工具名称获取插件标识
      const pluginId = runtime?.resolvePluginId(request.name) || request.name;
      const provider = this.providers.get(pluginId);

      if (provider && typeof provider.formatDisplayMessage === "function") {
        // 如果提供者返回的是字符串，转换为结构化数据
        const result = provider.formatDisplayMessage(
          request.name,
          request.arguments,
          isExecuting,
        );
        if (typeof result === "string") {
          return {
            action: result,
            toolName: request.name,
            toolType: pluginId,
          };
        }

        // 如果没有显式指定 toolType，使用 pluginId 作为默认值
        if (!result.toolType) {
          result.toolType = pluginId;
        }

        return result;
      }

      // 降级：使用通用格式化
      return this.generateGenericDisplayInfo(
        request.name,
        request.arguments,
        isExecuting,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to generate display message for ${request.name}:`,
        error,
      );
      return {
        action: isExecuting ? "正在调用工具" : "已调用工具",
        toolName: request.name,
        toolType: "generic",
      };
    }
  }

  /**
   * 通用展示文案生成（降级方案）
   */
  private generateGenericDisplayInfo(
    toolName: string,
    args: Record<string, any>,
    isExecuting: boolean,
  ): ToolDisplayInfo {
    // 尝试从工具名推断可读名称
    const readableName =
      toolName
        .split("__")
        .pop()
        ?.replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()) || toolName;

    // 提取关键参数作为 args
    let argsSummary: string | undefined;
    if (args && typeof args === "object") {
      // 尝试提取第一个有意义的参数值
      const keys = Object.keys(args);
      for (const key of keys) {
        const value = args[key];
        if (typeof value === "string" && value.length > 0) {
          // 如果是文件路径，只保留文件名
          argsSummary =
            value.includes("/") || value.includes("\\")
              ? value.split(/[\/\\]/).pop() || value
              : value;
          break;
        }
      }
    }

    return {
      action: `${readableName}`,
      args: argsSummary,
      toolName: toolName,
      toolType: "generic",
    };
  }

  /**
   * 构建工具运行时上下文
   *
   * 根据角色工具配置和全局工具启用状态取交集，返回按命名空间分组的工具定义。
   * @param injectParams 注入参数（sessionId, userId 等）
   * @param toolsConfig 角色工具配置
   * @param mcpServersConfig MCP 服务器配置
   * @returns 按命名空间分组的工具定义映射
   */
  async buildToolRuntime(
    injectParams: Record<string, any>,
    toolsConfig: any,
    mcpServersConfig: any,
    eagerPluginIds?: string[],
  ): Promise<ToolRuntime> {
    // 获取全局启用的工具列表，与角色配置取交集
    const globalTools = await this.getLocalToolsList();
    const globalEnabledPluginIds = new Set(
      globalTools.filter((t) => t.enabled).map((t) => t.pluginId),
    );

    const groupedTools: Record<string, ToolDefinition[]> = {};
    const lazyTools: Record<string, ToolDefinition[]> = {};
    const toolNames = new Set<string>();

    for (const [pluginId, provider] of this.providers.entries()) {
      // 全局未启用的插件直接跳过
      if (!globalEnabledPluginIds.has(pluginId)) continue;

      const metadata = provider.getMetadata(injectParams);
      const enabled = getEnabledConfig(
        toolsConfig,
        mcpServersConfig,
        pluginId,
        metadata.isMcp,
      );
      if (!enabled) continue;

      // 如果指定了强制 eager 的插件，则覆盖 loadMode
      const forceEager = eagerPluginIds?.includes(pluginId);
      const loadMode = forceEager ? "eager" : (metadata.loadMode || "eager");

      // 根据加载模式决定是否包含该工具
      if (loadMode === "none") {
        this.logger.debug(
          `Skipping disabled plugin ${pluginId} (loadMode: none)`,
        );
        continue;
      }

      const providerTools = await provider.getTools(enabled, injectParams);

      const pluginTools = providerTools.map((tool) => {
        if (toolNames.has(tool.name)) {
          this.logger.warn(`Duplicate tool name detected: ${tool.name}`);
        }
        toolNames.add(tool.name);

        return tool;
      });

      if (loadMode === "lazy") {
        this.logger.debug(`Recording lazy-load plugin ${pluginId}`);
        lazyTools[pluginId] = pluginTools;
      } else {
        groupedTools[pluginId] = pluginTools;
      }
    }

    if (Object.keys(lazyTools).length > 0) {
      // 通用工具放入特殊命名空间
      groupedTools["__universal"] = [...UNIVERSAL_TOOLS];
    }

    const flatCount = Object.values(groupedTools).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    this.logger.debug(
      `Collected ${flatCount} tools in ${Object.keys(groupedTools).length} plugins, unique names: ${toolNames.size}`,
    );

    return new ToolRuntime(injectParams, groupedTools, lazyTools);
  }

  /**
   * 获取工具提示词
   *
   * 基于已构建的 ToolRuntime，收集所有启用工具的提示词，避免重复调用 getLocalToolsList。
   * @param runtime 工具运行时上下文
   * @returns 合并后的工具提示词字符串
   */
  async getPrompts(runtime: ToolRuntime): Promise<string> {
    const { injectParams, tools: groupedTools, lazyTools } = runtime;
    const enabledPluginIds = new Set(Object.keys(groupedTools));
    const lazyPluginIds = new Set(Object.keys(lazyTools));

    // 收集所有提示词片段，带上排序元信息
    const pieces: PromptPiece[] = [];

    for (const pluginId of [...enabledPluginIds, ...lazyPluginIds]) {
      const provider = this.providers.get(pluginId);

      if (!provider) continue;
      const pluginSortKey = this.resolvePromptSortKey(provider, injectParams);

      // 收集 persistentPrompt（始终收集，不受 loadMode 影响）
      if (provider.getPersistentPrompt) {
        const persistentPrompt =
          await provider.getPersistentPrompt(injectParams);
        if (persistentPrompt) {
          pieces.push({ content: persistentPrompt, sortKey: pluginSortKey, pluginId });
        }
      }

      // 收集普通 prompt（非 lazy 插件，且 provider 实现了 getPrompt）
      if (!lazyPluginIds.has(pluginId) && provider.getPrompt) {
        const prompt = await provider.getPrompt(injectParams);
        if (prompt) {
          pieces.push({ content: prompt, sortKey: pluginSortKey, pluginId });
        }
      }
    }

    // ★ 按变动频率排序：STATIC 在前，VOLATILE 在后
    pieces.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      // 同频率下按 pluginId 字典序保证稳定顺序
      return a.pluginId.localeCompare(b.pluginId);
    });
    const metaInfos: string[] = [];
    for (const pluginId of lazyPluginIds) {
      const provider = this.providers.get(pluginId);
      if (!provider) continue;
      const metadata = provider.getMetadata(injectParams);

      const briefDesc = provider.getBriefDescription
        ? await provider.getBriefDescription(injectParams)
        : metadata.description;
      if (briefDesc) {
        metaInfos.push(`- ${pluginId}:${metadata.displayName},${briefDesc}`);
      }
    }
    if (metaInfos.length > 0) {
      const metaSection = [
        "# 可用工具集",
        "你可以使用以下工具集。当用户请求或任务与工具集的能力相匹配时，您应该主动使用`tool_load`阅读并应用工具集：",
        "",
        ...metaInfos,
        "",
        "---",
        "",
      ].join("\n");
      const toolGuidePrompt = `## 使用原则
      
1. **避免重复**：已了解用法的工具无需重复加载
2. **仅描述不加载**：如用户仅询问能力或功能介绍，无需加载工具说明
3. **执行调用**：加载后根据说明使用 \`tool_call\` 执行具体操作
`;

      pieces.push({ content: metaSection, sortKey: 3, pluginId: "__meta" });
      pieces.push({ content: toolGuidePrompt, sortKey: 3, pluginId: "__meta" });
    }

    this.logger.debug(`Collected ${pieces.length} tool prompt sections`);
    // this.logger.debug(pieces.map(p => p.pluginId + ":" + p.sortKey).join(", "))
    return pieces.map(p => p.content).join("\n\n");
  }

  /**
   * 解析 provider 的提示词排序优先级。
   * 根据 metadata 中配置的 promptFrequency 映射为数值用于排序。
   * 未配置时默认 REGULAR（1），保证向后兼容。
   */
  private resolvePromptSortKey(
    provider: IToolProvider,
    context?: Record<string, any>,
  ): number {
    const metadata = provider.getMetadata(context);
    const frequency = metadata.promptFrequency ?? 'REGULAR';
    switch (frequency) {
      case 'STATIC':   return 0;
      case 'REGULAR':  return 1;
      case 'VOLATILE': return 2;
      default:         return 1;
    }
  }

  async executeBatch(
    requests: ToolCallRequest[],
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse[]> {
    const responses: ToolCallResponse[] = new Array(requests.length);
    const MAX_CONCURRENCY = 10;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < requests.length) {
        if (abortSignal?.aborted) break;

        const index = nextIndex++;
        const req = requests[index];

        try {
          const response = await this.execute(req, context, abortSignal);
          responses[index] = response;
        } catch (error: any) {
          const errorMsg = error?.message || String(error);
          this.logger.error(`Error executing tool ${req.name}:`, error);
          responses[index] = {
            toolCallId: req.id,
            name: req.name,
            content: `Error: ${errorMsg}`,
            isError: true,
          };
        }
      }
    };

    // 启动最多 MAX_CONCURRENCY 个 worker 并行消费队列
    const workerCount = Math.min(MAX_CONCURRENCY, requests.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // 如果被中止，填充未执行的请求为错误响应
    if (abortSignal?.aborted) {
      for (let i = 0; i < requests.length; i++) {
        if (!responses[i]) {
          responses[i] = {
            toolCallId: requests[i].id,
            name: requests[i].name,
            content: "Error: Request was aborted",
            isError: true,
          };
        }
      }
    }

    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    // 特殊处理：拦截通用工具调用
    if (request.name === "tool_load") {
      return await this.universalHandler.handleToolLoad(
        request,
        context.injectParams,
        (pluginId) => this.getProvider(pluginId),
        (pluginId) => Object.keys(context.lazyTools).some((key) => key === pluginId),
      );
    }

    if (request.name === "tool_call") {
      // 解析 tool_call 参数
      const { fullToolName, toolArgs } =
        this.universalHandler.parseToolCall(request);

      // 由编排器统一执行
      return await this.executeTool(
        fullToolName,
        toolArgs,
        request.id,
        context,
        abortSignal,
      );
    }

    // 使用公共方法执行工具调用
    return await this.executeTool(
      request.name,
      request.arguments,
      request.id,
      context,
      abortSignal,
    );
  }

  /**
   * 公共方法：执行工具调用
   */
  private async executeTool(
    fullToolName: string,
    toolArgs: any,
    toolCallId: string,
    context: ToolRuntime,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    // 通过 ToolRuntime 查表定位工具所属插件
    const resolved = context.resolveTool(fullToolName);
    if (!resolved) {
      throw new Error(`Tool ${fullToolName} is not available or disabled`);
    }

    const { pluginId } = resolved;

    // 验证工具是否存在
    const provider = this.providers.get(pluginId);

    if (!provider) {
      throw new Error(`未知的插件: ${pluginId}`);
    }

    // 检查工具的加载模式
    const metadata = provider.getMetadata(context.injectParams);
    const loadMode = metadata.loadMode || "eager";

    if (loadMode === "none") {
      throw new Error(
        `Tool provider ${pluginId} is disabled (loadMode: none)`,
      );
    }

    // 构造工具调用请求
    const toolRequest: ToolCallRequest = {
      id: toolCallId,
      name: fullToolName,
      arguments: toolArgs,
    };

    try {
      // 提供者只返回内容字符串，异常由这里捕获
      let content = await provider.execute(
        toolRequest,
        context.injectParams,
        abortSignal,
      );

      // 检查结果长度，如果超过 10000 字符则截断
      const MAX_CONTENT_LENGTH = 50000;
      if (content && content.length > MAX_CONTENT_LENGTH) {
        const truncatedContent = content.substring(0, MAX_CONTENT_LENGTH);
        const omittedLength = content.length - MAX_CONTENT_LENGTH;
        content = JSON.stringify({
          warning: `Content truncated. Omitted ${omittedLength} characters. Use other tools or adjust query conditions to view complete content.`,
          tool_truncated: truncatedContent,
          omitted_length: omittedLength,
        });
        this.logger.warn(
          `Tool ${fullToolName} output truncated: ${content.length} chars (original: ${content.length + omittedLength} chars)`,
        );
      }

      return {
        toolCallId,
        name: fullToolName,
        content,
        isError: false,
      };
    } catch (error: any) {
      // 提取错误信息，处理各种异常类型（包括 null、undefined、非 Error 对象）
      let errorMsg: string;
      let errorStack: string | undefined;

      if (error instanceof Error) {
        errorMsg = error.message;
        errorStack = error.stack;
      } else if (error && typeof error === "object" && error.message) {
        errorMsg = error.message;
        errorStack = error.stack;
      } else {
        errorMsg = String(error);
      }

      // 记录详细错误信息，包含堆栈
      const logMessage = `Error executing tool ${fullToolName}: ${errorMsg}`;
      if (errorStack) {
        this.logger.error(logMessage + `\nStack: ${errorStack}`);
      } else {
        this.logger.error(logMessage);
      }

      // 统一封装错误响应
      return {
        toolCallId,
        name: fullToolName,
        content: JSON.stringify({ success: false, message: errorMsg }),
        isError: true,
      };
    }
  }

  async getLocalToolsList(): Promise<ToolMetadata[]> {
    const toolsList: ToolMetadata[] = [];
    const globalToolsConfig = await this.settingsStorage.getSettings("tools");
    for (const [pluginId, provider] of this.providers.entries()) {
      const metadata = provider.getMetadata({});

      // 根据 provider 的 type 字段确定默认值：core 默认启用，extended 默认禁用
      const defaultEnabled = metadata.type !== "extended";
      let isEnabled = defaultEnabled;
      if (typeof globalToolsConfig === "boolean") {
        isEnabled = globalToolsConfig;
      } else if (typeof globalToolsConfig === "object") {
        const config = globalToolsConfig[pluginId];
        if (typeof config === "boolean") {
          isEnabled = config;
        } else if (Array.isArray(config)) {
          isEnabled = true;
        }
        // 未配置时保持 defaultEnabled
      }

      let tools: any[] = [];
      try {
        tools = await provider.getTools(true, {});

        // 工具名由 Provider 保证全局唯一
      } catch (error: any) {
        this.logger.error(
          `Error getting tools from provider ${pluginId}: ${error.message}`,
        );
      }

      const toolMetadata: ToolMetadata = {
        ...metadata,
        name: pluginId,
        enabled: isEnabled,
        tools,
      };

      toolsList.push(toolMetadata);
    }

    return toolsList;
  }
}
