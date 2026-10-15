import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import * as cron from "node-cron";
import * as cronParser from "cron-parser";
import { TaskStorageService } from "./task-storage.service";
import { TaskExecutorService } from "./task-executor.service";
import { ScheduledTask } from "./types/scheduler.types";
import { ID_PREFIXES, mintId } from "../../common/utils/id.util";

/**
 * 错过窗口的宽限：计划时刻比「现在」早出这个量，才算错过，不补跑。
 *
 * 取值参考同类实现（zcode 的 misfire 宽限同为 5 分钟）：明显大于一次正常 tick 延迟，
 * 又能容忍短暂卡顿。注意 node-cron 的补跑上限还会被槽位间隔进一步压住
 * （槽位间隔 < 宽限时以间隔为准），所以「每分钟」任务最多只会晚 1 分钟补跑，
 * 不会出现漏几拍后连跑多次。
 */
const MISSED_WINDOW_GRACE_MS = 5 * 60_000;
/** 错过槽位的合并窗口：一次长休眠可能连丢多个槽位，合并成一条日志再落盘 */
const MISSED_BURST_FLUSH_MS = 2_000;
/** 单次对账的错过次数上限：超长停机时避免把日志写爆 */
const MISSED_COUNT_CAP = 500;

/** 计划时刻的展示格式（本机时区，分钟精度足够；cron 计算用 Asia/Shanghai） */
function formatSlotTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 定时任务调度管理服务
 *
 * 负责：
 * 1. 启动时从文件加载所有启用的任务并注册到 cron
 * 2. 运行时动态添加/移除/更新任务调度
 * 3. 模块销毁时清理所有定时器
 * 4. 记录「错过窗口」：电脑休眠/应用未运行/进程阻塞导致的漏跑，不补跑但必须留痕
 */
