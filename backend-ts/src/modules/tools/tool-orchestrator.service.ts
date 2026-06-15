import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolDisplayInfo,
  ToolDefinition,
} from "./interfaces/tool-provider.interface";

import {
  UniversalToolHandler,
  UNIVERSAL_TOOLS,
} from "./universal-tool-handler";
import { ToolRuntime } from "./tool-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

/**
 * 获取指定命名空间的工具启用配置
 * @param toolsConfig 角色工具配置
 * @param mcpServersConfig MCP 服务器配置
 * @param namespace 命名空间
 * @param isMcp 是否为 MCP 工具
 * @returns 启用配置（boolean | string[]）
 */
function getEnabledConfig(
  toolsConfig: any,
  mcpServersConfig: any,
  namespace: string,
  isMcp: boolean,
): boolean | string[] {
  if (isMcp) {
    return mcpServersConfig;
  }
  if (toolsConfig === true) {
    return true;
  }
  return toolsConfig?.[namespace] || false;
}

export interface ToolMetadata {
  namespace: string;
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
    if (provider.namespace) {
      this.providers.set(provider.namespace, provider);
      this.logger.log(`Added tool provider: ${provider.namespace}`);
    }
  }

  /**
   * 获取所有工具提供者（用于动态配置）
   */
  getProviders(): Map<string, IToolProvider> {
    return this.providers;
  }

  /**
   * 获取指定命名空间的工具提供者
   */
  getProvider(namespace: string): IToolProvider | undefined {
    return this.providers.get(namespace);
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
          args: request.arguments?.namespace,
          toolName: request.name,
          toolType: "generic",
        };
      }
      if (request.name === "tool_load") {
        return {
          action: isExecuting ? "正在加载工具" : "已加载工具",
          args: request.arguments?.namespace,
          toolName: request.name,
          toolType: "generic",
        };
      }

      // 解析工具名称获取命名空间
      const namespace = runtime?.resolveNamespace(request.name) || request.name;
      const provider = this.providers.get(namespace);

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
            toolType: namespace,
          };
        }

        // 如果没有显式指定 toolType，使用 namespace 作为默认值
        if (!result.toolType) {
          result.toolType = namespace;
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
    eagerNamespaces?: string[],
  ): Promise<ToolRuntime> {
    // 获取全局启用的工具列表，与角色配置取交集
    const globalTools = await this.getLocalToolsList();
    const globalEnabledNamespaces = new Set(
      globalTools.filter((t) => t.enabled).map((t) => t.namespace),
    );

    const groupedTools: Record<string, ToolDefinition[]> = {};
    const lazyTools: Record<string, ToolDefinition[]> = {};
    const toolNames = new Set<string>();

    for (const [namespace, provider] of this.providers.entries()) {
      // 全局未启用的命名空间直接跳过
      if (!globalEnabledNamespaces.has(namespace)) continue;

      const metadata = provider.getMetadata(injectParams);
      const enabled = getEnabledConfig(
        toolsConfig,
        mcpServersConfig,
        namespace,
        metadata.isMcp,
      );
      if (!enabled) continue;

      // 如果指定了强制 eager 的命名空间，则覆盖 loadMode
      const forceEager = eagerNamespaces?.includes(namespace);
      const loadMode = forceEager ? "eager" : (metadata.loadMode || "eager");

      // 根据加载模式决定是否包含该工具
      if (loadMode === "none") {
        this.logger.debug(
          `Skipping disabled namespace ${namespace} (loadMode: none)`,
        );
        continue;
      }

      const providerTools = await provider.getTools(enabled, injectParams);

      const namespacedTools = providerTools.map((tool) => {
        if (toolNames.has(tool.name)) {
          this.logger.warn(`Duplicate tool name detected: ${tool.name}`);
        }
        toolNames.add(tool.name);

        return tool;
      });

      if (loadMode === "lazy") {
        this.logger.debug(`Recording lazy-load namespace ${namespace}`);
        lazyTools[namespace] = namespacedTools;
      } else {
        groupedTools[namespace] = namespacedTools;
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
      `Collected ${flatCount} tools in ${Object.keys(groupedTools).length} namespaces, unique names: ${toolNames.size}`,
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
    const enabledNamespaces = new Set(Object.keys(groupedTools));
    const lazyNamespaces = new Set(Object.keys(lazyTools));

    const prompts: string[] = [];

    for (const namespace of [...enabledNamespaces, ...lazyNamespaces]) {
      const provider = this.providers.get(namespace);

      if (!provider) continue;
      if (provider.getPersistentPrompt) {
        const persistentPrompt =
          await provider.getPersistentPrompt(injectParams);
        if (persistentPrompt) {
          prompts.push(persistentPrompt);
        }
      }
      if (!lazyNamespaces.has(namespace)) {
        const prompt = await provider.getPrompt(injectParams);
        if (prompt) {
          prompts.push(prompt);
        }
      }
    }
    const metaInfos: string[] = [];
    for (const namespace of lazyNamespaces) {
      const provider = this.providers.get(namespace);
      if (!provider) continue;
      const metadata = provider.getMetadata(injectParams);

      const briefDesc = provider.getBriefDescription
        ? await provider.getBriefDescription(injectParams)
        : metadata.description;
      if (briefDesc) {
        metaInfos.push(`- ${namespace}:${metadata.displayName},${briefDesc}`);
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
      prompts.push(metaSection);
      const toolGuidePrompt = `## 使用原则
      
1. **避免重复**：已了解用法的工具无需重复加载
2. **仅描述不加载**：如用户仅询问能力或功能介绍，无需加载工具说明
3. **执行调用**：加载后根据说明使用 \`tool_call\` 执行具体操作
`;

      prompts.push(toolGuidePrompt);
    }

    this.logger.debug(`Collected ${prompts.length} tool prompt sections`);
    // this.logger.debug(prompts.join("\n\n"))
    return prompts.join("\n\n");
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
        (ns) => this.getProvider(ns),
        (ns) => Object.keys(context.lazyTools).some((key) => key === ns),
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
    // 通过 ToolRuntime 查表定位工具所属命名空间
    const resolved = context.resolveTool(fullToolName);
    if (!resolved) {
      throw new Error(`Tool ${fullToolName} is not available or disabled`);
    }

    const { namespace } = resolved;

    // 验证工具是否存在
    const provider = this.providers.get(namespace);

    if (!provider) {
      throw new Error(`未知的命名空间: ${namespace}`);
    }

    // 检查工具的加载模式
    const metadata = provider.getMetadata(context.injectParams);
    const loadMode = metadata.loadMode || "eager";

    if (loadMode === "none") {
      throw new Error(
        `Tool provider ${namespace} is disabled (loadMode: none)`,
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
    const globalToolsConfig = this.settingsStorage.getSettings("tools");

    for (const [namespace, provider] of this.providers.entries()) {
      const metadata = provider.getMetadata({});

      // 根据 provider 的 type 字段确定默认值：core 默认启用，extended 默认禁用
      const defaultEnabled = metadata.type !== "extended";
      let isEnabled = defaultEnabled;
      if (typeof globalToolsConfig === "boolean") {
        isEnabled = globalToolsConfig;
      } else if (typeof globalToolsConfig === "object") {
        const config = globalToolsConfig[namespace];
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

        // 工具名不再拼接命名空间前缀，由 Provider 保证全局唯一
      } catch (error: any) {
        this.logger.error(
          `Error getting tools from provider ${namespace}: ${error.message}`,
        );
      }

      const toolMetadata: ToolMetadata = {
        ...metadata,
        name: namespace,
        enabled: isEnabled,
        tools,
      };

      toolsList.push(toolMetadata);
    }

    return toolsList;
  }
}
