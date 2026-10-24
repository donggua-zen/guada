import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobRegistryService } from "./job-registry.service";
import { JobsPlugin } from "./jobs.plugin";
import { JobsController } from "./jobs.controller";

/**
 * 通用后台作业控制面。
 *
 * 刻意不 import ChatModule / PluginsModule / RemoteWorkspaceModule：
 * - 通知由 ChatModule 的 JobNotifierService 订阅 job.settled；
 * - 工具注册由 ShellModule（已 import PluginsModule）负责。
 * 这样可避免 JobsModule ↔ ChatModule ↔ RemoteWorkspaceModule 的循环依赖。
 * AuthModule 仅用于 JobsController 的 JWT guard，不反向依赖 JobsModule。
 */
@Module({
  imports: [AuthModule],
  controllers: [JobsController],
  providers: [JobRegistryService, JobsPlugin],
  exports: [JobRegistryService, JobsPlugin],
})
export class JobsModule {}
