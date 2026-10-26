import { JobRegistryService } from "./job-registry.service";
import {
  JOB_CANCEL_WATCHDOG_MS,
  JOB_MAX_CONCURRENT_PER_SESSION,
  JOB_TERMINAL_TTL_MS,
  type JobOutcome,
  type JobSettledEvent,
  type JobStartSpec,
} from "./job.types";

/// <reference types="jest" />

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function makeSpec(
  overrides: Partial<JobStartSpec> = {},
): { spec: JobStartSpec; done: Deferred<JobOutcome> } {
  const done = deferred<JobOutcome>();
  const spec: JobStartSpec = {
    kind: "shell",
    label: "sleep 1",
    sessionId: "s1",
    handle: "1234",
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
  };
  return { spec, done };
}

describe("JobRegistryService", () => {
  let eventBus: { emit: jest.Mock };
  let registry: JobRegistryService;

  beforeEach(() => {
    eventBus = { emit: jest.fn() };
    registry = new JobRegistryService(eventBus as any);
  });

  afterEach(() => {
    registry.onModuleDestroy();
    jest.useRealTimers();
  });

  it("start 生成稳定 jobId，list/get 可用，settle first-wins", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec);

    expect(id).toMatch(/^job-/);
    expect(registry.has(id)).toBe(true);
    expect(registry.list("s1")).toEqual([
      expect.objectContaining({
        id,
        kind: "shell",
        label: "sleep 1",
        handle: "1234",
        status: "running",
      }),
    ]);

    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    expect(registry.get(id, "s1")).toEqual(
      expect.objectContaining({
        status: "completed",
        exitCode: 0,
        reported: false,
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "job.settled",
      expect.objectContaining({
        sessionId: "s1",
        notify: true,
        job: expect.objectContaining({ id, status: "completed" }),
      }),
    );

    // first-wins：后到的结算不能覆盖
    registry.settle(id, { status: "failed", detail: "late" });
    expect(registry.get(id, "s1")?.status).toBe("completed");
  });

  it("终态 read 置 reported，running read 不置", async () => {
    const read = jest.fn(async () => ({
      text: "hello",
      offset: 0,
      nextOffset: 5,
      size: 5,
      truncated: false,
    }));
    const { spec, done } = makeSpec({ read });
    const id = registry.start(spec);

    const running = await registry.read(id, "s1");
    expect(running.job.reported).toBe(false);

    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    const terminal = await registry.read(id, "s1");
    expect(terminal.job.reported).toBe(true);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
  });

  it("wait 超时返回 running，不杀 job；等待到终态置 reported", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec);

    const timedOut = await registry.wait(id, "s1", 10);
    expect(timedOut.status).toBe("running");
    expect(timedOut.reported).toBe(false);

    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    const settled = await registry.wait(id, "s1", 10);
    expect(settled.status).toBe("completed");
    expect(settled.reported).toBe(true);
  });

  it("kill 置 stopping/reported 并调用 cancel；终态后返回 already-finished", async () => {
    const cancel = jest.fn();
    const { spec, done } = makeSpec({ cancel });
    const id = registry.start(spec);

    expect(registry.kill(id, "s1", "test reason")).toBe("requested");
    expect(cancel).toHaveBeenCalledWith("test reason");
    expect(registry.get(id, "s1")).toEqual(
      expect.objectContaining({ status: "stopping", reported: true }),
    );

    done.resolve({ status: "killed" });
    await flushAsync();

    expect(registry.get(id, "s1")?.status).toBe("killed");
    expect(registry.kill(id, "s1")).toBe("already-finished");
  });

  it("每会话并发上限生效", () => {
    const keepAlive: Deferred<JobOutcome>[] = [];
    for (let i = 0; i < JOB_MAX_CONCURRENT_PER_SESSION; i++) {
      const { spec, done } = makeSpec({ label: `job-${i}` });
      registry.start(spec);
      keepAlive.push(done);
    }

    const { spec } = makeSpec({ label: "overflow" });
    expect(() => registry.start(spec)).toThrow(/background job limit/);
  });

  it("disposeSession 取消并移除该会话全部 job", async () => {
    const doneA = deferred<JobOutcome>();
    const cancelA = jest.fn(() => doneA.resolve({ status: "killed" }));
    const idA = registry.start(
      makeSpec({ label: "running", cancel: cancelA, done: doneA.promise }).spec,
    );

    const doneB = deferred<JobOutcome>();
    const idB = registry.start(
      makeSpec({ label: "finished", done: doneB.promise }).spec,
    );
    doneB.resolve({ status: "completed" });
    await flushAsync();

    await expect(registry.disposeSession("s1")).resolves.toBe(2);
    expect(cancelA).toHaveBeenCalledWith("session disposed");
    expect(registry.has(idA)).toBe(false);
    expect(registry.has(idB)).toBe(false);
    expect(registry.list("s1")).toEqual([]);
  });

  it("终态 job 超过 TTL 自动移除", async () => {
    jest.useFakeTimers();
    const { spec, done } = makeSpec();
    registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();

    expect(registry.list("s1")).toHaveLength(1);
    jest.advanceTimersByTime(JOB_TERMINAL_TTL_MS + 1);
    expect(registry.list("s1")).toEqual([]);
  });

  it("onReported 在终态 read/kill 时只调用一次", async () => {
    const onReported = jest.fn();
    const { spec, done } = makeSpec({ onReported });
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await flushAsync();

    await registry.read(id, "s1");
    registry.markReported(id);
    expect(onReported).toHaveBeenCalledTimes(1);

    const killDone = deferred<JobOutcome>();
    const killReported = jest.fn();
    const killId = registry.start(
      makeSpec({
        label: "kill-me",
        onReported: killReported,
        cancel: () => killDone.resolve({ status: "killed" }),
        done: killDone.promise,
      }).spec,
    );
    expect(registry.kill(killId, "s1")).toBe("requested");
    expect(killReported).toHaveBeenCalledTimes(1);
    killDone.resolve({ status: "killed" });
  });

  it("onDisposed 在 TTL 清理时只调用一次", async () => {
    jest.useFakeTimers();
    const onDisposed = jest.fn();
    const { spec, done } = makeSpec({ onDisposed });
    registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();

    jest.advanceTimersByTime(JOB_TERMINAL_TTL_MS + 1);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it("UI read（markReported=false）不抑制通知，模型 read 才置 reported", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed" });
    await flushAsync();

    const uiRead = await registry.read(id, "s1", {}, { markReported: false });
    expect(uiRead.job.reported).toBe(false);

    const modelRead = await registry.read(id, "s1");
    expect(modelRead.job.reported).toBe(true);
  });

  it("readIncremental 字节日志类：首读无 offset（尾部），二读从游标继续，REST read 不受游标影响", async () => {
    // 模拟一个增长的日志：read 按 offset 切片
    let logText = "hello world";
    const read = jest.fn(async (opts: any) => {
      const buf = Buffer.from(logText, "utf8");
      const maxBytes = opts.maxBytes ?? buf.length;
      const start =
        opts.offset === undefined
          ? Math.max(0, buf.length - maxBytes)
          : Math.min(opts.offset, buf.length);
      const end = Math.min(buf.length, start + maxBytes);
      return {
        text: buf.subarray(start, end).toString("utf8"),
        offset: start,
        nextOffset: end,
        size: buf.length,
        truncated: start > 0 || end < buf.length,
      };
    });
    const { spec } = makeSpec({ read });
    const id = registry.start(spec);

    // 首读：不带 offset（尾部语义）
    const first = await registry.readIncremental(id, "s1");
    expect(read).toHaveBeenNthCalledWith(1, { maxBytes: 65536 });
    expect(first.output.text).toBe("hello world");

    // 日志增长后：第二次从游标（11）继续，只拿到新增部分
    logText = "hello world appended";
    const second = await registry.readIncremental(id, "s1");
    expect(read).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 11, maxBytes: 65536 }),
    );
    expect(second.output.text).toBe(" appended");

    // REST 显式 offset 路径不受模型游标影响
    await registry.read(id, "s1", { offset: 0 }, { markReported: false });
    expect(read).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ offset: 0 }),
    );
  });

  it("readIncremental 内存文本类（subagent）：按最大上限一次给全", async () => {
    const read = jest.fn(async () => ({
      text: "final answer",
      offset: 0,
      nextOffset: 12,
      size: 12,
      truncated: false,
    }));
    const { spec } = makeSpec({ kind: "subagent", read });
    const id = registry.start(spec);

    const first = await registry.readIncremental(id, "s1");
    expect(read).toHaveBeenCalledWith({ maxBytes: 512 * 1024 });
    expect(first.output.text).toBe("final answer");

    // 第二次仍全量（无游标语义）
    await registry.readIncremental(id, "s1");
    expect(read).toHaveBeenNthCalledWith(2, { maxBytes: 512 * 1024 });
  });

  it("挂起通知：只在已结算且未读时生效，clear/take 语义正确", async () => {
    const a = makeSpec();
    const idA = registry.start(a.spec);
    const b = makeSpec();
    const idB = registry.start(b.spec);
    b.done.resolve({ status: "completed" });
    await flushAsync();
    const c = makeSpec();
    const idC = registry.start(c.spec);
    c.done.resolve({ status: "completed" });
    await flushAsync();
    registry.markReported(idC); // 已读的终态 job

    // running 的 job 不接受挂起
    registry.markNoticePending(idA);
    expect(registry.takePendingNotices("s1")).toEqual([]);

    // 已结算且未读 → 可挂起、可取出
    registry.markNoticePending(idB);
    const taken = registry.takePendingNotices("s1");
    expect(taken.map((j) => j.id)).toEqual([idB]);
    // 取出后清标记：再取为空
    expect(registry.takePendingNotices("s1")).toEqual([]);

    // 已读的 job 即使标记也不投
    registry.markNoticePending(idC);
    expect(registry.takePendingNotices("s1")).toEqual([]);

    // clear 幂等
    registry.markNoticePending(idB);
    registry.clearPendingNotices("s1");
    expect(registry.takePendingNotices("s1")).toEqual([]);
  });

  it("snapshot 带 logSize，ticker 推送全量 jobs 快照", async () => {
    jest.useFakeTimers();
    const getLogSize = jest.fn(async () => 42);
    const { spec } = makeSpec({ getLogSize });
    registry.start(spec);
    await flushAsync();

    const snap = await registry.snapshot("s1");
    expect(snap.jobs[0]).toMatchObject({ kind: "shell", logSize: 42 });
    expect(snap.revision).toBeGreaterThanOrEqual(0);

    eventBus.emit.mockClear();
    jest.advanceTimersByTime(1_000);
    await flushAsync();

    expect(eventBus.emit).toHaveBeenCalledWith(
      "jobs.changed",
      expect.objectContaining({
        sessionId: "s1",
        revision: expect.any(Number),
        jobs: expect.any(Array),
      }),
    );
  });

  it("disposeSession 同时触发 onReported 与 onDisposed", async () => {
    const onReported = jest.fn();
    const onDisposed = jest.fn();
    const done = deferred<JobOutcome>();
    const id = registry.start(
      makeSpec({
        onReported,
        onDisposed,
        cancel: () => done.resolve({ status: "killed" }),
        done: done.promise,
      }).spec,
    );

    await expect(registry.disposeSession("s1")).resolves.toBe(1);
    expect(registry.has(id)).toBe(false);
    expect(onReported).toHaveBeenCalledTimes(1);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it("跨会话访问被拒绝", () => {
    const { spec } = makeSpec();
    const id = registry.start(spec);
    expect(() => registry.get(id, "s2")).toThrow(/another session/);
  });

  it("snapshot 与 jobs.changed 都带稳定 bootId（后端重启识别）", async () => {
    const { spec } = makeSpec();
    registry.start(spec);
    await flushAsync();

    const first = await registry.snapshot("s1");
    const second = await registry.snapshot("s1");
    expect(typeof first.bootId).toBe("string");
    expect(first.bootId.length).toBeGreaterThan(0);
    expect(second.bootId).toBe(first.bootId);

    // 空会话分支也要带 bootId（前端基线走这条）
    const empty = await registry.snapshot("s2");
    expect(empty.bootId).toBe(first.bootId);
    expect(empty.jobs).toEqual([]);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "jobs.changed",
      expect.objectContaining({ sessionId: "s1", bootId: first.bootId }),
    );
  });

  it("settle 收到非终态 status → 收敛为 failed，不再占配额", async () => {
    const { spec } = makeSpec();
    const id = registry.start(spec);

    // 模拟执行器异步通道传错状态（类型守卫只在编译期生效）
    registry.settle(id, { status: "running" } as unknown as JobOutcome);

    const snap = registry.get(id, "s1")!;
    expect(snap.status).toBe("failed");
    expect(snap.detail).toContain("invalid terminal status");
    expect(registry.hasActiveJobs()).toBe(false);
  });

  it("kill 后执行器不结算 → 看门狗兜底 killed，配额释放", async () => {
    jest.useFakeTimers();
    // done 永不 resolve：模拟执行器漏掉结算
    const { spec } = makeSpec({ cancel: jest.fn() });
    const id = registry.start(spec);

    expect(registry.kill(id, "s1", "test")).toBe("requested");
    expect(registry.get(id, "s1")!.status).toBe("stopping");

    jest.advanceTimersByTime(JOB_CANCEL_WATCHDOG_MS);
    await flushAsync();

    const snap = registry.get(id, "s1")!;
    expect(snap.status).toBe("killed");
    expect(snap.detail).toContain("cancel watchdog");
    expect(registry.hasActiveJobs()).toBe(false);
  });

  it("onModuleDestroy 清掉取消看门狗（不阻塞进程退出）", () => {
    jest.useFakeTimers();
    const { spec } = makeSpec({ cancel: jest.fn() });
    const id = registry.start(spec);
    registry.kill(id, "s1");

    expect(jest.getTimerCount()).toBeGreaterThan(0);
    registry.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("notify 默认值按 kind 归一化：workflow/scheduler 静默、显式优先生效", async () => {
    const captured: JobSettledEvent[] = [];
    eventBus.emit.mockImplementation((name: string, payload: unknown) => {
      if (name === "job.settled") captured.push(payload as JobSettledEvent);
    });

    const notifyOf = async (
      overrides: Partial<JobStartSpec>,
    ): Promise<boolean | undefined> => {
      captured.length = 0;
      const { spec, done } = makeSpec(overrides);
      registry.start(spec);
      done.resolve({ status: "completed" });
      await flushAsync();
      return captured[0]?.notify;
    };

    expect(await notifyOf({ kind: "workflow" })).toBe(false);
    expect(await notifyOf({ kind: "scheduler" })).toBe(false);
    expect(await notifyOf({ kind: "shell" })).toBe(true);
    expect(await notifyOf({ kind: "subagent" })).toBe(true);
    // 显式传入优先于 kind 默认值
    expect(await notifyOf({ kind: "workflow", notify: true })).toBe(true);
    expect(await notifyOf({ kind: "shell", notify: false })).toBe(false);
  });

  it("只有字节日志类写 logSize（内存文本类不产生假日志大小）", async () => {
    const read = jest.fn(async () => ({
      text: "x",
      offset: 0,
      nextOffset: 1,
      size: 999,
      truncated: false,
    }));

    const shellId = registry.start(makeSpec({ read }).spec);
    const shellRead = await registry.read(shellId, "s1");
    expect(shellRead.job.logSize).toBe(999);

    const subagentId = registry.start(makeSpec({ kind: "subagent", read }).spec);
    const subagentRead = await registry.read(subagentId, "s1");
    expect(subagentRead.job.logSize).toBeUndefined();
  });
});
