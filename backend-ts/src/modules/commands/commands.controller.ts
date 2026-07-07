import { Controller, Get, Query, Logger } from "@nestjs/common";
import { CommandProviderRegistry, AggregatedItem } from "./command-provider-registry.service";

@Controller("commands")
export class CommandsController {
  private readonly logger = new Logger(CommandsController.name);

  constructor(
    private readonly registry: CommandProviderRegistry,
  ) {}

  /**
   * 获取命令列表（按触发方式聚合所有提供者的 items）
   * GET /commands?trigger=slash
   * GET /commands?trigger=mention
   */
  @Get()
  async listCommands(
    @Query("trigger") trigger?: string,
  ): Promise<{ items: AggregatedItem[]; total: number }> {
    const t = trigger === "mention" ? "mention" : "slash";
    const items = await this.registry.getItems(t);
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
