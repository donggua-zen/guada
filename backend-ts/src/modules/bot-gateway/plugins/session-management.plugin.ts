import { Logger, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { PrismaService } from "../../../common/database/prisma.service";
import { appendResetMarker } from "../utils/external-id";
import { PluginApi } from "../../plugins/api/plugin-api";
import langZh from "./session-management.lang.zh.json";

@Injectable()
export class SessionManagementPlugin extends PluginBase {
  private readonly logger = new Logger(SessionManagementPlugin.name);

  manifest = {
    id: "session_management",
    name: "会话管理",
    description: "管理机器人会话，清空对话历史",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private prisma: PrismaService) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    const sessionKit = api.registerToolKit({
      id: "session",
      name: "会话管理",
      loadMode: "none",
      handler: (ctx: PluginContext) => ({
        loadMode:
          ctx?.session?.sessionType === "bot"
            ? ("eager" as const)
            : ("none" as const),
      }),
    });

    sessionKit.registerTool({
      name: "clear_session",
      description:
        "清空当前会话的所有消息历史，开始全新的对话。此操作会将当前会话归档，后续消息将创建新的会话。",
      inputSchema: z.object({ confirm: z.boolean() }),
      execute: async (args, ctx) => {
        const sessionId = ctx?.session.sessionId;
        const sessionType = ctx?.session?.sessionType;
        if (!sessionId) throw new Error("无法获取会话 ID");
        if (sessionType !== "bot")
          throw new Error("此工具仅在机器人会话中可用");
        if (!args.confirm)
          throw new Error("需要设置 confirm: true 来确认清空操作");

        const session = await this.prisma.session.findUnique({
          where: { id: sessionId },
        });
        if (!session) throw new Error(`会话不存在: ${sessionId}`);
        if (session.sessionType !== "bot")
          throw new Error("此工具仅在机器人会话中可用");

        const oldExternalId = session.externalId;
        const newExternalId = appendResetMarker(oldExternalId);
        this.logger.log(
          `清空会话 ${sessionId}: ${oldExternalId} -> ${newExternalId}`,
        );

        await this.prisma.session.update({
          where: { id: sessionId },
          data: {
            externalId: newExternalId,
            title: `${session.title || "会话"} (已清空)`,
          },
        });

        return JSON.stringify({
          success: true,
          message: "会话已清空，下次对话将创建新的会话",
          archivedExternalId: newExternalId,
        });
      },
      display: {
        actionType: "clear_session",
        text: { executing: "%clear_session.executing%", completed: "%clear_session.completed%" },
        icon: "chat",
      },
    });

    sessionKit.registerPrompt({
      frequency: "REGULAR",
      description: "会话管理工具使用说明",
      content: (context: PluginContext) => {
        if (context.session.sessionType !== "bot") return "";
        return [
          "# Session Management Tools",
          "",
          "## clear_session",
          "**Purpose**: Clear all message history in the current session and start a fresh conversation",
          "",
          "**When to use**:",
          '- User explicitly asks to "clear chat", "start over", "delete all messages"',
          "- The topic has completely shifted and the old context is no longer relevant",
          "",
          "**Important Notes**:",
          "- This operation cannot be undone",
          "- Must set confirm: true before calling",
        ].join("\n");
      },
    });
  }
}
