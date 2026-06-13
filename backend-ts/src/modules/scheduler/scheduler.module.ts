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
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SchedulerToolProvider } from "./scheduler-tool.provider";

/**
 * 定时任务模块
 *
 * 提供基于 cron 表达式的定时任务调度功能，支持：
 * - 创建/编辑/删除定时任务
 * - 按 cron 表达式周期执行
 * - 自动创建新会话或在指定会话中执行
 * - 任务执行日志记录
 */
@Module({
  imports: [ChatModule, ToolsModule, AuthModule, SharedModule, DatabaseModule],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    TaskSchedulerService,
    TaskExecutorService,
    TaskStorageService,
    SchedulerToolProvider,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule implements OnModuleInit {
  private readonly logger = new Logger(SchedulerModule.name);

  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly schedulerToolProvider: SchedulerToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.schedulerToolProvider);
    this.logger.log("SchedulerToolProvider 已注册到 ToolOrchestrator");
  }
}
