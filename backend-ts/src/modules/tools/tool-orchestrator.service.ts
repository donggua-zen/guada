import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
} from "./interfaces/tool-provider.interface";
import { KnowledgeBaseToolProvider } from "./providers/knowledge-base-tool.provider";
import { MemoryToolProvider } from "./providers/memory-tool.provider";
import { MCPToolProvider } from "./providers/mcp-tool.provider";
import { TimeToolProvider } from "./providers/time-tool.provider";
import { ImageRecognitionToolProvider } from "./providers/image-recognition-tool.provider";
import { ShellToolProvider } from "./providers/shell-tool.provider";
import { BrowserToolProvider } from "./providers/browser-tool.provider";
import { ToolContext } from "./tool-context";
import { SkillToolBridgeService } from '../skills/integration/skill-tool-bridge.service';

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

  constructor(
    kbProvider: KnowledgeBaseToolProvider,
    memoryProvider: MemoryToolProvider,
    mcpProvider: MCPToolProvider,
    timeProvider: TimeToolProvider,
    imageRecognitionProvider: ImageRecognitionToolProvider,
    shellProvider: ShellToolProvider,
    browserProvider: BrowserToolProvider,
    skillToolBridge: SkillToolBridgeService,
  ) {
    this.addProvider(kbProvider);
    this.addProvider(memoryProvider);
    this.addProvider(mcpProvider);
    this.addProvider(timeProvider);
    this.addProvider(imageRecognitionProvider);
    this.addProvider(shellProvider);
    this.addProvider(browserProvider);
    this.addProvider(skillToolBridge);
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

  async getAllTools(context: ToolContext): Promise<any[]> {
    const allTools: any[] = [];
    const toolNames = new Set<string>();

    // 始终添加两个通用工具
    const universalTools = [
      {
        name: "tool_load",
        description: "加载指定工具命名空间的详细说明，获取该类别下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
        parameters: {
          type: "object",
          properties: {
            namespace: {
              type: "string",
              description: "工具命名空间，例如：knowledge_base、memory、shell 等",
            },
          },
          required: ["namespace"],
        },
      },
      {
        name: "tool_call",
        description: "调用任意工具。这是通用的工具调用接口，可以执行系统中所有已注册的工具。",
        parameters: {
          type: "object",
          properties: {
            tool_name: {
              type: "string",
              description: "完整的工具名称，格式为：namespace__tool_name，例如：knowledge_base__search",
            },
            arguments: {
              type: "object",
              description: "工具调用的参数，根据具体工具的要求提供相应的参数对象",
            },
          },
          required: ["tool_name", "arguments"],
        },
      },
    ];

    allTools.push(...universalTools);
    toolNames.add("tool_load");
    toolNames.add("tool_call");

    for (const [namespace, provider] of this.providers.entries()) {
      const config = context.getProviderConfig(namespace);
      if (!config) continue;
      if (config.enabledTools === false) continue;

      const metadata = provider.getMetadata();
      const loadMode = metadata.loadMode || 'eager';

      // 根据加载模式决定是否包含该工具
      if (loadMode === 'lazy') {
        // lazy 模式的工具不在初始 tools 参数中提供
        this.logger.debug(`Skipping lazy-load namespace ${namespace}`);
        continue;
      }

      const tools = await provider.getTools(config.enabledTools);

      const namespacedTools = tools.map(tool => {
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

    this.logger.debug(`Collected ${allTools.length} tools, unique names: ${toolNames.size}`);
    return allTools;
  }

  async getAllToolPrompts(context: ToolContext): Promise<string> {
    const prompts: string[] = [];

    // 第一部分：收集所有提供者的持续注入内容（如记忆内容）
    for (const [namespace, provider] of this.providers.entries()) {
      try {
        const providerConfig = context.getProviderConfig(namespace);
        if (!providerConfig) continue;
        if (providerConfig.enabledTools === false) continue;

        // 如果提供者实现了 getPersistentPrompt，则调用并注入
        if (provider.getPersistentPrompt) {
          const persistentPrompt = await provider.getPersistentPrompt(context.injectParams);
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
        if (providerConfig.enabledTools === false) continue;

        const metadata = provider.getMetadata();
        const loadMode = metadata.loadMode || 'eager';

        // lazy 模式的工具只收集元信息
        if (loadMode === 'lazy') {
          const briefDesc = provider.getBriefDescription
            ? await provider.getBriefDescription()
            : metadata.description;

          metaInfos.push(`- **${metadata.displayName}** (\`${namespace}\`): ${briefDesc}`);
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
        if (providerConfig.enabledTools === false) continue;

        const metadata = provider.getMetadata();
        const loadMode = metadata.loadMode || 'eager';

        // eager 模式的工具直接注入完整提示词
        if (loadMode === 'eager' && namespace !== 'tool_manager') {
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
        "# 可用工具类别",
        "",
        "以下工具需要先调用 `tool_load` 加载详细说明后才能使用。",
        "",
        ...metaInfos,
        "",
        "---",
        "",
      ].join("\n");

      prompts.push(metaSection);

      // 第五部分：添加工具使用指南（针对 lazy 模式）
      const toolGuidePrompt = `# Lazy 模式工具使用指南

## 使用原则

1. **按需加载**：仅在需要实际调用某类工具时才 \`tool_load\`加载详细说明
2. **避免重复**：已了解用法的工具无需重复加载
3. **仅描述不加载**：如用户仅询问能力或功能介绍，无需加载工具说明
4. **执行调用**：加载后根据说明使用 \`tool_call\` 执行具体操作

## 快速示例

\`\`\`json
// 1. 加载工具说明
{ "namespace": "knowledge_base" }

// 2. 执行工具调用
{
  "tool_name": "knowledge_base__search",
  "arguments": { "query": "API文档" }
}
\`\`\``;

      prompts.push(toolGuidePrompt);
    }

    this.logger.debug(`Collected ${prompts.length} tool prompt sections`);
    // this.logger.debug(prompts.join("\n\n"))
    return prompts.join("\n\n");
  }

  async executeBatch(
    requests: ToolCallRequest[],
    context: ToolContext,
  ): Promise<ToolCallResponse[]> {
    const responses: ToolCallResponse[] = [];
    for (const req of requests) {
      try {
        const response = await this.execute(req, context);
        responses.push(response);
      } catch (error: any) {
        this.logger.error(`Error executing tool ${req.name}`, error);
        responses.push({
          toolCallId: req.id,
          name: req.name,
          content: `Error: ${error.message}`,
          isError: true,
        });
      }
    }
    return responses;
  }

  private async execute(
    request: ToolCallRequest,
    context: ToolContext,
  ): Promise<ToolCallResponse> {
    // 特殊处理：拦截通用工具调用
    if (request.name === 'tool_load') {
      return await this.handleToolLoad(request, context);
    }

    if (request.name === 'tool_call') {
      return await this.handleToolCall(request, context);
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
    );
  }

  /**
   * 处理 tool_load 工具调用
   */
  private async handleToolLoad(
    request: ToolCallRequest,
    context: ToolContext,
  ): Promise<ToolCallResponse> {
    try {
      const content = await this.handleActivate(request.arguments, context);

      return {
        toolCallId: request.id,
        name: request.name,
        content,
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

  /**
   * 处理 tool_call 工具调用（通用调用接口）
   */
  private async handleToolCall(
    request: ToolCallRequest,
    context: ToolContext,
  ): Promise<ToolCallResponse> {
    const { tool_name, arguments: toolArgs } = request.arguments;

    if (!tool_name || typeof tool_name !== "string") {
      throw new Error("无效的参数：tool_name 必须是字符串");
    }

    if (!toolArgs || typeof toolArgs !== "object") {
      throw new Error("无效的参数：arguments 必须是对象");
    }

    // 解析工具名称
    const parts = tool_name.split("__");
    if (parts.length < 2) {
      throw new Error(`无效的工具名称格式: ${tool_name}，应为 namespace__tool_name`);
    }

    const namespace = parts[0];
    const coreName = parts.slice(1).join("__");

    // 使用公共方法执行工具调用
    return await this.executeToolByNamespace(
      namespace,
      coreName,
      toolArgs,
      request.id,
      request.name,
      context,
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
  ): Promise<ToolCallResponse> {
    // 验证工具是否存在
    const provider = this.providers.get(namespace);

    if (!provider) {
      throw new Error(`未知的命名空间: ${namespace}`);
    }

    // 检查工具是否启用
    if (!context.isToolEnabled(namespace)) {
      throw new Error(`Tool provider ${namespace} is disabled`);
    }

    // 构造工具调用请求
    const toolRequest: ToolCallRequest = {
      id: toolCallId,
      name: coreName,
      arguments: toolArgs,
    };

    try {
      // 提供者只返回内容字符串，异常由这里捕获
      let content = await provider.execute(toolRequest, context.injectParams);

      // 检查结果长度，如果超过 10000 字符则截断
      const MAX_CONTENT_LENGTH = 500000;
      if (content && content.length > MAX_CONTENT_LENGTH) {
        const truncatedContent = content.substring(0, MAX_CONTENT_LENGTH);
        const omittedLength = content.length - MAX_CONTENT_LENGTH;
        content = JSON.stringify({ 'warning': `Content truncated. Omitted ${omittedLength} characters. Use other tools or adjust query conditions to view complete content.`, 'tool_truncated': truncatedContent, 'omitted_length': omittedLength });
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
      this.logger.error(`Error executing tool ${originalToolName}`, error);
      // 统一封装错误响应
      return {
        toolCallId,
        name: originalToolName,
        content: JSON.stringify({ 'success': false, 'message': error.message }),
        isError: true,
      };
    }
  }

  /**
   * 处理 activate 请求（加载工具说明）
   */
  private async handleActivate(args: any, context: ToolContext): Promise<string> {
    const { namespace } = args;
  
    if (!namespace || typeof namespace !== "string") {
      throw new Error("无效的参数：namespace 必须是字符串");
    }
  
    const provider = this.providers.get(namespace);
  
    if (!provider) {
      const availableNamespaces = Array.from(this.providers.keys()).join(", ");
      throw new Error(
        `未知的命名空间: ${namespace}。可用的命名空间: ${availableNamespaces}`
      );
    }

    // 获取该命名空间的配置
    const providerConfig = context.getProviderConfig(namespace);
    if (!providerConfig) {
      throw new Error(`未找到命名空间 ${namespace} 的配置`);
    }
    if (providerConfig.enabledTools === false) {
      throw new Error(`工具提供者 ${namespace} 已禁用`);
    }
  
    // 根据配置获取可用的工具
    const tools = await provider.getTools(providerConfig.enabledTools);
  
    // 构建详细的工具说明
    const toolDescriptions = tools.map((tool: any) => {
      const fullName = `${namespace}__${tool.name}`;
      const params = tool.parameters?.properties || {};
      const required = tool.parameters?.required || [];
  
      const paramList = Object.entries(params)
        .map(([key, value]: [string, any]) => {
          const isRequired = required.includes(key) ? "（必填）" : "（可选）";
          return `  - ${key}: ${value.description || "无描述"} ${isRequired}`;
        })
        .join("\n");
  
      return [
        `### ${fullName}`,
        `**功能**: ${tool.description}`,
        `**参数**:\n${paramList}`,
        "",
      ].join("\n");
    }).join("\n");
  
    // 获取工具使用说明（如果提供者实现了 getPrompt）
    let toolUsagePrompt = "";
    try {
      toolUsagePrompt = await provider.getPrompt(context.injectParams);
    } catch (error: any) {
      this.logger.warn(`Failed to get prompt for namespace ${namespace}: ${error.message}`);
    }
  
    const responseParts: string[] = [
      `# ${namespace} 工具集详细说明`,
      "",
      `该命名空间包含以下 ${tools.length} 个工具：`,
      "",
      toolDescriptions,
    ];
  
    // 如果有工具使用说明，添加到响应中
    if (toolUsagePrompt) {
      responseParts.push("---", "", toolUsagePrompt);
    }
  
    responseParts.push(
      "---",
      "",
      "**使用方式**:",
      "直接调用工具，格式为：`namespace__tool_name`,或者使用`tool_call`间接调用",
      "",
      "现在你可以根据上述说明调用相应的工具了。"
    );
  
    return responseParts.join("\n");
  }

  async getLocalToolsList(userId: string, settings: any): Promise<ToolMetadata[]> {
    const toolsList: ToolMetadata[] = [];
    const globalToolsConfig = settings?.tools;

    for (const [namespace, provider] of this.providers.entries()) {
      const metadata = provider.getMetadata();

      if (metadata.isMcp) {
        continue;
      }

      // 判断该工具是否启用
      let isEnabled = false;
      if (globalToolsConfig === true) {
        // 全局启用所有工具
        isEnabled = true;
      } else if (globalToolsConfig === false) {
        // 全局禁用所有工具
        isEnabled = false;
      } else if (typeof globalToolsConfig === 'object') {
        // 单独配置：优先使用 namespace 配置，否则默认为 true
        isEnabled = globalToolsConfig[namespace] !== false;
      } else {
        // 默认启用
        isEnabled = true;
      }

      let tools: any[] = [];
      try {
        tools = await provider.getTools(true);

        const namespacedTools = tools.map(tool => ({
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
