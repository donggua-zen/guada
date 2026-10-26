import { JobRegistryService } from "./job-registry.service";
import { JobNotifierService } from "./job-notifier.service";
import type { JobOutcome, JobStartSpec } from "./job.types";

/// <reference types="jest" />

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSpec(
  overrides: Partial<JobStartSpec> = {},
): { spec: JobStartSpec; done: ReturnType<typeof deferred<JobOutcome>> } {
  const done = deferred<JobOutcome>();
  return {
    done,
    spec: {
      kind: "shell",
      label: "echo hi",
      sessionId: "s1",
      handle: "123",
      logFilePath: "/tmp/guada.log",
      read: jest.fn(async () => ({
        text: "hello",
        offset: 0,
        nextOffset: 5,
        size: 5,
        truncated: false,
      })),
      cancel: jest.fn(),
      done: done.promise,
      ...overrides,
    },
  };
}

async function flushAsync(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("JobNotifierService", () => {
  let registry: JobRegistryService;
  let chatRunner: { enqueueMessage: jest.Mock; hasActiveStream: jest.Mock };
  let notifier: JobNotifierService;

  beforeEach(() => {
    registry = new JobRegistryService({ emit: jest.fn() } as any);
    chatRunner = {
      enqueueMessage: jest.fn().mockResolvedValue(undefined),
      hasActiveStream: jest.fn(() => false),
    };
    notifier = new JobNotifierService(chatRunner as any, registry);
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it("shell 作业空闲完成 → 立即投递 process_monitor 通知，投递即置 reported", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
    const params = chatRunner.enqueueMessage.mock.calls[0][0];
    expect(params.sessionId).toBe("s1");
    expect(params.source).toEqual(
      expect.objectContaining({
        kind: "process_monitor",
        jobId: id,
        processId: "123",
      }),
    );
    expect(params.blocks[0].text).toContain(id);
    expect(params.blocks[0].text).toContain("job_read");
    expect(params.blocks[0].text).toContain("/tmp/guada.log");
    expect(params.blocks[0].text).not.toContain("hello");

    // 不再有 isValid/onConsumed 闭包；投递那一刻即视为已通告
    expect(params.isValid).toBeUndefined();
    expect(params.onConsumed).toBeUndefined();
    expect(registry.get(id, "s1")?.reported).toBe(true);
  });

  it("会话运行中完成 → 只挂起不投递；回合正常收尾后恰好投一次", async () => {
    chatRunner.hasActiveStream.mockReturnValue(true);
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });
    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();

    // 回合结束：先恢复空闲，再收正常收尾信号
    chatRunner.hasActiveStream.mockReturnValue(false);
    await notifier.handleTurnFinished({
      sessionId: "s1",
      normalFinish: true,
    });

    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
    expect(registry.get(id, "s1")?.reported).toBe(true);

    // 再收一次收尾信号不会重复投递（挂起已取走）
    await notifier.handleTurnFinished({ sessionId: "s1", normalFinish: true });
    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
  });

  it("回合开始清除挂起：再收尾不再投递", async () => {
    chatRunner.hasActiveStream.mockReturnValue(true);
    const { spec, done } = makeSpec();
    registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(registry.list("s1")[0].id, "s1")!,
      notify: true,
    });

    // 会话再次运行（新用户回合）→ 挂起作废
    notifier.handleStreamStatusChanged({
      sessionId: "s1",
      payload: { status: "running" },
    });
    chatRunner.hasActiveStream.mockReturnValue(false);
    await notifier.handleTurnFinished({ sessionId: "s1", normalFinish: true });

    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
  });

  it("user_cancel / 异常收尾不投递（挂起保留到下次回合开始被清除）", async () => {
    chatRunner.hasActiveStream.mockReturnValue(true);
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    chatRunner.hasActiveStream.mockReturnValue(false);
    await notifier.handleTurnFinished({
      sessionId: "s1",
      reason: "user_cancel",
      normalFinish: false,
    });
    await notifier.handleTurnFinished({
      sessionId: "s1",
      reason: "error",
      normalFinish: false,
    });

    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
    expect(registry.get(id, "s1")?.reported).toBe(false);
  });

  it("已 reported 的挂起项在收尾时被跳过（drain/job_read 已消费）", async () => {
    chatRunner.hasActiveStream.mockReturnValue(true);
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    registry.markReported(id); // 模拟回合内 job_read / drain
    chatRunner.hasActiveStream.mockReturnValue(false);
    await notifier.handleTurnFinished({ sessionId: "s1", normalFinish: true });

    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
  });

  it("reported / notify:false 均不通知", async () => {
    const reported = makeSpec();
    const reportedId = registry.start(reported.spec);
    reported.done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: { ...registry.get(reportedId, "s1")!, reported: true },
      notify: true,
    });

    const silent = makeSpec({ notify: false });
    const silentId = registry.start(silent.spec);
    silent.done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(silentId, "s1")!,
      notify: false,
    });

    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
  });

  it("workflow / scheduler 的静默由 registry 的 notify 默认值承担（投递侧不再按 kind 判断）", async () => {
    // registry 侧：不传 notify 的 workflow 归一化为 false（默认值唯一来源在 start）
    const workflow = makeSpec({ kind: "workflow" });
    const workflowId = registry.start(workflow.spec);
    workflow.done.resolve({ status: "completed" });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(workflowId, "s1")!,
      notify: false,
    });
    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();

    // 显式 notify:true 覆盖默认 → 投递侧照常通知（不再有 kind 二次门）
    const forced = makeSpec({ kind: "workflow", notify: true });
    const forcedId = registry.start(forced.spec);
    forced.done.resolve({ status: "completed" });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(forcedId, "s1")!,
      notify: true,
    });
    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
  });

  it("subagent 作业映射到 sub_agent source", async () => {
    const { spec, done } = makeSpec({
      kind: "subagent",
      label: "researcher",
      handle: "sub-1",
    });
    const id = registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    const params = chatRunner.enqueueMessage.mock.calls[0][0];
    expect(params.source).toEqual(
      expect.objectContaining({
        kind: "sub_agent",
        subSessionId: "sub-1",
        jobId: id,
      }),
    );
  });

  it("job 工具族对该会话隐藏时，通知正文不带 Use job_read 指引", async () => {
    const pluginManager = {
      resolvePlugins: jest.fn(async () => [
        {
          plugin: { id: "jobs" },
          enabledToolKits: [{ id: "jobs", loadMode: "none" }],
        },
      ]),
    };
    const sessionService = {
      getSessionById: jest.fn(async () => ({ settings: {} })),
    };
    notifier = new JobNotifierService(
      chatRunner as any,
      registry,
      pluginManager as any,
      sessionService as any,
    );

    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    expect(pluginManager.resolvePlugins).toHaveBeenCalledWith(
      undefined,
      undefined,
      true,
    );
    const text = chatRunner.enqueueMessage.mock.calls[0][0].blocks[0].text;
    expect(text).not.toContain("Use job_read");
    // 状态正文照常保留（工具隐藏只影响指引，不影响通知本身）
    expect(text).toContain(`Background job ${id}`);
  });

  it("入队失败不吞通知：reported 保持 false", async () => {
    chatRunner.enqueueMessage.mockRejectedValueOnce(new Error("queue down"));
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });

    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
    // 旧实现"先 markReported 再入队"，失败即永久丢通知；现在必须保持未通告
    expect(registry.get(id, "s1")?.reported).toBe(false);
  });

  it("投递失败后下一次回合正常收尾补投，且只投一次", async () => {
    chatRunner.enqueueMessage.mockRejectedValueOnce(new Error("queue down"));
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(id, "s1")!,
      notify: true,
    });
    expect(registry.get(id, "s1")?.reported).toBe(false);

    await notifier.handleTurnFinished({ sessionId: "s1", normalFinish: true });
    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(2);
    expect(registry.get(id, "s1")?.reported).toBe(true);

    // 已通告后再收尾不重复投递
    await notifier.handleTurnFinished({ sessionId: "s1", normalFinish: true });
    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(2);
  });

  it("同一 job 并发投递只入队一次（inFlight 去重）", async () => {
    let release: (() => void) | undefined;
    chatRunner.enqueueMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    const job = registry.get(id, "s1")!;
    const first = notifier.handleJobSettled({
      sessionId: "s1",
      job,
      notify: true,
    });
    const second = notifier.handleJobSettled({
      sessionId: "s1",
      job,
      notify: true,
    });
    await flushAsync();
    release?.();
    await Promise.all([first, second]);

    expect(chatRunner.enqueueMessage).toHaveBeenCalledTimes(1);
    expect(registry.get(id, "s1")?.reported).toBe(true);
  });
});
