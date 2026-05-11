import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { PrismaService } from "../../../common/database/prisma.service";
import { appendResetMarker } from "../../bot-gateway/utils/external-id";

@Injectable()
export class SessionManagementToolProvider implements IToolProvider {
  private readonly logger = new Logger(SessionManagementToolProvider.name);
  public readonly namespace = "session_management";

  constructor(private prisma: PrismaService) { }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return [];

    const sessionType = context?.sessionType;

    if (sessionType !== 'bot') {
      return [];
    }

    const toolsConfig = [
      {
        name: "clear_session",
        description: "清空当前会话的所有消息历史，开始全新的对话。此操作会将当前会话归档，后续消息将创建新的会话。",
        parameters: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              description: "确认清空操作，必须设置为 true",
            },
          },
          required: ["confirm"],
        },
      },
    ];

    if (Array.isArray(enabled)) {
      return toolsConfig.filter((tool) => enabled.includes(tool.name));
    }

    return toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    const sessionId = context?.sessionId;
    if (!sessionId) {
      throw new Error("无法获取会话 ID");
    }

    const sessionType = context?.sessionType;
    if (sessionType !== 'bot') {
      throw new Error("此工具仅在机器人会话中可用");
    }

    switch (request.name) {
      case "clear_session":
        return await this.handleClearSession(sessionId, request.arguments);
      default:
        throw new Error(`未知工具: ${request.name}`);
    }
  }

  private async handleClearSession(sessionId: string, args: any): Promise<string> {
    if (!args.confirm) {
      throw new Error("需要设置 confirm: true 来确认清空操作");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    if (session.sessionType !== 'bot') {
      throw new Error('此工具仅在机器人会话中可用');
    }

    const oldExternalId = session.externalId;
    const newExternalId = appendResetMarker(oldExternalId);

    this.logger.log(
      `清空会话 ${sessionId}: ${oldExternalId} -> ${newExternalId}`,
    );

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        externalId: newExternalId,
        title: `${session.title || '会话'} (已清空)`,
      },
    });

    return JSON.stringify({
      success: true,
      message: "会话已清空，下次对话将创建新的会话",
      archivedExternalId: newExternalId,
    });
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    const sessionType = context?.sessionType;
    if (sessionType !== 'bot') {
      return "";
    }

    return `# 会话管理工具

你可以使用以下工具管理当前会话：

## clear_session
**用途**：清空当前会话的所有消息历史，开始全新的对话

**工作原理**：
- 将当前会话归档（添加时间戳标记）
- 后续用户消息会自动创建新的会话
- 旧会话的消息仍然保存在数据库中，但不再接收新消息

**何时使用**：
- 用户明确要求"清空聊天"、"重新开始"、"删除所有消息"
- 话题发生彻底转变，旧上下文不再相关
- 用户希望保护隐私，清除敏感对话记录

**注意事项**：
- 此操作不可撤销（虽然数据仍保留，但会话不再活跃）
- 不会影响其他用户的会话
- 调用前必须设置 confirm: true

**示例**：
当用户说"我们换个话题吧，把之前的聊天记录清空"时，你应该调用此工具。
`;
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    const sessionType = context?.sessionType;
    if (sessionType !== 'bot') {
      return "";
    }
    return "机器人专属的会话管理工具，支持清空消息历史";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    const sessionType = context?.sessionType;
    const loadMode = sessionType === 'bot' ? 'lazy' : 'none';

    return {
      namespace: this.namespace,
      displayName: "会话管理",
      description: "机器人会话管理工具集",
      isMcp: false,
      loadMode,
    };
  }
}