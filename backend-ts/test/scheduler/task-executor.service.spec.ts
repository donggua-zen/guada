import { TaskExecutorService } from "../../src/modules/scheduler/task-executor.service";
import { JobRegistryService } from "../../src/modules/jobs/job-registry.service";

/// <reference types="jest" />

function makeTask(overrides: Record<string, any> = {}): any {
  return {
    id: "task-1",
    name: "daily report",
    prompt: "summarize",
    scheduleType: "cron",
    cronExpression: "0 9 * * *",
    maxRetries: 0,
    retryInterval: 1,
    ...overrides,
  };
}

async function flushAsync(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("TaskExecutorService × JobRegistry", () => {
  let registry: JobRegistryService;
  let service: TaskExecutorService;
  let chatRunner: any;
  let storage: any;
  let logs: any[];

  beforeEach(() => {
    logs = [];
    registry = new JobRegistryService({ emit: jest.fn() } as any);
    chatRunner = {
      enqueueMessage: jest.fn(async () => undefined),
      cancelStream: jest.fn(),
      peekQueuedMessage: jest.fn(() => []),
    };
    storage = {
      createLog: jest.fn(async (log: any) => {
        logs.push(log);
      }),
      updateLog: jest.fn(async (id: string, patch: any) => {
        const log = logs.find((entry) => entry.id === id);
        if (log) Object.assign(log, patch);
      }),
      getLogsByTaskId: jest.fn(async () => logs),
      updateTask: jest.fn(async () => undefined),
      getTaskById: jest.fn(async () => makeTask()),
      cleanupOldLogs: jest.fn(async () => undefined),
    };
    service = new TaskExecutorService(
      {} as any,
      chatRunner,
      { emit: jest.fn() } as any,
      storage,
      {} as any,
      {} as any,
      {} as any,
      registry,
    );
    jest
      .spyOn(service as any, "prepareSession")
      .mockResolvedValue({ sessionId: "s1" });
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it("execute 注册 scheduler job；回合完成回调结算 job 并可读日志", async () => {
    const task = makeTask();
    await service.execute(task);
    await flushAsync();

    const job = registry.list("s1").find((entry) => entry.kind === "scheduler");
    expect(job).toBeTruthy();
    expect(job).toMatchObject({
      label: "daily report",
      status: "running",
      handle: logs[0].id,
    });
    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);

    const callbacks = chatRunner.enqueueMessage.mock.calls[0][0].callbacks;
    callbacks.onComplete("completed");
    await flushAsync();

    const settled = await registry.wait(job!.id, "s1", 1000);
    expect(settled.status).toBe("completed");
    expect(logs[0].status).toBe("completed");

    const read = await registry.read(job!.id, "s1");
    expect(read.output.text).toContain("Scheduled task execution");
    expect(read.output.text).toContain("status: completed");
  });

  it("job_kill 取消 scheduler 执行并移除排队消息", async () => {
    chatRunner.peekQueuedMessage.mockReturnValue([
      { onConsumed: jest.fn() },
    ]);
    await service.execute(makeTask());
    await flushAsync();

    const job = registry.list("s1").find((entry) => entry.kind === "scheduler")!;
    expect(registry.kill(job.id, "s1", "no longer needed")).toBe("requested");

    const settled = await registry.wait(job.id, "s1", 1000);
    expect(settled.status).toBe("killed");
    expect(chatRunner.cancelStream).toHaveBeenCalledWith("s1");
    expect(chatRunner.peekQueuedMessage).toHaveBeenCalled();
    expect(logs[0]).toMatchObject({
      status: "failed",
      error: "no longer needed",
    });
  });

  it("enqueue 最终失败时 job 结算 failed", async () => {
    chatRunner.enqueueMessage.mockRejectedValue(
      Object.assign(new Error("session busy"), {
        response: { code: "SESSION_BUSY" },
      }),
    );

    await service.execute(makeTask({ maxRetries: 0 }));
    await flushAsync();

    const job = registry.list("s1").find((entry) => entry.kind === "scheduler")!;
    const settled = await registry.wait(job.id, "s1", 1000);
    expect(settled.status).toBe("failed");
    expect(logs[0].status).toBe("failed");
  });
});
