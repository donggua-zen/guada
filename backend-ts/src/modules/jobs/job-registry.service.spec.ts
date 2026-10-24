import { JobRegistryService } from "./job-registry.service";
import {
  JOB_MAX_CONCURRENT_PER_SESSION,
  JOB_TERMINAL_TTL_MS,
  type JobOutcome,
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
});
