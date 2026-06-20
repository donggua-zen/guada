import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SharedModule } from "../../common/services/shared.module";
import { ToolOrchestrator } from "./tool-orchestrator.service";
import { PluginsModule } from "../plugins";

@Module({
  imports: [HttpModule, SharedModule, PluginsModule],
  providers: [ToolOrchestrator],
  exports: [ToolOrchestrator],
})
export class ToolsModule {}
