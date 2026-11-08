/**
 * 本地斜杠命令执行注册表。
 *
 * `/compact` 由 ChatController 直接处理（压缩是会话服务的核心能力）。
 * 其余命令（如 `/goal`）由功能模块在 onModuleInit 注册自己的 handler，
 * 避免 ChatModule 反向依赖功能模块形成循环。
 *
 * v2：三方插件可通过 PluginApi.registerLocalCommand 注册动作型命令；
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

export interface LocalSlashCommandMeta {
  description?: string;
  /** 注册方插件 ID（内置命令为空） */
  pluginId?: string;
  /** 别名（同样可触发，但不出现在列表里） */
  aliases?: string[];
}

export interface LocalSlashCommandEntry {
  name: string;
  description: string;
  pluginId?: string;
  aliases: string[];
}

@Injectable()
export class LocalSlashCommandRegistry {
  private readonly logger = new Logger(LocalSlashCommandRegistry.name);
  private readonly handlers = new Map<string, LocalSlashCommandHandler>();
  private readonly meta = new Map<string, LocalSlashCommandMeta>();

  register(
    name: string,
    handler: LocalSlashCommandHandler,
    meta: LocalSlashCommandMeta = {},
  ): void {
    const key = name.toLowerCase();
    if (this.handlers.has(key)) {
      this.logger.warn(`Local slash command "${name}" registered twice, overriding`);
    }
    this.handlers.set(key, handler);
    this.meta.set(key, meta);

    // 别名指向同一 handler；meta 只挂在主名上（list 不重复）
    for (const alias of meta.aliases || []) {
      const a = alias.toLowerCase();
      if (this.handlers.has(a)) {
        this.logger.warn(`Local slash command alias "${alias}" already registered, skipping`);
        continue;
      }
      this.handlers.set(a, handler);
      this.meta.set(a, { ...meta, aliases: [] });
    }
  }

  has(name: string): boolean {
    return this.handlers.has(name.toLowerCase());
  }

  dispatch(
    name: string,
    ctx: LocalSlashCommandContext,
  ): Promise<LocalSlashCommandResult> {
    const handler = this.handlers.get(name.toLowerCase());
    if (!handler) throw new Error(`No handler for local slash command "${name}"`);
    return handler(ctx);
  }

  /** 前端 picker 用：只列主名（不列别名） */
  list(): LocalSlashCommandEntry[] {
    const out: LocalSlashCommandEntry[] = [];
    for (const [name, meta] of this.meta) {
      if (meta.aliases && meta.aliases.length === 0) continue; // 别名条目
      out.push({
        name,
        description: meta.description || '',
        pluginId: meta.pluginId,
        aliases: meta.aliases || [],
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 插件卸载：移除该插件注册的主名与别名 */
  unregisterByPlugin(pluginId: string): void {
    const names: string[] = [];
    for (const [name, meta] of this.meta) {
      if (meta.pluginId === pluginId) names.push(name);
    }
    for (const name of names) {
      this.handlers.delete(name);
      this.meta.delete(name);
    }
  }
}
