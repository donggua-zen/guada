import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { SchedulerController } from "./scheduler.controller";
import { SchedulerService } from "./scheduler.service";
import { TaskSchedulerService } from "./task-scheduler.service";
import { TaskExecutorService } from "./task-executor.service";
import { TaskStorageService } from "./task-storage.service";
import { ChatModule } from "../chat/chat.module";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../../common/services/shared.module";
import { DatabaseModule } from "../../common/database/database.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { SchedulerPlugin } from "./plugins/scheduler.plugin";

@Module({
  imports: [ChatModule, ToolsModule, AuthModule, SharedModule, DatabaseModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, TaskSchedulerService, TaskExecutorService, TaskStorageService],
  exports: [SchedulerService],
})
export class SchedulerModule implements OnModuleInit {
  private readonly logger = new Logger(SchedulerModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly schedulerService: SchedulerService,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(new SchedulerPlugin(this.schedulerService));
    this.logger.log("SchedulerPlugin 已注册");
  }
}
