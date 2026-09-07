import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PluginManager } from "../plugins/plugin.manager";
import { ShellPlugin } from "./shell.plugin";
import { ShellController } from "./shell.controller";
import { ProcessManagerService } from "./process-manager.service";
import { SharedModule } from "../../common/services/shared.module";
import { PluginsModule } from "../plugins";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { RemoteWorkspaceModule } from "../remote-workspace/remote-workspace.module";

/**
 * Shell 命令行模块
 *
 * 提供系统命令执行和后台进程管理能力。
 * - ShellPlugin: 注册 execute + process 两个工具（通过 PluginManager）
 * - ProcessManagerService: 管理后台进程的生命周期、文件输出、静默监控
 * - ShellController: 前端侧边栏的后台进程列表/终止/日志端点
 *   （AuthGuard 依赖 JwtService，经 AuthModule 导出的 JwtModule 提供）
 */
@Module({
  imports: [SharedModule, PluginsModule, AuthModule, ChatModule, RemoteWorkspaceModule],
  controllers: [ShellController],
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
