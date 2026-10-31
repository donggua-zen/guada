import { Module } from "@nestjs/common";
import { AgentsController } from "./agents.controller";
import { AgentService } from "./agent.service";
import { AgentSeedService } from "./agent-seed.service";
import { AgentFileStore } from "./agent-file.store";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [AgentsController],
  providers: [
    AgentFileStore,
    AgentService,
    AgentSeedService,
  ],
  exports: [AgentFileStore],
})
export class AgentsModule {}
