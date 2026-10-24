import { JobRegistryService } from "./job-registry.service";
import { JobsPlugin } from "./jobs.plugin";
import type { JobId, JobOutcome } from "./job.types";

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

function makeSpec(overrides: Record<string, any> = {}) {
  const done = deferred<JobOutcome>();
  return {
    done,
    spec: {
      kind: "shell" as const,
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
        logFilePath: "/tmp/guada.log",
      })),
      cancel: jest.fn(),
      done: done.promise,
      ...overrides,
    },
  };
}

async function loadPlugin() {
  const tools = new Map<string, any>();
  const prompts: any[] = [];
  const kit = {
    registerTool: (def: any) => tools.set(def.name, def),
    registerPrompt: (def: any) => prompts.push(def),
  };
  const api = {
    registerToolKit: jest.fn(() => kit),
  };
  const registry = new JobRegistryService({ emit: jest.fn() } as any);
  const plugin = new JobsPlugin(registry);
  await plugin.onLoad(api as any);
  return { tools, prompts, registry };
}

const ctx = { session: { sessionId: "s1" } } as any;

describe("JobsPlugin", () => {
  let registry: JobRegistryService;
  let tools: Map<string, any>;
  let prompts: any[];

  beforeEach(async () => {
    ({ registry, tools, prompts } = await loadPlugin());
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it("注册 job_read/job_list/job_stop/job_send 与提示词", () => {
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining(["job_read", "job_list", "job_stop", "job_send"]),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0].content).toContain("job_read");
    expect(prompts[0].content).toContain("job_send");
  });

  it("job_read 读取尾部并返回状态行（无 offset 字段）", async () => {
    const { spec } = makeSpec();
    const id = registry.start(spec) as JobId;

    const result = (await tools.get("job_read").execute(
      { job_id: id },
      ctx,
    )) as { content: string; meta: Record<string, any> };

    expect(result.content).toContain("hello");
    expect(result.content).toContain("[status: running]");
    expect(result.content).not.toContain("nextOffset");
    expect(result.meta.jobId).toBe(id);
    expect(result.meta.jobStatus).toBe("running");
  });

  it("job_read 字节日志类第二次调用只返回增量", async () => {
    let logText = "hello";
    const { spec } = makeSpec({
      read: jest.fn(async () => {
        const buf = Buffer.from(logText, "utf8");
        return {
          text: logText,
          offset: 0,
          nextOffset: buf.length,
          size: buf.length,
          truncated: false,
          logFilePath: "/tmp/guada.log",
        };
      }),
    });
    const id = registry.start(spec) as JobId;

    const first = (await tools.get("job_read").execute(
      { job_id: id },
      ctx,
    )) as { content: string };
    expect(first.content).toContain("hello");

    // 日志增长后再读：readIncremental 从游标继续
    logText = "hello world appended";
    const second = (await tools.get("job_read").execute(
      { job_id: id },
      ctx,
    )) as { content: string };
    expect(spec.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 5 }),
    );
    expect(second.content).toContain("hello world appended");
  });

  it("job_read wait=true 在终态后返回并置 reported", async () => {
    const { spec, done } = makeSpec();
    const id = registry.start(spec) as JobId;

    const pending = tools.get("job_read").execute(
      { job_id: id, wait: true, timeout_ms: 1_000 },
      ctx,
    );
    done.resolve({ status: "completed", exitCode: 0 });
    const result = (await pending) as { content: string };

    expect(result.content).toContain("[status: completed, exit code: 0]");
    expect(registry.get(id, "s1")?.reported).toBe(true);
  });

  it("job_read 截断时指引用 read 工具读日志文件", async () => {
    const { spec } = makeSpec({
      read: jest.fn(async () => ({
        text: "chunk",
        offset: 0,
        nextOffset: 5,
        size: 100,
        truncated: true,
        logFilePath: "/tmp/guada.log",
      })),
    });
    const id = registry.start(spec) as JobId;

    const result = (await tools.get("job_read").execute(
      { job_id: id },
      ctx,
    )) as { content: string };

    expect(result.content).toContain(
      "The complete log is saved at: /tmp/guada.log",
    );
    expect(result.content).toContain("read tool");
    expect(result.content).toContain("[status: running]");
  });

  it("job_list 列出会话作业", async () => {
    const { spec } = makeSpec();
    const id = registry.start(spec) as JobId;

    const text = await tools.get("job_list").execute({}, ctx);
    expect(text).toContain(id);
    expect(text).toContain("[shell, running");
    expect(text).toContain("/tmp/guada.log");
  });

  it("job_stop 请求取消并返回 stopping", async () => {
    const cancel = jest.fn();
    const { spec, done } = makeSpec({ cancel });
    const id = registry.start(spec) as JobId;

    const text = await tools.get("job_stop").execute(
      { job_id: id, reason: "no longer needed" },
      ctx,
    );

    expect(text).toContain(`requested cancellation of job ${id}`);
    expect(cancel).toHaveBeenCalledWith("no longer needed");
    expect(registry.get(id, "s1")?.status).toBe("stopping");
    done.resolve({ status: "killed" });
  });

  it("job_send 调用 spec.send 并透传 appendNewline", async () => {
    const send = jest.fn(async () => {});
    const { spec } = makeSpec({ send });
    const id = registry.start(spec) as JobId;

    const text = await tools.get("job_send").execute(
      { job_id: id, input: "y" },
      ctx,
    );

    expect(text).toContain(`sent 1 bytes to job ${id}`);
    expect(send).toHaveBeenCalledWith("y", true);
  });

  it("job_send append_newline=false 原样透传", async () => {
    const send = jest.fn(async () => {});
    const { spec } = makeSpec({ send });
    const id = registry.start(spec) as JobId;

    await tools.get("job_send").execute(
      { job_id: id, input: "\x04", append_newline: false },
      ctx,
    );

    expect(send).toHaveBeenCalledWith("\x04", false);
  });

  it("job_send 对不支持的作业明确报错", async () => {
    const { spec } = makeSpec(); // 无 send
    const id = registry.start(spec) as JobId;

    await expect(
      tools.get("job_send").execute({ job_id: id, input: "hi" }, ctx),
    ).rejects.toThrow("does not support send");
  });
});
