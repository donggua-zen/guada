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
  /**
   * 插件启用态解析器（由 PluginManager 注入）。
   *
   * 插件注册的命令不带启停语义：注册项在禁用后仍然留在表里，
   * 于是「已禁用的插件命令还能被执行」。这里与 PluginHttpRegistry 同构，
   * 分发与列表都先问一次归属插件是否启用。
   */
  private enabledResolver?: (pluginId: string) => boolean;

  setEnabledResolver(resolver: (pluginId: string) => boolean): void {
    this.enabledResolver = resolver;
  }

  /** 该命令当前是否可用（归属插件被禁用则不可用；内置命令无 pluginId，恒可用） */
  private isAvailable(key: string): boolean {
    const meta = this.meta.get(key);
    if (!meta?.pluginId) return true;
    if (!this.enabledResolver) return true;
    try {
      return this.enabledResolver(meta.pluginId);
    } catch {
      return true; // 解析器异常时 fail-open，与 hook/http 一致
    }
  }

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
    const key = name.toLowerCase();
    if (!this.handlers.has(key)) return false;
    return this.isAvailable(key);
  }

  dispatch(
    name: string,
    ctx: LocalSlashCommandContext,
  ): Promise<LocalSlashCommandResult> {
    const key = name.toLowerCase();
    const handler = this.handlers.get(key);
    if (!handler) throw new Error(`No handler for local slash command "${name}"`);
    // 插件被禁用后，其命令不应继续可执行（否则「禁用」形同虚设）
    if (!this.isAvailable(key)) {
      const pluginId = this.meta.get(key)?.pluginId;
      throw new Error(
        `Local slash command "${name}" is unavailable: plugin "${pluginId}" is disabled`,
      );
    }
    return handler(ctx);
  }

  /** 前端 picker 用：只列主名（不列别名）；禁用插件的命令不列出 */
  list(): LocalSlashCommandEntry[] {
    const out: LocalSlashCommandEntry[] = [];
    for (const [name, meta] of this.meta) {
      if (meta.aliases && meta.aliases.length === 0) continue; // 别名条目
      if (!this.isAvailable(name)) continue; // 归属插件已禁用
      out.push({
        name,
        description: meta.description || '',
        pluginId: meta.pluginId,
        aliases: meta.aliases || [],
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 按插件枚举本地命令（详情/诊断用；含已禁用插件的命令） */
  getByPlugin(pluginId: string): LocalSlashCommandEntry[] {
    const out: LocalSlashCommandEntry[] = [];
    for (const [name, meta] of this.meta) {
      if (meta.pluginId !== pluginId) continue;
      if (meta.aliases && meta.aliases.length === 0) continue;
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
