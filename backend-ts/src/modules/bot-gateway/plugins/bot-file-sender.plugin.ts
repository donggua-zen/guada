import { Logger, Injectable } from "@nestjs/common";
import { z } from "zod";
import { resolve, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi } from "../../plugins/api/plugin-api";
import type { PluginContext } from "../../plugins/types/plugin.types";
import { BotInstanceManager } from "../services/bot-instance-manager.service";
import { BotStatus } from "../interfaces/bot-platform.interface";

const MAX_SEND_RETRIES = 3;
const RETRY_INTERVAL_MS = 2000;

@Injectable()
export class BotFileSenderPlugin extends PluginBase {
  private readonly logger = new Logger(BotFileSenderPlugin.name);

  /** Per-bot send queue — serializes sendMedia calls to avoid CDN upload races */
  private sendQueues = new Map<string, Promise<void>>();

  manifest = {
    id: "bot_file_sender",
    name: "文件发送",
    description: "在机器人会话中发送文件、图片、视频给用户",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private botInstanceManager: BotInstanceManager) {
    super();
  }

  async onLoad(api: PluginApi) {
    const fileKit = api.registerToolKit({
      id: "bot_file",
      name: "文件发送",
      loadMode: "none",
      handler: (ctx: PluginContext) => {
        if (ctx?.session?.sessionType !== "bot") {
          return { loadMode: "none" as const };
        }
        const botId = ctx.session.botId;
        if (!botId) {
          return { loadMode: "none" as const };
        }
        const adapter = this.botInstanceManager.getAdapter(botId);
        if (!adapter?.sendMedia) {
          return { loadMode: "none" as const };
        }
        return { loadMode: "eager" as const };
      },
    });

    fileKit.registerTool({
      name: "send_file",
      description:
        "Send a file, image, or video to the user in the chat. " +
        "filePath can be a relative path within the workspace, an absolute path, or a URL. " +
        "mediaType: image=photo, video=video, file=other documents (PDF, zip, etc.).",
      inputSchema: z.object({
        filePath: z
          .string()
          .describe("File path (relative to workspace or absolute) or URL"),
        mediaType: z
          .enum(["image", "video", "file"])
          .describe("image=photo, video=video, file=other documents"),
        caption: z.string().optional().describe("Optional text caption"),
      }),
      execute: async (args, ctx) => {
        const session = ctx?.session;
        if (!session) throw new Error("Failed to get session context");
        if (session.sessionType !== "bot")
          throw new Error("This tool is only available in bot sessions");

        const botId = session.botId;
        if (!botId) throw new Error("Failed to get bot ID");

        const adapter = this.botInstanceManager.getAdapter(botId);
        if (!adapter) throw new Error(`Bot adapter not found: ${botId}`);
        if (!adapter.sendMedia)
          throw new Error("Current platform does not support sending files");

        // Resolve file path
        let resolvedPath = args.filePath;
        if (!/^https?:\/\//.test(resolvedPath)) {
          const wsPath = session.getWorkspacePath();
          const absolutePath = isAbsolute(resolvedPath)
            ? resolvedPath
            : resolve(wsPath, resolvedPath);
          // Prevent path traversal — always check, regardless of file existence
          const rel = relative(wsPath, absolutePath);
          if (rel.startsWith("..")) {
            throw new Error(
              "Access to files outside the workspace is not allowed",
            );
          }
          if (!existsSync(absolutePath)) {
            throw new Error(`File not found: ${args.filePath}`);
          }
          resolvedPath = absolutePath;
        }

        // Resolve conversationId and sourceType from externalId
        // externalId format: "platform:type:nativeId"
        const externalId = session.externalId;
        if (!externalId)
          throw new Error("Failed to determine target conversation ID");
        const externalParts = externalId.split(":");
        const conversationId = externalParts.pop();
        if (!conversationId) throw new Error("Failed to parse conversation ID");
        const sourceType = externalParts[1] as
          | "private"
          | "group"
          | "channel"
          | undefined;

        // Serialize sendMedia calls per bot to avoid CDN upload slot races
        const sendTask = this.enqueueSend(botId, async () => {
          let lastError: Error | null = null;
          for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
            const status = this.botInstanceManager.getStatus(botId);
            if (status !== BotStatus.CONNECTED) {
              lastError = new Error(
                `Bot is not connected (status: ${status}). ` +
                  `It may be reconnecting — please try again in a few seconds.`,
              );
              if (attempt < MAX_SEND_RETRIES) {
                this.logger.warn(
                  `Bot ${botId} not connected (attempt ${attempt}/${MAX_SEND_RETRIES}), retrying in ${RETRY_INTERVAL_MS}ms...`,
                );
                await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
                continue;
              }
              break;
            }

            try {
              await this.botInstanceManager.throttleSend(
                botId,
                adapter.getCapabilities()?.sendIntervalMs ?? 0,
              );
              await adapter.sendMedia({
                conversationId,
                mediaType: args.mediaType,
                filePath: resolvedPath,
                caption: args.caption,
                sourceType,
              });

              this.logger.log(
                `Sent ${args.mediaType} via bot ${botId}: ${args.filePath}`,
              );

              return `Sent ${
                args.mediaType === "image"
                  ? "image"
                  : args.mediaType === "video"
                    ? "video"
                    : "file"
              }: ${args.filePath}`;
            } catch (err: any) {
              lastError = err;
              if (attempt < MAX_SEND_RETRIES) {
                this.logger.warn(
                  `Send attempt ${attempt}/${MAX_SEND_RETRIES} failed: ${err.message}, retrying in ${RETRY_INTERVAL_MS}ms...`,
                );
                await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
              }
            }
          }

          throw lastError ?? new Error("Failed to send file after retries");
        });

        return sendTask;
      },
      display: { actionType: "send_file", icon: "file" },
      dangerLevel: "normal" as const,
    });
  }

  /**
   * Serialize async tasks per key.
   * Each call waits for the previous one to settle before running.
   * Errors in one task do not block subsequent tasks.
   */
  private enqueueSend<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.sendQueues.get(key) ?? Promise.resolve();
    const next = prev.then(task, task); // run task whether prev resolved or rejected
    // Keep the chain alive even if next rejects
    this.sendQueues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}
