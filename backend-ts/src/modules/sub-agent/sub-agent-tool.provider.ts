import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
} from "../tools/interfaces/tool-provider.interface";
import { SubAgentManager } from "./sub-agent.manager";

/**
 * 子代理工具提供者
 *
 * 提供子代理相关工具：
 * - subagent_spawn：创建子代理并启动，返回结果
 * - subagent_wait：等待子代理完成并返回结果（阻塞）
 * - subagent_close：关闭指定子代理
 * - subagent_list：获取子代理列表
 * - subagent_send_message：向子代理发送消息
 */
@Injectable()
export class SubAgentToolProvider implements IToolProvider {
  private readonly logger = new Logger(SubAgentToolProvider.name);
  public readonly pluginId = "sub_agent";

  constructor(private subAgentManager: SubAgentManager) {}

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    if (enabled === false) return [];
    const allTools = [
      {
        name: "subagent_spawn",
        description: `创建一个子代理独立执行指定任务。
子代理拥有独立的对话上下文和工具能力，创建后立即返回子会话ID。`,
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: '子代理的名称（简洁明了，如"财报分析"、"代码生成"）' },
            task: { type: "string", description: "子代理需要完成的具体任务描述（越详细越好）" },
            characterId: { type: "string", description: "角色ID（可选）" },
            mode: { type: "string", description: "执行模式：foreground 或 background", enum: ["foreground", "background"] },
          },
          required: ["name", "task"],
        },
      },
      {
        name: "subagent_wait",
        description: "等待子代理执行完成并返回结果摘要",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "subagent_close",
        description: "关闭指定子代理并删除其会话数据",
        parameters: {
          type: "object",
          properties: { sessionId: { type: "string", description: "要关闭的子代理会话 ID" } },
          required: ["sessionId"],
        },
      },
      {
        name: "subagent_list",
        description: "获取当前父会话下所有子代理列表",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "subagent_send_message",
        description: "向已存在的子代理发送消息继续交互",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "子代理会话 ID" },
            message: { type: "string", description: "要发送给子代理的消息内容" },
          },
          required: ["sessionId", "message"],
        },
      },
    ];
    if (Array.isArray(enabled)) return allTools.filter(t => enabled.includes(t.name));
    return allTools;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>, abortSignal?: AbortSignal): Promise<string> {
    const handler = ({
      subagent_spawn: () => this.handleSpawn(request.arguments, context, abortSignal),
      subagent_wait: () => this.handleWait(request.arguments, context, abortSignal),
      subagent_close: () => this.handleClose(request.arguments, context),
      subagent_list: () => this.handleList(request.arguments, context),
      subagent_send_message: () => this.handleSendMessage(request.arguments, context, abortSignal),
    } as Record<string, () => Promise<string>>)[request.name];

    if (!handler) throw new Error(`未知工具: ${request.name}`);
    return handler();
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return `# 子代理工具

你可以使用以下工具来管理子代理：

## subagent_spawn
创建子代理独立执行任务。子代理拥有独立的对话上下文和工具能力。

**何时使用**：
- 需要并行处理多个独立任务
- 有一个耗时任务需要异步执行
- 需要隔离不同任务的上下文

## subagent_wait
等待当前会话创建的子代理执行完成并返回结果。

## subagent_close
关闭指定子代理。

## subagent_list
获取当前所有子代理列表。

## subagent_send_message
向已存在的子代理发送新消息继续交互。`;
  }

  getMetadata(): ToolProviderMetadata {
    return {
      pluginId: "sub_agent",
      displayName: "子代理",
      description: "创建和管理子代理执行独立任务",
      isMcp: false,
  
      type: "core",
      promptFrequency: "REGULAR",
    };
  }

  private async handleSpawn(args: any, context?: any, abortSignal?: AbortSignal): Promise<string> {
    this.logger.log(`创建子 Agent: ${args.name}, 父会话: ${context?.sessionId}`);
    const result = await this.subAgentManager.spawn(
      {
        parentSessionId: context?.sessionId,
        userId: context?.userId,
        name: args.name,
        task: args.task,
        characterId: args.characterId,
      },
      args.mode || "foreground",
      abortSignal,
    );
    return JSON.stringify({
      success: true,
      sessionId: result.subSessionId,
      status: result.status,
      content: result.status === "completed" ? result.content : undefined,
      message: result.status === "running" ? "子代理已创建并开始执行，请使用 wait 获取结果" : "子代理执行完成",
    });
  }

  private async handleWait(args: any, context?: any, abortSignal?: AbortSignal): Promise<string> {
    this.logger.log(`等待子代理完成: 父会话 ${context?.sessionId}`);
    const completed = await this.subAgentManager.waitForComplete(context?.sessionId, 120000, abortSignal);
    if (completed.length === 0) return JSON.stringify({ success: true, message: "没有进行中的子代理任务" });
    return JSON.stringify({
      success: true,
      completedSubAgents: completed.map(c => ({
        sessionId: c.subSessionId, name: c.name, status: c.result.status,
        content: c.result.content, reasoningContent: c.result.reasoningContent,
        finishReason: c.result.finishReason,
      })),
      message: `以下子代理已完成: ${completed.map(c => c.name).join(", ")}`,
    });
  }

  private async handleClose(args: any, context?: any): Promise<string> {
    try {
      await this.subAgentManager.closeSubAgent(args.sessionId, context?.sessionId, context?.userId, context?.workspacePath);
      return JSON.stringify({ success: true, message: "子代理已关闭并删除" });
    } catch (e: any) {
      return JSON.stringify({ success: false, message: e.message || "关闭子代理失败" });
    }
  }

  private async handleList(args: any, context?: any): Promise<string> {
    const agents = await this.subAgentManager.getSubAgents(context?.sessionId);
    return JSON.stringify({ success: true, sub_agents: agents, total: agents.length });
  }

  private async handleSendMessage(args: any, context?: any, abortSignal?: AbortSignal): Promise<string> {
    try {
      const result = await this.subAgentManager.sendMessage(
        { parentSessionId: context?.sessionId, userId: context?.userId, sessionId: args.sessionId, message: args.message },
        "foreground", abortSignal,
      );
      return JSON.stringify({
        success: true, sessionId: result.subSessionId, status: result.status,
        content: result.status === "completed" ? result.content : undefined,
        message: result.status === "running" ? "消息已发送，子代理开始执行，请使用 wait 获取结果" : "子代理执行完成",
      });
    } catch (e: any) {
      return JSON.stringify({ success: false, message: e.message || "发送消息失败" });
    }
  }
}
