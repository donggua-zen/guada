import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolDisplayInfo,
} from "./interfaces/tool-provider.interface";
import { ToolContext } from "./tool-context";
import {
  UniversalToolHandler,
  UNIVERSAL_TOOLS,
} from "./universal-tool-handler";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

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
   * @param isStreaming 是否处于流式状态
   * @returns 结构化的展示信息
   */
  generateDisplayMessage(
    request: ToolCallRequest,
    isStreaming: boolean = true,
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
            isStreaming,
          );
        }
        return {
          action: isStreaming ? "正在调用工具" : "已调用工具",
          args: request.arguments?.namespace,
          toolName: request.name,
          toolType: "generic",
        };
      }
      if (request.name === "tool_load") {
        return {
          action: isStreaming ? "正在加载工具" : "已加载工具",
          args: request.arguments?.namespace,
          toolName: request.name,
          toolType: "generic",
        };
      }

      // 解析工具名称获取命名空间
      const parts = request.name.split("__");
      if (parts.length < 2) {
        // 如果不是标准格式，尝试直接查找
        return this.generateGenericDisplayInfo(
          request.name,
          request.arguments,
          isStreaming,
        );
      }

      const namespace = parts[0];
      const coreName = parts.slice(1).join("__");

      const provider = this.providers.get(namespace);

      if (provider && typeof provider.formatDisplayMessage === "function") {
        // 如果提供者返回的是字符串，转换为结构化数据
        const result = provider.formatDisplayMessage(
          coreName,
          request.arguments,
          isStreaming,
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
        isStreaming,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to generate display message for ${request.name}:`,
        error,
      );
      return {
        action: isStreaming ? "正在调用工具" : "已调用工具",
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
    isStreaming: boolean,
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

    const namespace = toolName.split("__")[0] || "generic";

    return {
      action: `${readableName}`,
      args: argsSummary,
      toolName: toolName,
      toolType: namespace,
    };
  }

  async getAllTools(context: ToolContext): Promise<any[]> {
    const allTools: any[] = [];
    const toolNames = new Set<string>();
    let lazyTools: number = 0;

    for (const [namespace, provider] of this.providers.entries()) {
      const config = context.getProviderConfig(namespace);
      if (!config) continue;
      if (!config.enabledTools) continue;

      const metadata = provider.getMetadata(context.injectParams);
      const loadMode = metadata.loadMode || "eager";

      // 根据加载模式决定是否包含该工具
      if (loadMode === "none") {
        // none 模式的工具完全不加载
        this.logger.debug(
          `Skipping disabled namespace ${namespace} (loadMode: none)`,
        );
        continue;
      }

      if (loadMode === "lazy") {
        // lazy 模式的工具不在初始 tools 参数中提供
        this.logger.debug(`Skipping lazy-load namespace ${namespace}`);
        lazyTools++;
        continue;
      }

      const tools = await provider.getTools(
        config.enabledTools,
        context.injectParams,
      );

      const namespacedTools = tools.map((tool) => {
        const fullName = `${namespace}__${tool.name}`;

        // 检查重复
        if (toolNames.has(fullName)) {
          this.logger.warn(`Duplicate tool name detected: ${fullName}`);
        }
        toolNames.add(fullName);

        return {
          ...tool,
          name: fullName,
        };
      });

      allTools.push(...namespacedTools);
    }

    if (lazyTools > 0) {
      // 始终添加两个通用工具
      allTools.push(...UNIVERSAL_TOOLS);
      toolNames.add("tool_load");
      toolNames.add("tool_call");
    }
    this.logger.debug(
      `Collected ${allTools.length} tools, unique names: ${toolNames.size}`,
    );
    return allTools;
  }

  async getAllToolPrompts(context: ToolContext): Promise<string> {
    const prompts: string[] = [];

    // 第一部分：收集所有提供者的持续注入内容（如记忆内容）
    for (const [namespace, provider] of this.providers.entries()) {
      try {
        const providerConfig = context.getProviderConfig(namespace);
        if (!providerConfig) continue;
        if (!providerConfig.enabledTools) continue;

        // 如果提供者实现了 getPersistentPrompt，则调用并注入
        if (provider.getPersistentPrompt) {
          const persistentPrompt = await provider.getPersistentPrompt(
            context.injectParams,
          );
          if (persistentPrompt) {
            prompts.push(persistentPrompt);
          }
        }
      } catch (error: any) {
        this.logger.error(
          `Error getting persistent prompt from provider ${namespace}: ${error.message}`,
        );
      }
    }

    // 第二部分：收集 lazy 模式工具的元信息
    const metaInfos: string[] = [];

    for (const [namespace, provider] of this.providers.entries()) {
      try {
        const providerConfig = context.getProviderConfig(namespace);
        if (!providerConfig) continue;
        if (!providerConfig.enabledTools) continue;

        const metadata = provider.getMetadata(context.injectParams);
        const loadMode = metadata.loadMode || "eager";

        // none 模式的工具不收集任何信息
        if (loadMode === "none") {
          continue;
        }

        // lazy 模式的工具只收集元信息
        if (loadMode === "lazy") {
          const briefDesc = provider.getBriefDescription
            ? await provider.getBriefDescription(context.injectParams)
            : metadata.description;

          metaInfos.push(`- ${namespace}:${metadata.displayName},${briefDesc}`);
        }
      } catch (error: any) {
        this.logger.error(
          `Error getting metadata from provider ${namespace}: ${error.message}`,
        );
      }
    }

    // 第三部分：为 eager 模式的工具注入传统提示词
    for (const [namespace, provider] of this.providers.entries()) {
      try {
        const providerConfig = context.getProviderConfig(namespace);
        if (!providerConfig) continue;
        if (!providerConfig.enabledTools) continue;

        const metadata = provider.getMetadata(context.injectParams);
        const loadMode = metadata.loadMode || "eager";

        // none 模式的工具不注入提示词
        if (loadMode === "none") {
          continue;
        }

        // eager 模式的工具直接注入完整提示词
        if (loadMode === "eager" && namespace !== "tool_manager") {
          const prompt = await provider.getPrompt(context.injectParams);
          if (prompt) {
            prompts.push(prompt);
          }
        }
      } catch (error: any) {
        this.logger.error(
          `Error getting prompt from provider ${namespace}: ${error.message}`,
        );
      }
    }

    // 第四部分：添加 lazy 模式工具的元信息章节
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

      // 第五部分：添加工具使用指南（针对 lazy 模式）
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
    context: ToolContext,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse[]> {
    const responses: ToolCallResponse[] = [];
    for (const req of requests) {
      try {
        // 检查是否已中止
        if (abortSignal?.aborted) {
          this.logger.warn(
            `Tool execution aborted before starting: ${req.name}`,
          );
          responses.push({
            toolCallId: req.id,
            name: req.name,
            content: "Error: Request was aborted",
            isError: true,
          });
          continue;
        }

        const response = await this.execute(req, context, abortSignal);
        responses.push(response);
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        this.logger.error(`Error executing tool ${req.name}: ${errorMsg}`);
        responses.push({
          toolCallId: req.id,
          name: req.name,
          content: `Error: ${errorMsg}`,
          isError: true,
        });
      }
    }
    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolContext,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
    // 特殊处理：拦截通用工具调用
    if (request.name === "tool_load") {
      return await this.universalHandler.handleToolLoad(
        request,
        context,
        (ns) => this.getProvider(ns),
        (ns) => context.getProviderConfig(ns),
      );
    }

    if (request.name === "tool_call") {
      // 解析 tool_call 参数
      const { namespace, coreName, toolArgs } =
        this.universalHandler.parseToolCall(request);

      // 由编排器统一执行
      return await this.executeToolByNamespace(
        namespace,
        coreName,
        toolArgs,
        request.id,
        request.name,
        context,
        abortSignal,
      );
    }

    const parts = request.name.split("__");
    if (parts.length < 2) {
      throw new Error(`Invalid tool name format: ${request.name}`);
    }

    const namespace = parts[0];
    const coreName = parts.slice(1).join("__");

    // 使用公共方法执行工具调用
    return await this.executeToolByNamespace(
      namespace,
      coreName,
      request.arguments,
      request.id,
      request.name,
      context,
      abortSignal,
    );
  }

  /**
   * 公共方法：根据命名空间执行工具调用
   */
  private async executeToolByNamespace(
    namespace: string,
    coreName: string,
    toolArgs: any,
    toolCallId: string,
    originalToolName: string,
    context: ToolContext,
    abortSignal?: AbortSignal,
  ): Promise<ToolCallResponse> {
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

    // 检查工具是否启用
    const providerConfig = context.getProviderConfig(namespace);
    if (!providerConfig) {
      throw new Error(`Tool provider ${namespace} configuration not found`);
    }

    // 粗粒度判断：如果 enabledTools 为 false，则整个命名空间禁用
    if (providerConfig.enabledTools === false) {
      throw new Error(`Tool provider ${namespace} is disabled`);
    }

    // 精细粒度判断：通过 getTools 获取实际可用的工具列表
    // 这样可以处理 MCP 特殊逻辑以及 Provider 内部的动态禁用逻辑
    const availableTools = await provider.getTools(
      providerConfig.enabledTools,
      context.injectParams,
    );
    const isToolAvailable = availableTools.some(
      (tool) => tool.name === coreName,
    );

    if (!isToolAvailable) {
      throw new Error(
        `Tool ${coreName} is not available or disabled in namespace ${namespace}`,
      );
    }

    // 构造工具调用请求
    const toolRequest: ToolCallRequest = {
      id: toolCallId,
      name: coreName,
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
          `Tool ${originalToolName} output truncated: ${content.length} chars (original: ${content.length + omittedLength} chars)`,
        );
      }

      return {
        toolCallId,
        name: originalToolName,
        content,
        isError: false,
      };
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      this.logger.error(`Error executing tool ${originalToolName}: ${errorMsg}`);
      // 统一封装错误响应
      return {
        toolCallId,
        name: originalToolName,
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
      if (globalToolsConfig === true) {
        isEnabled = true;
      } else if (globalToolsConfig === false) {
        isEnabled = false;
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

        const namespacedTools = tools.map((tool) => ({
          ...tool,
          name: `${namespace}__${tool.name}`,
        }));

        tools = namespacedTools;
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
