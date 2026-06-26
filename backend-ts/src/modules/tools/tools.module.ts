import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SharedModule } from "../../common/services/shared.module";
import { ToolOrchestrator } from "./tool-orchestrator.service";
import { PluginsModule, PluginManager } from "../plugins";
import { UniversalToolsPlugin } from "./plugins/universal-tools.plugin";

@Module({
  imports: [HttpModule, SharedModule, PluginsModule],
  providers: [ToolOrchestrator, UniversalToolsPlugin],
  exports: [ToolOrchestrator],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly universalToolsPlugin: UniversalToolsPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.universalToolsPlugin);
  }
}
