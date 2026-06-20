import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { SubAgentManager } from "./sub-agent.manager";
import { SubAgentPlugin } from "./sub-agent.plugin";
import { CharacterRepository } from "../../common/database/character.repository";

@Module({
  imports: [ChatModule, ToolsModule],
  providers: [SubAgentManager, SubAgentPlugin, CharacterRepository],
  exports: [SubAgentManager],
})
export class SubAgentModule implements OnModuleInit {
  private readonly logger = new Logger(SubAgentModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly subAgentPlugin: SubAgentPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.subAgentPlugin);
    this.logger.log("SubAgentPlugin 已注册");
  }
}
