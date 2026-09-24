import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import * as cron from "node-cron";
import * as cronParser from "cron-parser";
import { TaskStorageService } from "./task-storage.service";
import { TaskExecutorService } from "./task-executor.service";
import { ScheduledTask } from "./types/scheduler.types";

/**
 * 定时任务调度管理服务
 *
 * 负责：
 * 1. 启动时从文件加载所有启用的任务并注册到 cron
 * 2. 运行时动态添加/移除/更新任务调度
 * 3. 模块销毁时清理所有定时器
 */
@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private readonly activeJobs = new Map<string, cron.ScheduledTask>();
  private readonly activeTimeouts = new Map<string, NodeJS.Timeout>();
  /** 重叠守卫：正在派发执行中的任务 id，防止上一次未结束时被再次触发 */
  private readonly runningTasks = new Set<string>();

  constructor(
    private storage: TaskStorageService,
    private executor: TaskExecutorService,
  ) {}

  /**
   * 模块初始化时加载所有启用的任务
   */
  async onModuleInit(): Promise<void> {
    this.logger.log("正在加载定时任务...");

    try {
      const tasks = await this.storage.getAllTasks();
      const enabledTasks = tasks.filter((t) => t.enabled);

      let scheduled = 0;
      for (const task of enabledTasks) {
        // 启动即过期的任务：置为禁用，不注册调度
        if (this.isExpired(task)) {
          await this.expireTask(task);
          continue;
        }
        if (this.scheduleTask(task)) scheduled++;
      }

      this.logger.log(`已加载 ${scheduled} 个启用的定时任务`);
    } catch (error) {
      this.logger.error("加载定时任务失败:", error);
    }
  }

  /**
   * 模块销毁时停止所有定时任务
   */
  onModuleDestroy(): void {
    this.logger.log("正在停止所有定时任务...");

    for (const [id, job] of this.activeJobs) {
      job.stop();
      this.logger.log(`已停止 cron 任务: ${id}`);
    }
    this.activeJobs.clear();

    for (const [id, timeout] of this.activeTimeouts) {
      clearTimeout(timeout);
      this.logger.log(`已清除一次性任务: ${id}`);
    }
    this.activeTimeouts.clear();
  }

  /**
   * 调度单个任务
   */
  scheduleTask(task: ScheduledTask): boolean {
    // 如果任务未启用，不调度
    if (!task.enabled) {
      this.logger.warn(`任务未启用，跳过调度: ${task.id}`);
      return false;
    }

    // 如果已存在，先停止旧任务
    this.unscheduleTask(task.id);

    if (task.scheduleType === "once") {
      return this.scheduleOnceTask(task);
    } else {
      return this.scheduleCronTask(task);
    }
  }

  /**
   * 调度一次性任务
   */
  private scheduleOnceTask(task: ScheduledTask): boolean {
    if (!task.executeAt) {
      this.logger.error(`一次性任务缺少 executeAt: ${task.id}`);
      return false;
    }

    const executeTime = new Date(task.executeAt);
    const now = new Date();
    const delay = executeTime.getTime() - now.getTime();

    if (delay <= 0) {
      this.logger.warn(`一次性任务执行时间已过，跳过调度: ${task.id}`);
      return false;
    }

    const timeout = setTimeout(async () => {
      this.activeTimeouts.delete(task.id);
      await this.fireTask(task, "一次性");
    }, delay);

    this.activeTimeouts.set(task.id, timeout);

    // 更新下次执行时间
    this.storage.updateTask(task.id, {
      nextRunAt: executeTime.toISOString(),
    }).catch((err) => {
      this.logger.error(`更新下次执行时间失败: ${task.id}`, err);
    });

    this.logger.log(
      `已调度一次性任务: ${task.name} (${task.id}), 执行时间: ${task.executeAt}, 剩余 ${Math.round(delay / 1000)} 秒`,
    );
    return true;
  }

  /**
   * 调度 cron 周期性任务
   */
  private scheduleCronTask(task: ScheduledTask): boolean {
    // 验证 cron 表达式
    if (!cron.validate(task.cronExpression)) {
      this.logger.error(`无效的 cron 表达式: ${task.cronExpression} (任务: ${task.id})`);
      return false;
    }

    const job = cron.schedule(
      task.cronExpression,
      async () => {
        const fired = await this.fireTask(task, "Cron");
        // 仅在成功派发后推进下次执行时间
        if (fired) await this.updateNextRunAt(task);
      },
      {
        scheduled: true,
        timezone: "Asia/Shanghai",
        runOnInit: false,
      } as any,
    );

    this.activeJobs.set(task.id, job);

    // 计算并更新下次执行时间
    this.updateNextRunAt(task);

    this.logger.log(`已调度 cron 任务: ${task.name} (${task.id}), cron: ${task.cronExpression}`);
    return true;
  }

  /**
   * 取消调度单个任务
   */
  unscheduleTask(taskId: string): void {
    // 清理 cron 任务
    const job = this.activeJobs.get(taskId);
    if (job) {
      job.stop();
      this.activeJobs.delete(taskId);
      this.logger.log(`已取消 cron 任务: ${taskId}`);
    }

    // 清理一次性任务
    const timeout = this.activeTimeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeTimeouts.delete(taskId);
      this.logger.log(`已取消一次性任务: ${taskId}`);
    }
  }

  /**
   * 重新调度任务（用于更新后）
   */
  rescheduleTask(task: ScheduledTask): boolean {
    this.unscheduleTask(task.id);
    if (task.enabled) {
      return this.scheduleTask(task);
    }
    return false;
  }

  /**
   * 获取任务的调度状态
   */
  getTaskScheduleStatus(taskId: string): { scheduled: boolean; nextRun?: Date } {
    const hasCron = this.activeJobs.has(taskId);
    const hasTimeout = this.activeTimeouts.has(taskId);
    if (!hasCron && !hasTimeout) {
      return { scheduled: false };
    }
    return { scheduled: true };
  }

  /**
   * 验证 cron 表达式是否有效
   */
  validateCron(expression: string): boolean {
    return cron.validate(expression);
  }

  /**
   * 获取预设的 cron 表达式列表
   */
  getPresetCrons(): Array<{ label: string; expression: string }> {
    return [
      { label: "每分钟", expression: "* * * * *" },
      { label: "每5分钟", expression: "*/5 * * * *" },
      { label: "每15分钟", expression: "*/15 * * * *" },
      { label: "每30分钟", expression: "*/30 * * * *" },
      { label: "每小时", expression: "0 * * * *" },
      { label: "每2小时", expression: "0 */2 * * *" },
      { label: "每6小时", expression: "0 */6 * * *" },
      { label: "每12小时", expression: "0 */12 * * *" },
      { label: "每天 0 点", expression: "0 0 * * *" },
      { label: "每天 8 点", expression: "0 8 * * *" },
      { label: "每天 12 点", expression: "0 12 * * *" },
      { label: "每天 18 点", expression: "0 18 * * *" },
      { label: "每天 22 点", expression: "0 22 * * *" },
      { label: "每周一 8 点", expression: "0 8 * * 1" },
      { label: "每月1日 0 点", expression: "0 0 1 * *" },
    ];
  }

  /**
   * 任务是否已到期（expiresAt 存在且已过当前时间）
   */
  private isExpired(task: ScheduledTask): boolean {
    if (!task.expiresAt) return false;
    const t = new Date(task.expiresAt).getTime();
    return !isNaN(t) && t <= Date.now();
  }

  /**
   * 到期处理：取消调度并置为禁用，不再创建新的执行
   */
  private async expireTask(task: ScheduledTask): Promise<void> {
    this.logger.log(`任务已到期，自动暂停: ${task.name} (${task.id})`);
    this.unscheduleTask(task.id);
    await this.storage.updateTask(task.id, { enabled: false });
  }

  /**
   * 统一的触发派发入口：重读最新任务、到期检查、重叠守卫、执行
   * @returns 是否成功派发执行（用于决定是否推进 nextRunAt）
   */
  private async fireTask(task: ScheduledTask, label: string): Promise<boolean> {
    // 重读最新任务，反映运行期间对 enabled/expiresAt 的改动
    const fresh = await this.storage.getTaskById(task.id);
    if (!fresh || !fresh.enabled) {
      this.unscheduleTask(task.id);
      return false;
    }
    if (this.isExpired(fresh)) {
      await this.expireTask(fresh);
      return false;
    }
    if (this.runningTasks.has(task.id)) {
      this.logger.warn(`任务上次执行尚未结束，跳过本次${label}触发: ${task.name}`);
      return false;
    }

    this.runningTasks.add(task.id);
    try {
      this.logger.log(`${label} 触发执行任务: ${task.name} (${task.id})`);
      await this.executor.execute(fresh);
      return true;
    } catch (error) {
      this.logger.error(`${label} 任务执行异常: ${task.name}`, error);
      return false;
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * 更新任务的下次执行时间
   */
  async updateNextRunAt(task: ScheduledTask): Promise<void> {
    try {
      let nextRun: Date;

      if (task.scheduleType === "once" && task.executeAt) {
        nextRun = new Date(task.executeAt);
      } else {
        // 使用 cron-parser 计算下次执行时间
        const interval = cronParser.CronExpressionParser.parse(
          task.cronExpression,
          {
            tz: "Asia/Shanghai",
          },
        );
        nextRun = interval.next().toDate();
      }

      await this.storage.updateTask(task.id, {
        nextRunAt: nextRun.toISOString(),
      });
    } catch (error) {
      this.logger.error(`更新下次执行时间失败: ${task.id}`, error);
    }
  }
}
