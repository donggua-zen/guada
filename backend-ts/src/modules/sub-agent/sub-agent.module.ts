import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { AgentsModule } from "../agents/agents.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { JobsModule } from "../jobs/jobs.module";
import { SubAgentManager } from "./sub-agent.manager";
import { SubAgentPlugin } from "./sub-agent.plugin";

@Module({
  imports: [ChatModule, AgentsModule, ToolsModule, JobsModule],
  providers: [
    SubAgentManager,
    SubAgentPlugin,
  ],
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
