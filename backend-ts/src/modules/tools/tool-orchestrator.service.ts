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
import { ToolContext } from "./tool-context";

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
  ) {
    this.addProvider(kbProvider);
    this.addProvider(memoryProvider);
    this.addProvider(mcpProvider);
    this.addProvider(timeProvider);
    this.addProvider(imageRecognitionProvider);
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
    
    for (const [namespace, provider] of this.providers.entries()) {
      const config = context.getProviderConfig(namespace);
      if (!config) continue;
      if (config.enabledTools === false) continue;
      
      const tools = await provider.getTools(config.enabledTools);
      
      const namespacedTools = tools.map(tool => ({
        ...tool,
        name: `${namespace}__${tool.name}`,
      }));
      
      allTools.push(...namespacedTools);
    }
    
    this.logger.debug(`Collected ${allTools.length} tools`);
    return allTools;
  }

  async getAllToolPrompts(context: ToolContext): Promise<string> {
    const prompts: string[] = [];

    for (const [namespace, provider] of this.providers.entries()) {
      try {
        const providerConfig = context.getProviderConfig(namespace);
        if (!providerConfig) continue;
        if (providerConfig.enabledTools === false) continue;

        const prompt = await provider.getPrompt(context.injectParams);
        if (prompt) {
          prompts.push(prompt);
        }
      } catch (error: any) {
        this.logger.error(
          `Error getting prompt from provider ${namespace}: ${error.message}`,
        );
      }
    }

    this.logger.debug(`Collected ${prompts.length} tool prompt injections`);
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
          role: "tool",
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
    const parts = request.name.split("__");
    if (parts.length < 2) {
      throw new Error(`Invalid tool name format: ${request.name}`);
    }
    
    const namespace = parts[0];
    const coreName = parts.slice(1).join("__");
    
    const provider = this.providers.get(namespace);

    if (!provider) {
      throw new Error(
        `No provider found for namespace: ${namespace}`,
      );
    }

    if (!context.isToolEnabled(namespace)) {
      throw new Error(`Tool provider ${namespace} is disabled`);
    }

    const strippedRequest: ToolCallRequest = {
      ...request,
      name: coreName,
    };

    try {
      // 提供者只返回内容字符串，异常由这里捕获
      const content = await provider.execute(strippedRequest, context.injectParams);
      
      return {
        toolCallId: request.id,
        role: "tool",
        name: request.name,
        content,
        isError: false,
      };
    } catch (error: any) {
      this.logger.error(`Error executing tool ${request.name}`, error);
      // 统一封装错误响应
      return {
        toolCallId: request.id,
        role: "tool",
        name: request.name,
        content: `Error: ${error.message}`,
        isError: true,
      };
    }
  }

  async getLocalToolsList(userId: string, settings: any): Promise<ToolMetadata[]> {
    const toolsList: ToolMetadata[] = [];

    for (const [namespace, provider] of this.providers.entries()) {
      const metadata = provider.getMetadata();
      
      if (metadata.isMcp) {
        continue;
      }

      const providerConfig = settings?.tools || {};
      const isEnabled = providerConfig[namespace] !== false;

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
