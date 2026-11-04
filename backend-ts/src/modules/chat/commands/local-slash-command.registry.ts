/**
 * 本地斜杠命令执行注册表。
 *
 * `/compact` 由 ChatController 直接处理（压缩是会话服务的核心能力）。
 * 其余命令（如 `/goal`）由功能模块在 onModuleInit 注册自己的 handler，
 * 避免 ChatModule 反向依赖功能模块形成循环。
 *
 * 命令仍是「控制指令」：不写用户消息、不建流、不进 LLM 上下文。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface LocalSlashCommandContext {
  sessionId: string;
  clientId?: string;
  /** 命令后的自由文本（不含命令名） */
  args?: string;
  raw: string;
}

export interface LocalSlashCommandResult {
  /** 返回给前端 localCommand 字段的附加信息 */
  [key: string]: unknown;
}

export type LocalSlashCommandHandler = (
  ctx: LocalSlashCommandContext,
) => Promise<LocalSlashCommandResult>;

@Injectable()
export class LocalSlashCommandRegistry {
  private readonly logger = new Logger(LocalSlashCommandRegistry.name);
  private readonly handlers = new Map<string, LocalSlashCommandHandler>();

  register(name: string, handler: LocalSlashCommandHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`Local slash command "${name}" registered twice, overriding`);
    }
    this.handlers.set(name.toLowerCase(), handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name.toLowerCase());
  }

  async dispatch(
    name: string,
    ctx: LocalSlashCommandContext,
  ): Promise<LocalSlashCommandResult> {
    const handler = this.handlers.get(name.toLowerCase());
    if (!handler) throw new Error(`No handler for local slash command "${name}"`);
    return handler(ctx);
  }
}
