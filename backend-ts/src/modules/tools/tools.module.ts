import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SharedModule } from "../../common/services/shared.module";
import { PluginsModule, PluginManager } from "../plugins";
import { UniversalToolsPlugin } from "./plugins/universal-tools.plugin";
import { ToolExecutor } from "./tool-executor.service";

@Module({
  imports: [HttpModule, SharedModule, PluginsModule],
  providers: [ToolExecutor, UniversalToolsPlugin],
  exports: [ToolExecutor],
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
