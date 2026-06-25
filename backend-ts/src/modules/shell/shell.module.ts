import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PluginManager } from "../plugins/plugin.manager";
import { ShellPlugin } from "./shell.plugin";
import { ProcessManagerService } from "./process-manager.service";
import { SharedModule } from "../../common/services/shared.module";
import { PluginsModule } from "../plugins";
import { ChatModule } from "../chat/chat.module";

/**
 * Shell 命令行模块
 *
 * 提供系统命令执行和后台进程管理能力。
 * - ShellPlugin: 注册 execute + process 两个工具（通过 PluginManager）
 * - ProcessManagerService: 管理后台进程的生命周期、文件输出、静默监控
 */
@Module({
  imports: [SharedModule, PluginsModule, ChatModule],
  providers: [ShellPlugin, ProcessManagerService],
})
export class ShellModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(
      this.moduleRef.get(ShellPlugin),
    );
  }
}