@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private readonly activeJobs = new Map<string, cron.ScheduledTask>();
  private readonly activeTimeouts = new Map<string, NodeJS.Timeout>();
  /** 重叠守卫：正在派发执行中的任务 id，防止上一次未结束时被再次触发 */
  private readonly runningTasks = new Set<string>();
  /** 待落盘的错过槽位突发（taskId → 合并窗口），见 recordMissedSlot */
  private readonly missedBursts = new Map<
    string,
    { count: number; firstAt: Date; lastAt: Date; timer: NodeJS.Timeout }
  >();

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
        // 启动对账要早于 scheduleTask：后者会立刻把 nextRunAt 推进到未来，
        // 一旦推进，过去那些槽位就再也无从判断
        await this.reconcileMissedWindowsOnStartup(task);
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

    for (const burst of this.missedBursts.values()) {
      clearTimeout(burst.timer);
    }
    this.missedBursts.clear();
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
      // 一次性任务的语义是「在某个确定时刻执行一次」，时刻已过即终态：
      // 补记一条 missed（用户要能看到它为什么没跑）并停用，不留一个永远不触发的启用任务。
      this.logger.warn(`一次性任务执行时间已过，记为错过并停用: ${task.id}`);
      void this.recordOnceMissed(task, executeTime);
      this.storage.updateTask(task.id, { enabled: false }).catch((err) => {
        this.logger.error(`停用错过的一次性任务失败: ${task.id}`, err);
      });
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
        // 派发尝试过就推进 nextRunAt：无论成功、失败还是被重叠守卫挡下，该槽位都已被消费。
        // 不推进会让它定格在过去，下次启动对账时被误判成「错过窗口」。
        await this.fireTask(task, "Cron");
        await this.updateNextRunAt(task);
      },
      {
        scheduled: true,
        timezone: "Asia/Shanghai",
        runOnInit: false,
        // 迟到不超过宽限的槽位照常补跑（电脑刚从短暂休眠醒来/事件循环短暂卡顿）；
        // 更晚的槽位由 node-cron 判为 missed，落到下面的留痕逻辑
        missedExecutionTolerance: MISSED_WINDOW_GRACE_MS,
        // 错过告警自己记（且做了合并），不需要 node-cron 再按槽位刷日志
        suppressMissedWarning: true,
      } as any,
    );

    job.on("execution:missed", (context) => {
      const raw = context?.date as unknown;
      const slot = raw instanceof Date ? raw : new Date(String(raw));
      if (isNaN(slot.getTime())) return;
      this.recordMissedSlot(task, slot);
    });

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
   * @returns 是否成功派发执行（供日志/诊断；nextRunAt 的推进与否不再取决于它）
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
   * 记录一个被错过的 cron 槽位（node-cron 的 execution:missed）。
   *
   * 一次长休眠会连着丢多个槽位，这里按 MISSED_BURST_FLUSH_MS 窗口合并成一条含次数的日志；
   * 否则「每分钟」类任务睡一小时就会刷出 60 条。不补跑是刻意的：错过 5 分钟以上的
   * 任务在醒来后立刻执行往往已无意义（zcode 的 misfire 策略同样是不补跑、只留痕）。
   */
  private recordMissedSlot(task: ScheduledTask, slot: Date): void {
    const existing = this.missedBursts.get(task.id);
    if (existing) {
      existing.count += 1;
      if (slot.getTime() < existing.firstAt.getTime()) existing.firstAt = slot;
      if (slot.getTime() > existing.lastAt.getTime()) existing.lastAt = slot;
      return;
    }
    const timer = setTimeout(() => {
      void this.flushMissedBurst(task.id);
    }, MISSED_BURST_FLUSH_MS);
    this.missedBursts.set(task.id, { count: 1, firstAt: slot, lastAt: slot, timer });
  }

  private async flushMissedBurst(taskId: string): Promise<void> {
    const burst = this.missedBursts.get(taskId);
    if (!burst) return;
    this.missedBursts.delete(taskId);
    clearTimeout(burst.timer);
    await this.writeMissedLog({
      taskId,
      count: burst.count,
      firstAt: burst.firstAt,
      lastAt: burst.lastAt,
      cause: "电脑休眠、应用被挂起或进程长时间阻塞",
    });
  }

  /** 一次性任务的执行时刻已过：记一条 missed（停用由调用方完成） */
  private async recordOnceMissed(task: ScheduledTask, executeTime: Date): Promise<void> {
    await this.writeMissedLog({
      taskId: task.id,
      count: 1,
      firstAt: executeTime,
      lastAt: executeTime,
      cause: "一次性任务的执行时刻已过（应用未运行或电脑休眠）",
    });
  }

  /**
   * 启动对账：上次运行后应用可能一直没开（关机/休眠/强退），nextRunAt 定格在过去。
   * 这些槽位 node-cron 再也看不到（它只从 now 往后排），所以在这里补记，避免用户完全无感知。
   * 任务本身照常重新排程，不受影响。
   */
  private async reconcileMissedWindowsOnStartup(task: ScheduledTask): Promise<void> {
    if (task.scheduleType !== "cron" || !task.nextRunAt || !task.cronExpression) return;
    const plannedAt = new Date(task.nextRunAt);
    if (isNaN(plannedAt.getTime())) return;
    if (Date.now() - plannedAt.getTime() <= MISSED_WINDOW_GRACE_MS) return;

    const { count, firstAt, lastAt } = this.countMissedSlots(task.cronExpression, plannedAt);
    await this.writeMissedLog({
      taskId: task.id,
      count,
      firstAt,
      lastAt,
      cause: "应用未运行期间（关机/休眠/退出）",
    });
  }

  /** 从 from 起按 cron 表达式数到今天为止错过的槽位（带上限，避免超长停机把日志写爆） */
  private countMissedSlots(
    cronExpression: string,
    from: Date,
  ): { count: number; firstAt: Date; lastAt: Date } {
    let count = 0;
    let firstAt = from;
    let lastAt = from;
    try {
      const interval = cronParser.CronExpressionParser.parse(cronExpression, {
        tz: "Asia/Shanghai",
        // 从计划时刻的前一刻起算，firstAt 才能取到计划时刻本身
        currentDate: new Date(from.getTime() - 1),
      });
      const nowMs = Date.now();
      while (count < MISSED_COUNT_CAP) {
        const next = interval.next().toDate();
        if (next.getTime() > nowMs) break;
        if (count === 0) firstAt = next;
        lastAt = next;
        count += 1;
      }
    } catch (error) {
      this.logger.warn(`统计错过槽位失败，按单次处理: ${cronExpression}`, error);
    }
    return { count: Math.max(count, 1), firstAt, lastAt };
  }

  /**
   * 写一条「错过窗口」日志。
   * startedAt 用最近一次计划时刻而非写入时刻：历史时间线按 startedAt 排序，
   * 用计划时刻才能让这条记录落在它本该出现的位置。
   */
  private async writeMissedLog(params: {
    taskId: string;
    count: number;
    firstAt: Date;
    lastAt: Date;
    cause: string;
  }): Promise<void> {
    const reason =
      params.count > 1
        ? `错过 ${params.count} 次计划执行（${formatSlotTime(params.firstAt)} ~ ${formatSlotTime(params.lastAt)}）：${params.cause}`
        : `错过 ${formatSlotTime(params.lastAt)} 的计划执行：${params.cause}`;
    try {
      await this.storage.createLog({
        id: mintId(ID_PREFIXES.taskLog),
        taskId: params.taskId,
        status: "missed",
        reason,
        startedAt: params.lastAt.toISOString(),
        finishedAt: new Date().toISOString(),
      });
      this.logger.warn(`任务错过执行窗口: task=${params.taskId} count=${params.count}`);
    } catch (error) {
      this.logger.error(`写入错过窗口日志失败: ${params.taskId}`, error);
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
