import { Global, Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { PluginManager } from "./plugin.manager";
import { PluginsController } from "./plugins.controller";
import { FilePlugin } from "./builtins/file.plugin";
import { ImageRecognitionPlugin } from "./builtins/image-recognition.plugin";
import { MemoryPlugin } from "./builtins/memory.plugin";
import { TimePlugin } from "./builtins/time.plugin";
import { BrowserPlugin } from "./builtins/browser.plugin";
import { PlanPlugin } from "./builtins/plan.plugin";
import { WebSearchPlugin } from "./builtins/web-search.plugin";
import { MetasoProvider } from "./builtins/search-providers/metaso.provider";
import { TavilyProvider } from "./builtins/search-providers/tavily.provider";
import { BochaProvider } from "./builtins/search-providers/bocha.provider";
import { PromptCollector } from "./prompt-collector.service";

@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [PluginsController],
  providers: [
    PluginManager,
    PromptCollector,
    FilePlugin,
    ImageRecognitionPlugin,
    MemoryPlugin,
    TimePlugin,
    BrowserPlugin,
    PlanPlugin,
    WebSearchPlugin,
    MetasoProvider,
    TavilyProvider,
    BochaProvider,
  ],
  exports: [PluginManager, PromptCollector],
})
export class PluginsModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    // 由 NestJS DI 容器自动注入依赖，通过 ModuleRef 获取已实例化的插件
    await this.pluginManager.registerPlugin(this.moduleRef.get(FilePlugin));
    await this.pluginManager.registerPlugin(this.moduleRef.get(ImageRecognitionPlugin));
    await this.pluginManager.registerPlugin(this.moduleRef.get(MemoryPlugin));
    await this.pluginManager.registerPlugin(this.moduleRef.get(TimePlugin));

    await this.pluginManager.registerPlugin(this.moduleRef.get(PlanPlugin));
    await this.pluginManager.registerPlugin(this.moduleRef.get(WebSearchPlugin));

    if (process.env.ELECTRON_APP === "true") {
      await this.pluginManager.registerPlugin(this.moduleRef.get(BrowserPlugin));
    }

  }
}
