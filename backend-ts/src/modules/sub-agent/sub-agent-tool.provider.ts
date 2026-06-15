import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
} from "../tools/interfaces/tool-provider.interface";
import { SubAgentManager } from "./sub-agent.manager";

/**
 * 子代理工具提供者
 *
 * 提供 create 和 wait 工具：
 * - create：创建子代理并启动，返回结果
 * - wait：等待子代理完成并返回结果（阻塞）
 */
@Injectable()
export class SubAgentToolProvider implements IToolProvider {
  private readonly logger = new Logger(SubAgentToolProvider.name);
  public readonly namespace = "sub_agent";

  constructor(private subAgentManager: SubAgentManager) {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    // 禁止子代理再创建子 Agent（防止递归）
    if (context?.sessionType === "sub_agent") {
      return [];
    }

    return [
      {
        name: "subagent_create",
        description: `创建一个子代理独立执行指定任务。
子代理拥有独立的对话上下文和工具能力，创建后立即返回子会话ID。
如需获取结果，请使用 wait 工具等待完成。
适用于：需要独立研究的复杂问题、多步骤分析、代码生成等。

**角色驱动模式**：如果指定 characterId，子代理将继承该角色的完整设定（系统提示词、工具权限、模型参数等），以该角色身份执行任务。适用于团队协作场景。

使用示例：
1. 通用模式：调用 create(name="分析", task="分析数据") 创建子Agent
2. 角色模式：调用 create(name="编剧", characterId="ch_xxx", task="写剧本") 以角色身份创建子Agent
3. （可选）继续其他工作
4. 调用 wait 获取结果`,
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: '子代理的名称（简洁明了，如"财报分析"、"代码生成"）',
            },
            task: {
              type: "string",
              description:
                "子代理需要完成的具体任务描述（越详细越好，包含所有必要的背景信息）",
            },
            characterId: {
              type: "string",
              description:
                "角色ID（可选）。传入后子代理将继承该角色的完整设定，以角色身份执行任务。在团队协作场景中，使用团队成员的角色ID创建对应子代理",
            },
            mode: {
              type: "string",
              description:
                "执行模式：foreground（前台，阻塞等待结果，默认）或 background（后台，立即返回，后续用 wait 获取）",
              enum: ["foreground", "background"],
            },
          },
          required: ["name", "task"],
        },
      },
      {
        name: "subagent_wait",
        description: `等待子代理执行完成并返回结果摘要。
必须在调用 create 后使用。
如果同一会话下有任意子代理已完成，立即返回结果；否则阻塞等待直到完成或超时。`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "subagent_close",
        description: `关闭指定子代理并删除其会话数据。
仅允许关闭已完成的子 Agent，正在运行中的子代理无法关闭。`,
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "要关闭的子代理会话 ID",
            },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "subagent_list",
        description: `获取当前父会话下所有子代理列表，包含每个子代理的状态（running / completed / error）。`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "subagent_send_message",
        description: `向已存在的子代理发送消息继续交互。
仅当子代理已完成时才能发送，否则报错。`,
        parameters: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "子代理会话 ID",
            },
            message: {
              type: "string",
              description: "要发送给子代理的消息内容",
            },
          },
          required: ["sessionId", "message"],
        },
      },
    ];
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const params = request.arguments;

    if (request.name === "subagent_create") {
      this.logger.log(
        `创建子 Agent: ${params.name}, 父会话: ${context?.sessionId}`,
      );

      const result = await this.subAgentManager.spawn(
        {
          parentSessionId: context?.sessionId,
          userId: context?.userId,
          name: params.name,
          task: params.task,
          characterId: params.characterId,
        },
        params.mode || "foreground",
        abortSignal,
      );

      return JSON.stringify({
        success: true,
        sessionId: result.subSessionId,
        status: result.status,
        content: result.status === "completed" ? result.content : undefined,
        message:
          result.status === "running"
            ? "子代理已创建并开始执行，请使用 wait 获取结果"
            : "子代理执行完成",
      });
    }

    if (request.name === "subagent_wait") {
      this.logger.log(`等待子代理完成: 父会话 ${context?.sessionId}`);

      const completed = await this.subAgentManager.waitForComplete(
        context?.sessionId,
        120000,
        abortSignal,
      );

      if (completed.length === 0) {
        return JSON.stringify({
          success: true,
          message: "没有进行中的子代理任务",
        });
      }

      return JSON.stringify({
        success: true,
        completedSubAgents: completed.map((c) => ({
          sessionId: c.subSessionId,
          name: c.name,
          status: c.result.status,
          content: c.result.content,
          reasoningContent: c.result.reasoningContent,
          finishReason: c.result.finishReason,
        })),
        message: `以下子代理已完成: ${completed.map((c) => c.name).join(", ")}`,
      });
    }

    if (request.name === "subagent_close") {
      this.logger.log(`关闭子 Agent: ${params.sessionId}`);

      try {
        await this.subAgentManager.closeSubAgent(
          params.sessionId,
          context?.sessionId,
          context?.userId,
          context?.workspacePath,
        );
        return JSON.stringify({
          success: true,
          message: "子代理已关闭并删除",
        });
      } catch (error: any) {
        return JSON.stringify({
          success: false,
          message: error.message || "关闭子代理失败",
        });
      }
    }

    if (request.name === "subagent_list") {
      const agents = await this.subAgentManager.getSubAgents(
        context?.sessionId,
      );
      return JSON.stringify({
        success: true,
        sub_agents: agents,
        total: agents.length,
      });
    }

    if (request.name === "subagent_send_message") {
      this.logger.log(
        `向子代理发送消息: ${params.sessionId}, 父会话: ${context?.sessionId}`,
      );

      try {
        const result = await this.subAgentManager.sendMessage(
          {
            parentSessionId: context?.sessionId,
            userId: context?.userId,
            sessionId: params.sessionId,
            message: params.message,
          },
          "foreground",
          abortSignal,
        );

        return JSON.stringify({
          success: true,
          sessionId: result.subSessionId,
          status: result.status,
          content: result.status === "completed" ? result.content : undefined,
          message:
            result.status === "running"
              ? "消息已发送，子代理开始执行，请使用 wait 获取结果"
              : "子代理执行完成",
        });
      } catch (error: any) {
        return JSON.stringify({
          success: false,
          message: error.message || "发送消息失败",
        });
      }
    }

    throw new Error(`未知工具: ${request.name}`);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return `## 子代理工具

**使用原则**：
- 默认使用前台子代理（run_mode="foreground"），与用户保持实时交互
- 仅当任务复杂、耗时较长或需要并行处理时，才使用后台子代理（run_mode="background"）
- 未经用户明确要求，禁止自动使用子代理
- 拆分任务时必须边界清晰，确保各子代理不会互相修改同一文件或者任务重叠

**角色驱动模式**：
- 当你的系统提示词中包含【团队成员】时，你可以使用 create 的 characterId 参数创建角色驱动的子代理
- 角色驱动的子代理会继承该角色的完整设定（系统提示词、工具权限等），以该角色身份执行任务
- 格式：create(name="角色名", characterId="角色ID", task="具体任务")
- 根据任务性质选择合适的团队成员角色

**执行流程**：
1. 调用 \`create\` 创建子 Agent（可创建多个后台任务）
2. 后台子代理完成后会主动通知，切勿轮询等待
3. 使用 \`list\` 查看当前所有子代理的状态
4. 使用 \`send_message\` 向已完成的子代理发送消息继续交互
5. 子代理不再需要时，调用 \`close\` 关闭并清理其会话数据

**注意**：
- create 创建后立即返回，后台子代理在后台执行
- wait 返回同一会话下最早完成的子代理结果
- 多次调用 wait 可获取所有子代理结果
- send_message 只能向已完成的子代理发送消息，运行中的会报错
- close 只能关闭已完成的子 Agent，正在运行的无法关闭`
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: "sub_agent",
      displayName: "子 Agent",
      description: "创建子代理独立执行特定任务",
      isMcp: false,
      loadMode: "lazy",
      type: "core",
    };
  }

  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isExecuting: boolean,
  ): ToolDisplayInfo {
    const prefix = isExecuting ? "正在" : "已";

    if (toolName === "subagent_create") {
      const modeLabel = args.characterId ? "角色子代理" : "子代理";
      return {
        action: `${prefix}创建${modeLabel}`,
        args: args.name || args.task?.substring(0, 30),
        toolName: "subagent_create",
        toolType: "sub_agent",
      };
    }
    if (toolName === "wait") {
      return {
        action: `${prefix}等待子代理完成`,
        args: args.sessionId?.substring(0, 16),
        toolName: "wait",
        toolType: "sub_agent",
      };
    }
    if (toolName === "send_message") {
      return {
        action: `${prefix}向子代理发送消息`,
        args: args.sessionId?.substring(0, 16),
        toolName: "send_message",
        toolType: "sub_agent",
      };
    }
    if (toolName === "close") {
      return {
        action: `${prefix}关闭子代理`,
        args: args.sessionId?.substring(0, 16),
        toolName: "close",
        toolType: "sub_agent",
      };
    }
    if (toolName === "list") {
      return {
        action: `${prefix}查询子代理列表`,
        args: undefined,
        toolName: "list",
        toolType: "sub_agent",
      };
    }
    return {
      action: `${prefix}子代理操作`,
      args: toolName,
      toolName,
      toolType: "sub_agent",
    };
  }
}
