import { EventEmitter2 } from "@nestjs/event-emitter";
import { EventBusService } from "../../../common/events/event-bus.service";
import { JobRegistryService } from "../../jobs/job-registry.service";
import type { JobId } from "../../jobs/job.types";
import { PluginApiImpl } from "./plugin-api";

/**
 * 端到端契约：PluginApi.startJob → JobRegistryService → job_read/job_stop 语义。
 * 不依赖 Nest DI，直接构造真实 registry + event bus。
 */
describe("PluginApi.startJob with a real JobRegistry", () => {
  const pluginId = "job-e2e";
  const sessionId = "session-e2e";
  let emitter: EventEmitter2;
  let eventBus: EventBusService;
  let registry: JobRegistryService;

  beforeEach(() => {
    emitter = new EventEmitter2();
    eventBus = new EventBusService(emitter);
    registry = new JobRegistryService(eventBus);
  });

  afterEach(() => {
    try {
      registry.onModuleDestroy();
    } catch {
      /* ignore */
    }
  });

  function makeApi() {
    return new PluginApiImpl(
      pluginId,
      "Job E2E",
      undefined,
      undefined,
      "user",
      undefined,
      { pluginDir: "/tmp/plugin", dataDir: "/tmp/data" },
      undefined,
      undefined,
      registry,
    );
  }

  it("registers, reads and cancels a plugin job", async () => {
    const api = makeApi();
    let cancelled = false;
    let resolveDone!: (value: any) => void;
    const done = new Promise<any>((resolve) => {
      resolveDone = resolve;
    });

    const jobId = api.startJob(
      {
        label: "render frames",
        logFilePath: "/tmp/data/jobs/e2e.log",
        read: async () => ({
          text: "progress 1/3",
          offset: 0,
          nextOffset: 12,
          size: 12,
          truncated: false,
        }),
        cancel: () => {
          cancelled = true;
          resolveDone({ status: "killed" });
        },
        done,
      },
      sessionId,
    ) as JobId;

    expect(jobId).toMatch(/^job-/);

    const list = registry.list(sessionId);
    expect(list.map((job) => job.id)).toContain(jobId);
    expect(list[0].kind).toBe("shell");
    expect(list[0].label).toBe("render frames");

    const read = await registry.read(jobId, sessionId);
    expect(read.output.text).toContain("progress 1/3");

    const outcome = registry.kill(jobId, sessionId, "test cancel");
    expect(outcome).toBe("requested");
    expect(cancelled).toBe(true);

    const after = registry.list(sessionId);
    expect(after[0].status === "killed" || after[0].status === "stopping").toBe(true);
  });

  it("rejects a second job beyond the per-session quota", () => {
    const api = makeApi();
    const makeJob = (index: number) => ({
      label: `job ${index}`,
      read: async () => ({ text: "", offset: 0, nextOffset: 0, size: 0, truncated: false }),
      cancel: () => undefined,
      done: new Promise<any>(() => undefined),
    });
    // 配额是 10；第 11 个必须失败
    for (let i = 0; i < 10; i++) {
      api.startJob(makeJob(i), sessionId);
    }
    expect(() => api.startJob(makeJob(10), sessionId)).toThrow(/limit reached/);
  });
});
