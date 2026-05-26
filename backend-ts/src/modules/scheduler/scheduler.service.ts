import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { TaskStorageService } from "./task-storage.service";
import { TaskSchedulerService } from "./task-scheduler.service";
import { TaskExecutorService } from "./task-executor.service";
import { ScheduledTask } from "./types/scheduler.types";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";

/**
 * 定时任务业务服务
 *
 * 提供任务 CRUD 和手动触发执行等高层业务操作
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private storage: TaskStorageService,
    private taskScheduler: TaskSchedulerService,
    private executor: TaskExecutorService,
  ) {}

  /**
   * 获取用户的所有任务
   */
  async getTasks(userId: string): Promise<ScheduledTask[]> {
    return this.storage.getTasksByUserId(userId);
  }

  /**
   * 获取单个任务详情
   */
  async getTask(id: string, userId: string): Promise<ScheduledTask> {
    const task = await this.storage.getTaskById(id);
    if (!task || task.userId !== userId) {
      throw new NotFoundException("任务不存在");
    }
    return task;
  }

  /**
   * 创建任务
   */
  async createTask(userId: string, dto: CreateTaskDto): Promise<ScheduledTask> {
    // 根据调度类型验证参数
    if (dto.scheduleType === "cron") {
      if (!dto.cronExpression || !this.taskScheduler.validateCron(dto.cronExpression)) {
        throw new BadRequestException("无效的 cron 表达式");
      }
    } else if (dto.scheduleType === "once") {
      if (!dto.executeAt) {
        throw new BadRequestException("一次性任务需要指定 executeAt");
      }
      const executeTime = new Date(dto.executeAt);
      if (isNaN(executeTime.getTime()) || executeTime <= new Date()) {
        throw new BadRequestException("executeAt 必须是未来的有效时间");
      }
    } else {
      throw new BadRequestException("scheduleType 必须是 cron 或 once");
    }

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      userId,
      name: dto.name,
      prompt: dto.prompt,
      scheduleType: dto.scheduleType,
      cronExpression: dto.cronExpression || "",
      executeAt: dto.executeAt || null,
      targetMode: dto.targetMode,
      targetSessionId: dto.targetSessionId || null,
      characterId: dto.characterId || null,
      modelId: dto.modelId || null,
      settings: dto.settings || null,
      enabled: dto.enabled !== false,
      maxExecutions: dto.maxExecutions ?? null,
      executionCount: 0,
      maxRetries: dto.maxRetries ?? 0,
      retryInterval: dto.retryInterval ?? 60,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.createTask(task);

    // 如果启用，立即调度
    if (task.enabled) {
      this.taskScheduler.scheduleTask(task);
    }

    this.logger.log(`用户 ${userId} 创建定时任务: ${task.name} (${task.scheduleType})`);
    return task;
  }

  /**
   * 更新任务
   */
  async updateTask(id: string, userId: string, dto: UpdateTaskDto): Promise<ScheduledTask> {
    const task = await this.getTask(id, userId);

    // 如果更新了调度类型或相关参数，验证有效性
    if (dto.scheduleType !== undefined || dto.cronExpression !== undefined || dto.executeAt !== undefined) {
      const newScheduleType = dto.scheduleType || task.scheduleType;
      if (newScheduleType === "cron") {
        const newCron = dto.cronExpression || task.cronExpression;
        if (!newCron || !this.taskScheduler.validateCron(newCron)) {
          throw new BadRequestException("无效的 cron 表达式");
        }
      } else if (newScheduleType === "once") {
        const newExecuteAt = dto.executeAt !== undefined ? dto.executeAt : task.executeAt;
        if (!newExecuteAt) {
          throw new BadRequestException("一次性任务需要指定 executeAt");
        }
        const executeTime = new Date(newExecuteAt);
        if (isNaN(executeTime.getTime()) || executeTime <= new Date()) {
          throw new BadRequestException("executeAt 必须是未来的有效时间");
        }
      }
    }

    const updates: Partial<ScheduledTask> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.prompt !== undefined) updates.prompt = dto.prompt;
    if (dto.scheduleType !== undefined) updates.scheduleType = dto.scheduleType;
    if (dto.cronExpression !== undefined) updates.cronExpression = dto.cronExpression;
    if (dto.executeAt !== undefined) updates.executeAt = dto.executeAt;
    if (dto.targetMode !== undefined) updates.targetMode = dto.targetMode;
    if (dto.targetSessionId !== undefined) updates.targetSessionId = dto.targetSessionId;
    if (dto.characterId !== undefined) updates.characterId = dto.characterId;
    if (dto.modelId !== undefined) updates.modelId = dto.modelId;
    if (dto.settings !== undefined) updates.settings = dto.settings;
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;
    if (dto.maxExecutions !== undefined) updates.maxExecutions = dto.maxExecutions;
    if (dto.maxRetries !== undefined) updates.maxRetries = dto.maxRetries;
    if (dto.retryInterval !== undefined) updates.retryInterval = dto.retryInterval;

    const updated = await this.storage.updateTask(id, updates);
    if (!updated) {
      throw new NotFoundException("更新任务失败");
    }

    // 重新调度任务
    this.taskScheduler.rescheduleTask(updated);

    this.logger.log(`用户 ${userId} 更新定时任务: ${updated.name}`);
    return updated;
  }

  /**
   * 删除任务
   */
  async deleteTask(id: string, userId: string): Promise<void> {
    const task = await this.getTask(id, userId);

    // 先取消调度
    this.taskScheduler.unscheduleTask(id);

    // 再删除数据
    await this.storage.deleteTask(id);

    this.logger.log(`用户 ${userId} 删除定时任务: ${task.name}`);
  }

  /**
   * 切换任务启用状态
   */
  async toggleTask(id: string, userId: string): Promise<ScheduledTask> {
    const task = await this.getTask(id, userId);
    const updated = await this.storage.updateTask(id, {
      enabled: !task.enabled,
    });
    if (!updated) {
      throw new NotFoundException("更新任务失败");
    }

    // 重新调度
    this.taskScheduler.rescheduleTask(updated);

    this.logger.log(`用户 ${userId} ${updated.enabled ? "启用" : "禁用"}定时任务: ${updated.name}`);
    return updated;
  }

  /**
   * 测试触发任务（无任何副作用）
   *
   * 失败不重试、不自动禁用、不记录日志、不更新执行次数
   */
  async testTask(id: string, userId: string): Promise<void> {
    const task = await this.getTask(id, userId);
    this.logger.log(`用户 ${userId} 测试触发任务: ${task.name}`);
    await this.executor.dryRun(task);
  }

  /**
   * 获取任务执行日志
   */
  async getTaskLogs(taskId: string, userId: string): Promise<any[]> {
    // 验证任务归属权
    await this.getTask(taskId, userId);
    return this.storage.getLogsByTaskId(taskId);
  }

  /**
   * 获取预设 cron 表达式
   */
  getCronPresets() {
    return this.taskScheduler.getPresetCrons();
  }
}
