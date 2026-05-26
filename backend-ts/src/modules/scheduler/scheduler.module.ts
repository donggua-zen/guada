import { Module, forwardRef } from "@nestjs/common";
import { SchedulerController } from "./scheduler.controller";
import { SchedulerService } from "./scheduler.service";
import { TaskSchedulerService } from "./task-scheduler.service";
import { TaskExecutorService } from "./task-executor.service";
import { TaskStorageService } from "./task-storage.service";
import { ChatModule } from "../chat/chat.module";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../../common/services/shared.module";
import { DatabaseModule } from "../../common/database/database.module";

/**
 * 定时任务模块
 *
 * 提供基于 cron 表达式的定时任务调度功能，支持：
 * - 创建/编辑/删除定时任务
 * - 按 cron 表达式周期执行
 * - 自动创建新会话或在指定会话中执行
 * - 任务执行日志记录
 *
 * 数据持久化：使用 JSON 文件存储（data/scheduler/）
 */
@Module({
  imports: [forwardRef(() => ChatModule), AuthModule, SharedModule, DatabaseModule],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    TaskSchedulerService,
    TaskExecutorService,
    TaskStorageService,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
