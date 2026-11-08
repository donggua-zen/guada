import { Controller, Get, Query, Logger, UseGuards } from "@nestjs/common";
import { CommandProviderRegistry, AggregatedItem } from "./command-provider-registry.service";
import { CommandContext } from "./interfaces/command-provider.interface";
import { AuthGuard } from "../auth/auth.guard";
import { LocalSlashCommandRegistry } from "../chat/commands/local-slash-command.registry";

@Controller("commands")
@UseGuards(AuthGuard)
export class CommandsController {
  private readonly logger = new Logger(CommandsController.name);

  constructor(
    private readonly registry: CommandProviderRegistry,
    private readonly localCommands: LocalSlashCommandRegistry,
  ) {}

  /**
   * 获取命令列表（按触发方式聚合所有提供者的 items）
   * GET /commands?trigger=slash
   * GET /commands?trigger=mention&agentId=xxx
   *
   * v2：slash 列表会并入「动作型本地命令」（内置 /compact、/goal 与插件命令），
   * 前端据 local: true 走"发送时本地执行"分支，而不是插入标签。
   */
  @Get()
  async listCommands(
    @Query("trigger") trigger?: string,
    @Query("agentId") agentId?: string,
  ): Promise<{ items: AggregatedItem[]; total: number }> {
    const t = trigger === "mention" ? "mention" : "slash";
    const ctx: CommandContext = { agentId };
    const items = await this.registry.getItems(t, ctx);

    if (t === "slash") {
      const local: AggregatedItem[] = this.localCommands.list().map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        providerId: cmd.pluginId ? `local:${cmd.pluginId}` : "local",
        trigger: "slash",
        local: true,
      }));
      const merged = [...local, ...items];
      return { items: merged, total: merged.length };
    }

    return { items, total: items.length };
  }

  /**
   * 获取所有注册的命令提供者元数据
   * GET /commands/providers
   */
  @Get("providers")
  getProviders() {
    return { providers: this.registry.getProviders() };
  }
}
