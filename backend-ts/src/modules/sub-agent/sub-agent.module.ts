import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { SubAgentManager } from "./sub-agent.manager";
import { SubAgentPlugin } from "./sub-agent.plugin";
import { AgentPresetsPlugin } from "./agent-presets.plugin";
import { AgentScannerService } from "./agent-scanner.service";
import { AgentsController } from "./agents.controller";
import { CharacterRepository } from "../../common/database/character.repository";

@Module({
  imports: [ChatModule, ToolsModule],
  controllers: [AgentsController],
  providers: [
    SubAgentManager,
    SubAgentPlugin,
    AgentPresetsPlugin,
    AgentScannerService,
    CharacterRepository,
  ],
  exports: [SubAgentManager, AgentScannerService],
})
export class SubAgentModule implements OnModuleInit {
  private readonly logger = new Logger(SubAgentModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly subAgentPlugin: SubAgentPlugin,
    private readonly agentPresetsPlugin: AgentPresetsPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.subAgentPlugin);
    await this.pluginManager.registerPlugin(this.agentPresetsPlugin);
    this.logger.log("SubAgentPlugin & AgentPresetsPlugin 已注册");
  }
}
