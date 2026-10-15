/**
 * TaskSchedulerService —— 定时任务「错过窗口」的留痕。
 *
 * 背景：电脑休眠、应用未运行、事件循环长时间阻塞都会让计划窗口漏跑。
 * 旧行为是彻底静默（用户只看到「任务没跑」），这里钉住三条补记路径：
 *  ① cron 运行期：node-cron 的 execution:missed（同一突发的多个槽位合并成一条）
 *  ② 启动对账：nextRunAt 停在过去（关机/休眠期间应用没开）
 *  ③ 一次性任务：执行时刻已过 → 记 missed 且停用（错过即终态）
 *
 * 手法：node-cron 换成可控假 job（真实触发错过窗口需要真的睡一觉），
 * 存储用真实的 TaskStorageService + 临时 USERDATA_DIR，断言落在真的落盘日志上。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { TaskStorageService } from "../../src/modules/scheduler/task-storage.service";
import { TaskSchedulerService } from "../../src/modules/scheduler/task-scheduler.service";
import { ScheduledTask, ScheduledTaskLog } from "../../src/modules/scheduler/types/scheduler.types";

const mockScheduledJobs: Array<{
  job: { __handlers: Map<string, (context: any) => void>; __callback: () => Promise<void> };
  expression: string;
}> = [];

jest.mock("node-cron", () => ({
  validate: () => true,
  schedule: (expression: string, callback: () => Promise<void>) => {
    const handlers = new Map<string, (context: any) => void>();
    const job = {
      __handlers: handlers,
      __callback: callback,
      on: (event: string, handler: (context: any) => void) => {
        handlers.set(event, handler);
      },
      stop: () => undefined,
    };
    mockScheduledJobs.push({ job, expression });
    return job;
  },
}));

function makeCronTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const now = new Date().toISOString();
  return {
    id: "task-cron-1",
    name: "每分钟任务",
    prompt: "跑一下",
    scheduleType: "cron",
    cronExpression: "* * * * *",
    targetMode: "new_session",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ScheduledTask;
}

describe("TaskSchedulerService 错过窗口留痕", () => {
  let tmpRoot: string;
  const savedUserdataDir = process.env.USERDATA_DIR;
  let storage: TaskStorageService;
  let scheduler: TaskSchedulerService;
  let executor: { execute: jest.Mock };

  /** 等日志落盘（突发合并窗口 2s，用真实定时器轮询） */
  async function waitForLogs(timeoutMs = 8000): Promise<ScheduledTaskLog[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const logs = await storage.getAllLogs();
      if (logs.length > 0) return logs;
      if (Date.now() > deadline) throw new Error("等待错过窗口日志超时");
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-missed-"));
    process.env.USERDATA_DIR = tmpRoot;
    mockScheduledJobs.length = 0;

    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    storage = new TaskStorageService();
    executor = { execute: jest.fn().mockResolvedValue(undefined) };
    scheduler = new TaskSchedulerService(storage, executor as any);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (savedUserdataDir === undefined) delete process.env.USERDATA_DIR;
    else process.env.USERDATA_DIR = savedUserdataDir;
  });

  it("cron 运行期错过多个槽位 → 合并成一条 missed 日志（含次数与最近时刻）", async () => {
    const task = makeCronTask();
    await storage.createTask(task);

    expect(scheduler.scheduleTask(task)).toBe(true);
    const job = mockScheduledJobs[mockScheduledJobs.length - 1].job;
    const handler = job.__handlers.get("execution:missed");
    expect(handler).toBeDefined();

    const now = Date.now();
    handler!({ date: new Date(now - 3 * 60_000) });
    handler!({ date: new Date(now - 2 * 60_000) });
    handler!({ date: new Date(now - 60_000) });

    const logs = await waitForLogs();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ taskId: task.id, status: "missed" });
    expect(logs[0].reason).toContain("3 次");
    // startedAt 取最近一次计划时刻：历史时间线按它排序，用发现时刻会错位到现在
    expect(logs[0].startedAt).toBe(new Date(now - 60_000).toISOString());
  });

  it("启动对账：nextRunAt 停在过去 → 记 missed（数出错过次数），任务照常重排", async () => {
    const task = makeCronTask({
      nextRunAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    await storage.createTask(task);

    await scheduler.onModuleInit();

    const logs = await waitForLogs();
    expect(logs[0]).toMatchObject({ taskId: task.id, status: "missed" });
    const count = Number(/错过 (\d+) 次/.exec(logs[0].reason ?? "")?.[1]);
    expect(count).toBeGreaterThanOrEqual(9);
    expect(count).toBeLessThanOrEqual(11);

    const fresh = await storage.getTaskById(task.id);
    expect(fresh!.enabled).toBe(true);
    expect(new Date(fresh!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("启动对账：nextRunAt 在宽限内（刚过点）→ 不记 missed，不误报", async () => {
    const task = makeCronTask({
      nextRunAt: new Date(Date.now() - 30_000).toISOString(),
    });
    await storage.createTask(task);

    await scheduler.onModuleInit();

    await expect(storage.getAllLogs()).resolves.toHaveLength(0);
  });

  it("一次性任务执行时刻已过 → 记 missed 并停用（错过即终态）", async () => {
    const task = makeCronTask({
      id: "task-once-1",
      name: "一次性提醒",
      scheduleType: "once",
      executeAt: new Date(Date.now() - 60_000).toISOString(),
      cronExpression: "",
    });
    await storage.createTask(task);

    await scheduler.onModuleInit();

    const logs = await waitForLogs();
    expect(logs[0]).toMatchObject({ taskId: task.id, status: "missed" });
    expect(logs[0].reason).toContain("一次性");

    const fresh = await storage.getTaskById(task.id);
    expect(fresh!.enabled).toBe(false);
  });

  it("派发尝试过就推进 nextRunAt（执行失败也不留过期水位，避免下次启动被误判错过）", async () => {
    const task = makeCronTask({
      id: "task-advance-1",
      cronExpression: "*/5 * * * *",
      nextRunAt: new Date().toISOString(),
    });
    await storage.createTask(task);
    executor.execute.mockRejectedValue(new Error("boom"));

    scheduler.scheduleTask(task);
    const job = mockScheduledJobs[mockScheduledJobs.length - 1].job;
    await job.__callback();

    const fresh = await storage.getTaskById(task.id);
    expect(new Date(fresh!.nextRunAt!).getTime()).toBeGreaterThan(Date.now() + 60_000);
    // 失败由执行日志负责呈现，不应该再被记成「错过」
    await expect(storage.getAllLogs()).resolves.toHaveLength(0);
  });
});
