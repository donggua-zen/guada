import { Injectable, Logger } from "@nestjs/common";
import { ICommandProvider, CommandItem, ParserResult } from "./interfaces/command-provider.interface";

export interface AggregatedItem extends CommandItem {
  /** 提供者 id，如 "skill" */
  providerId: string;
  /** 触发方式 */
  trigger: 'slash' | 'mention';
}

export interface ProviderMeta {
  id: string;
  trigger: 'slash' | 'mention';
}

/**
 * 命令提供者注册表
 *
 * 插件通过 PluginApi.registerCommandProvider() 注册，
 * 前端通过 CommandsController 聚合查询。
 */
@Injectable()
export class CommandProviderRegistry {
  private readonly logger = new Logger(CommandProviderRegistry.name);
  private providers = new Map<string, ICommandProvider>();

  private readonly NAME_RE = /^[\w\-\/]+$/;

  register(provider: ICommandProvider): void {
    // 校验 id 只能包含字母数字下划线连字符
    if (!this.NAME_RE.test(provider.id)) {
      this.logger.error(
        `命令提供者 id "${provider.id}" 包含非法字符，跳过注册，仅允许字母数字下划线连字符`,
      );
      return;
    }

    if (this.providers.has(provider.id)) {
      this.logger.warn(`命令提供者 ${provider.id} 已存在，覆盖更新`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(`注册命令提供者: [${provider.trigger}] ${provider.id}`);
  }

  unregister(id: string): void {
    this.providers.delete(id);
    this.logger.log(`注销命令提供者: ${id}`);
  }

  /** 按触发方式获取所有 items（每个 item 附带 providerId） */
  async getItems(trigger: 'slash' | 'mention'): Promise<AggregatedItem[]> {
    const result: AggregatedItem[] = [];
    for (const [, provider] of this.providers) {
      if (provider.trigger !== trigger) continue;
      try {
        const items = await provider.fetchItems();
        for (const item of items) {
          // 校验 name 只能包含字母数字下划线连字符
          if (!item.name || !this.NAME_RE.test(item.name)) {
            this.logger.error(
              `命令提供者 ${provider.id} 的 item name "${item.name || '(empty)'}" 包含非法字符，跳过该 item`,
            );
            continue;
          }
          result.push({
            ...item,
            providerId: provider.id,
            trigger: provider.trigger,
          });
        }
      } catch (error: any) {
        this.logger.error(
          `获取命令提供者 ${provider.id} 的 items 失败: ${error?.message || error}`,
        );
      }
    }
    return result;
  }

  /** 获取所有注册的提供者元数据 */
  getProviders(): ProviderMeta[] {
    const result: ProviderMeta[] = [];
    for (const [, provider] of this.providers) {
      result.push({ id: provider.id, trigger: provider.trigger });
    }
    return result;
  }

  /** 按 type/id 获取解析器（供 TagParserPipeline 使用） */
  getParser(type: string): ((attrs: Record<string, string>) => Promise<ParserResult | undefined>) | undefined {
    const provider = this.providers.get(type);
    if (!provider?.parse) return undefined;
    return (attrs: Record<string, string>) => Promise.resolve(provider.parse!(attrs));
  }
}
