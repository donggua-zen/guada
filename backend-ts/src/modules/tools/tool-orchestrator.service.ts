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
import { ToolContext } from "./tool-context";

@Injectable()
export class ToolOrchestrator {
  private readonly logger = new Logger(ToolOrchestrator.name);
  private providers = new Map<string, IToolProvider>();

  constructor(
    kbProvider: KnowledgeBaseToolProvider,
    memoryProvider: MemoryToolProvider,
    mcpProvider: MCPToolProvider,
    timeProvider: TimeToolProvider,
  ) {
    this.addProvider(kbProvider);
    this.addProvider(memoryProvider);
    this.addProvider(mcpProvider);
    this.addProvider(timeProvider);
  }

  addProvider(provider: IToolProvider) {
    if (provider.namespace) {
      this.providers.set(provider.namespace, provider);
      this.logger.log(`Added tool provider: ${provider.namespace}`);
    }
  }

  async getAllTools(context: ToolContext): Promise<any[]> {
    const allTools: any[] = [];
    for (const [namespace, provider] of this.providers.entries()) {
      const config = context.getProviderConfig(namespace);
      if (!config) continue;
      if (config.enabledTools === false) continue;
      const tools = await provider.getToolsNamespaced(
        config.enabledTools,
        context.injectParams,
      );
      allTools.push(...tools);
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
    const namespace = request.name.split("__")[0];
    const provider = this.providers.get(namespace);

    if (!provider) {
      throw new Error(
        `${request.name} No provider found for namespace: ${namespace}`,
      );
    }

    if (!context.isToolEnabled(namespace)) {
      throw new Error(`${request.name} Tool provider ${namespace} is disabled`);
    }

    return provider.executeWithNamespace(request, context.injectParams);
  }
}
