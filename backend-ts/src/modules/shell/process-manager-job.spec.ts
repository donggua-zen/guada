import { EventEmitter2 } from "@nestjs/event-emitter";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProcessManagerService } from "./process-manager.service";
import { JobRegistryService } from "../jobs/job-registry.service";
import type { ChatRunnerService } from "../chat/chat-runner.service";
import type { JobId, JobSettledEvent } from "../jobs/job.types";

/// <reference types="jest" />

const SESSION_ID = "test-session-job-registry";

function makeRegistry(): {
  registry: JobRegistryService;
  eventBus: { emit: jest.Mock };
} {
  const eventBus = { emit: jest.fn() };
  return {
    registry: new JobRegistryService(eventBus as any),
    eventBus,
  };
}

describe("ProcessManagerService × JobRegistry", () => {
  let service: ProcessManagerService;
  let registry: JobRegistryService;
  let eventBus: { emit: jest.Mock };
  let chatRunner: { enqueueMessage: jest.Mock };
  let tmpDir: string;

  beforeAll(() => {
    process.env.GUADA_WIN32_JOB_SPAWN = "1";
  });

  afterAll(() => {
    delete process.env.GUADA_WIN32_JOB_SPAWN;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-job-registry-"));
    chatRunner = { enqueueMessage: jest.fn().mockResolvedValue(undefined) };
    ({ registry, eventBus } = makeRegistry());
    service = new ProcessManagerService(
      chatRunner as unknown as ChatRunnerService,
      new EventEmitter2(),
      registry,
    );
    service.onModuleInit();
  });

  afterEach(async () => {
    service.onModuleDestroy();
    registry.onModuleDestroy();
    // Windows 上被 kill 的进程 cwd 可能还锁着 tmpDir，给退出留一点时间。
    for (let i = 0; i < 30; i++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }, 10_000);

  it("background execute 返回 jobId，作业可读取并结算", async () => {
    const started = await service.execute(
      "echo job-output",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );

    expect(started.kind).toBe("backgrounded");
    const jobId = (started as { jobId: JobId }).jobId;
    expect(jobId).toMatch(/^job-/);

    const listed = registry.list(SESSION_ID);
    expect(listed).toEqual([
      expect.objectContaining({
        id: jobId,
        kind: "shell",
        status: "running",
        handle: (started as { processId: string }).processId,
      }),
    ]);
    expect(service.listBySession(SESSION_ID)).toEqual([
      expect.objectContaining({ id: (started as { processId: string }).processId, jobId }),
    ]);

    const settled = await registry.wait(jobId, SESSION_ID, 10_000);
    expect(settled.status).toBe("completed");
    expect(settled.exitCode).toBe(0);
    expect(settled.reported).toBe(true);

    const read = await registry.read(jobId, SESSION_ID);
    expect(read.output.text).toContain("job-output");

    const settleEvents = eventBus.emit.mock.calls
      .filter((call: any[]) => call[0] === "job.settled")
      .map((call: any[]) => call[1] as JobSettledEvent);
    expect(settleEvents).toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        job: expect.objectContaining({ id: jobId, status: "completed" }),
        notify: true,
      }),
    ]);
    // 有 jobId 时旧通知路径让位给 Registry，不直接 enqueue
    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
  }, 30_000);

  it("job kill 走 ProcessManager 整树终止，通知被抑制", async () => {
    const started = await service.execute(
      'node -e "setInterval(() => {}, 1000)"',
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    const jobId = (started as { jobId: JobId }).jobId;
    expect(jobId).toMatch(/^job-/);

    expect(registry.kill(jobId, SESSION_ID, "test")).toBe("requested");
    expect(registry.get(jobId, SESSION_ID)?.status).toBe("stopping");
    expect(registry.get(jobId, SESSION_ID)?.reported).toBe(true);

    const settled = await registry.wait(jobId, SESSION_ID, 10_000);
    expect(settled.status).toBe("killed");
    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();
  }, 30_000);
});
