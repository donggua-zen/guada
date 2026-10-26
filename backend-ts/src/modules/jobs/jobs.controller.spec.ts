import { HttpException } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JobRegistryService } from "./job-registry.service";
import type { JobOutcome, JobStartSpec } from "./job.types";

/// <reference types="jest" />

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSpec(overrides: Partial<JobStartSpec> = {}) {
  const done = deferred<JobOutcome>();
  const spec: JobStartSpec = {
    kind: "shell",
    label: "echo hi",
    sessionId: "s1",
    handle: "p1",
    logFilePath: "/tmp/job.log",
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

describe("JobsController", () => {
  let registry: JobRegistryService;
  let controller: JobsController;

  beforeEach(() => {
    registry = new JobRegistryService({ emit: jest.fn() } as any);
    controller = new JobsController(registry);
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it("GET jobs 返回 revision + jobs", async () => {
    const { spec } = makeSpec();
    const id = registry.start(spec);

    const result = await controller.listJobs("s1");
    expect(result.jobs).toEqual([
      expect.objectContaining({ id, kind: "shell", handle: "p1" }),
    ]);
    expect(typeof result.revision).toBe("number");
  });

  it("POST kill 返回状态", () => {
    const { spec } = makeSpec();
    const id = registry.start(spec);

    const result = controller.killJob("s1", id, "test");
    expect(result).toMatchObject({ success: true, status: "stopping" });
    expect(registry.get(id, "s1")?.reported).toBe(true);
  });

  it("GET output 不吞掉模型完成通知（markReported=false）", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec);
    done.resolve({ status: "completed", exitCode: 0 });
    await Promise.resolve();
    await Promise.resolve();

    const output = await controller.readJobOutput("s1", id);
    expect(output).toMatchObject({
      text: "hello",
      status: "completed",
      exitCode: 0,
      logFilePath: "/tmp/job.log",
    });
    expect(registry.get(id, "s1")?.reported).toBe(false);
  });

  it("未知 job → 404", async () => {
    await expect(
      controller.readJobOutput("s1", "job-missing"),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("错误分层：参数非法 400、未知/跨会话 404、读取失败 500", async () => {
    const { spec } = makeSpec();
    const id = registry.start(spec);

    // 参数非法
    await expect(
      controller.readJobOutput("s1", id, "abc"),
    ).rejects.toMatchObject({ status: 400 });

    // 未知作业（kill 与 output 两条路径）
    await expect(controller.readJobOutput("s1", "job-missing")).rejects.toMatchObject({
      status: 404,
    });
    let killError: any;
    try {
      controller.killJob("s1", "job-missing");
    } catch (error) {
      killError = error;
    }
    expect(killError?.status).toBe(404);

    // 跨会话访问按"不可见"处理
    await expect(controller.readJobOutput("s2", id)).rejects.toMatchObject({
      status: 404,
    });

    // 执行器读取失败不能谎报 404
    const broken = makeSpec({
      read: jest.fn(async () => {
        throw new Error("disk on fire");
      }),
    });
    const brokenId = registry.start(broken.spec);
    await expect(
      controller.readJobOutput("s1", brokenId),
    ).rejects.toMatchObject({ status: 500 });
  });
});
