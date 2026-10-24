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
  let chatRunner: { enqueueMessage: jest.Mock };
  let notifier: JobNotifierService;

  beforeEach(() => {
    registry = new JobRegistryService({ emit: jest.fn() } as any);
    chatRunner = { enqueueMessage: jest.fn().mockResolvedValue(undefined) };
    notifier = new JobNotifierService(chatRunner as any, registry);
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it("shell 作业完成 → process_monitor 通知，带 jobId 且不含输出正文", async () => {
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

    // isValid 在标记已读后失效
    expect(params.isValid()).toBe(true);
    registry.markReported(id);
    expect(params.isValid()).toBe(false);

    // onConsumed 也会标记已读
    registry.markReported(id);
    params.onConsumed();
    expect(registry.get(id, "s1")?.reported).toBe(true);
  });

  it("reported / notify:false / workflow / scheduler 均不通知", async () => {
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

    const workflow = makeSpec({ kind: "workflow" });
    const workflowId = registry.start(workflow.spec);
    workflow.done.resolve({ status: "completed" });
    await flushAsync();
    await notifier.handleJobSettled({
      sessionId: "s1",
      job: registry.get(workflowId, "s1")!,
      notify: true,
    });

    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
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
});
