import { Module, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PluginManager } from "../plugins/plugin.manager";
import { ShellPlugin } from "./shell.plugin";
import { ProcessManagerService } from "./process-manager.service";
import { SharedModule } from "../../common/services/shared.module";
import { PluginsModule } from "../plugins";
import { ChatModule } from "../chat/chat.module";
import { RemoteWorkspaceModule } from "../remote-workspace/remote-workspace.module";
import { JobsModule } from "../jobs/jobs.module";
import { JobsPlugin } from "../jobs/jobs.plugin";

/**
 * Shell 命令行模块
 *
 * 提供系统命令执行和后台进程管理能力。
 * - ShellPlugin: 注册 execute + process 两个工具（通过 PluginManager）
 * - ProcessManagerService: 管理后台进程的生命周期、文件输出、静默监控
 */
@Module({
  imports: [SharedModule, PluginsModule, ChatModule, RemoteWorkspaceModule, JobsModule],
  providers: [ShellPlugin, ProcessManagerService],
})
export class ShellModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly moduleRef: ModuleRef,
    private readonly jobsPlugin: JobsPlugin,
  ) {}

  async onModuleInit() {
    // jobs 先注册：shell 提示词里会引导模型用 job_read/job_list/job_stop/job_send。
    await this.pluginManager.registerPlugin(this.jobsPlugin);
    await this.pluginManager.registerPlugin(
      this.moduleRef.get(ShellPlugin),
    );
  }
}
