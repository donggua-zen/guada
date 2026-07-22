import { Controller, Get, Query, Logger, UseGuards } from "@nestjs/common";
import { CommandProviderRegistry, AggregatedItem } from "./command-provider-registry.service";
import { CommandContext } from "./interfaces/command-provider.interface";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

@Controller("commands")
@UseGuards(AuthGuard)
export class CommandsController {
  private readonly logger = new Logger(CommandsController.name);

  constructor(
    private readonly registry: CommandProviderRegistry,
  ) {}

  /**
   * 获取命令列表（按触发方式聚合所有提供者的 items）
   * GET /commands?trigger=slash
   * GET /commands?trigger=mention&characterId=xxx
   */
  @Get()
  async listCommands(
    @Query("trigger") trigger?: string,
    @Query("characterId") characterId?: string,
    @CurrentUser() user?: any,
  ): Promise<{ items: AggregatedItem[]; total: number }> {
    const t = trigger === "mention" ? "mention" : "slash";
    const ctx: CommandContext = { characterId, userId: user?.id };
    const items = await this.registry.getItems(t, ctx);
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
