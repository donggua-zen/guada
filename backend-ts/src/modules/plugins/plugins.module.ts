import { Global, Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PluginManager } from "./plugin.manager";
import { FilePlugin } from "./builtins/file.plugin";
import { ImageRecognitionPlugin } from "./builtins/image-recognition.plugin";
import { MemoryPlugin } from "./builtins/memory.plugin";
import { TimePlugin } from "./builtins/time.plugin";
import { ShellPlugin } from "./builtins/shell.plugin";
import { BrowserPlugin } from "./builtins/browser.plugin";
import { TodoPlugin } from "./builtins/todo.plugin";

@Global()
@Module({
  providers: [
    PluginManager,
    FilePlugin,
    ImageRecognitionPlugin,
    MemoryPlugin,
    TimePlugin,
    ShellPlugin,
    BrowserPlugin,
    TodoPlugin,
  ],
  exports: [PluginManager],
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
    await this.pluginManager.registerPlugin(this.moduleRef.get(ShellPlugin));

    await this.pluginManager.registerPlugin(this.moduleRef.get(TodoPlugin));

    if (process.env.ELECTRON_APP === "true") {
      await this.pluginManager.registerPlugin(this.moduleRef.get(BrowserPlugin));
    }

    const names = this.pluginManager.getAllPlugins().map(p => p.manifest.name).join(", ");
    console.log(`Plugins: ${names}`);
  }
}
