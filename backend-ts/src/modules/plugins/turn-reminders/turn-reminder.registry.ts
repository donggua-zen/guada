import { Injectable, Logger } from "@nestjs/common";
import type { Message } from "../../../common/types/conversation.types";
import type {
  RegisteredTurnReminderProvider,
  TurnReminderInjection,
  TurnReminderProvider,
  TurnReminderProviderInput,
} from "./turn-reminder.types";

/**
 * 每轮提醒 provider 注册表。
 *
 * 刻意不注入 PluginManager / ToolExecutor：
 * - PluginManager 需要注入本 registry 才能把能力传给 PluginApi，反向依赖会形成 provider 循环；
 * - ToolExecutor 属于 ToolsModule，而 ToolsModule 依赖 PluginsModule，反向依赖会形成模块循环。
 * 插件启用态过滤由调用方（AgentEngine）通过 `isEnabled` 回调完成。
 */
@Injectable()
export class TurnReminderRegistry {
  private readonly logger = new Logger(TurnReminderRegistry.name);
  /** key = pluginId + provider.id，重复注册时原位覆盖，保持首次注册顺序 */
  private readonly entries = new Map<string, RegisteredTurnReminderProvider>();

  register(pluginId: string, provider: TurnReminderProvider): void {
    if (!provider?.id) {
      this.logger.warn(`Plugin ${pluginId} tried to register a turn reminder provider without id`);
      return;
    }
    this.entries.set(`${pluginId}::${provider.id}`, { pluginId, provider });
  }

  /** 按 order、注册顺序执行全部 provider；单个失败只记日志，不影响其他 provider */
  async collect(
    input: TurnReminderProviderInput,
    isEnabled?: (pluginId: string) => boolean,
  ): Promise<Required<TurnReminderInjection>> {
    const persist: Message[] = [];
    const transient: Message[] = [];

    const ordered = Array.from(this.entries.values())
      .filter((entry) => !isEnabled || isEnabled(entry.pluginId))
      .sort((a, b) => (a.provider.order ?? 0) - (b.provider.order ?? 0));

    for (const { pluginId, provider } of ordered) {
      try {
        const result = await provider.build(input);
        if (result?.persist?.length) persist.push(...result.persist);
        if (result?.transient?.length) transient.push(...result.transient);
      } catch (error: any) {
        this.logger.warn(
          `Turn reminder provider ${pluginId}/${provider.id} failed: ${error?.message ?? error}`,
        );
      }
    }

    return { persist, transient };
  }
}
