import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { AgentsController } from "./agents.controller";
import { AgentService } from "./agent.service";
import { AgentSeedService } from "./agent-seed.service";
import { AgentFileStore } from "./agent-file.store";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins/plugin.manager";
import { AgentPlugin } from "./agent.plugin";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [AgentsController],
  providers: [
    AgentFileStore,
    AgentService,
    AgentSeedService,
    AgentPlugin,
  ],
  exports: [AgentFileStore],
})
export class AgentsModule implements OnModuleInit {
  private readonly logger = new Logger(AgentsModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly agentPlugin: AgentPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.agentPlugin);
    this.logger.log("AgentPlugin 已注册");
  }
}
