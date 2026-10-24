import { EventEmitter2 } from "@nestjs/event-emitter";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { JobRegistryService } from "../jobs/job-registry.service";
import { ProcessManagerService } from "./process-manager.service";

const isWindows = process.platform === "win32";
const describeWin = isWindows ? describe : describe.skip;

const SESSION_ID = "native-job-test";

function makeStubRegistry(): JobRegistryService {
  return new JobRegistryService({ emit: () => {} } as any);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

describeWin("ProcessManagerService native Win32 Job spawn", () => {
  let service: ProcessManagerService;
  let tmpDir: string;
  let chatRunner: { enqueueMessage: jest.Mock };

  beforeAll(() => {
    process.env.GUADA_WIN32_JOB_SPAWN = "1";
  });

  afterAll(() => {
    delete process.env.GUADA_WIN32_JOB_SPAWN;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-native-job-"));
    chatRunner = { enqueueMessage: jest.fn().mockResolvedValue(undefined) };
    service = new ProcessManagerService(
      chatRunner as unknown as ChatRunnerService,
      new EventEmitter2(),
      makeStubRegistry(),
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses the native path and injects the exec token", async () => {
    expect(service.getShellKind()).not.toBe("cmd");

    const result = await service.execute(
      "echo TOKEN=$GUADA_EXEC_TOKEN",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 10_000 },
    );

    expect(result.kind).toBe("completed");
    const output = (result as { output: string }).output;
    expect(output).toMatch(/TOKEN=exec-[A-Za-z0-9_-]+/);
  }, 30_000);

  it("runs a background process through the native path and cleans it up on kill", async () => {
    const started = await service.execute(
      'node -e "setInterval(() => {}, 1000)"',
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(started.kind).toBe("backgrounded");
    const processId = (started as { processId: string }).processId;

    const entry = (service as any).processes.get(processId);
    expect(entry?.kind).toBe("native");
    const pid = Number(processId);
    expect(isAlive(pid)).toBe(true);

    expect(service.kill(processId)).toBe("killed");
    expect(await waitFor(() => service.get(processId) === null, 10_000)).toBe(
      true,
    );
    expect(await waitFor(() => !isAlive(pid), 5_000)).toBe(true);
  }, 40_000);

  it("writes to a native process's stdin and reads the output", async () => {
    const started = await service.execute(
      'node -e "process.stdin.on(\'data\', d => { console.log(\'GOT:\' + d.toString().trim()); process.exit(0); })"',
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(started.kind).toBe("backgrounded");
    const processId = (started as { processId: string }).processId;

    const entry = (service as any).processes.get(processId);
    expect(entry?.kind).toBe("native");

    service.writeToStdin(processId, "hello-native\n");

    let output = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !output.includes("GOT:hello-native")) {
      const polled = await service.poll(processId, 200, SESSION_ID);
      if (polled) output += polled.output;
    }
    expect(output).toContain("GOT:hello-native");
  }, 40_000);

  it("exposes non-destructive read, list fields, and background log path", async () => {
    // 单文件化：不再产生 spool（.raw.log）。guada-logs 是跨进程共享目录且 GC 按 10 天
    // mtime 兜底，所以先记目录快照，执行后只断言「新文件里没有 raw」。
    const logDir = (service as any).getLogDir() as string;
    const filesBefore = new Set(fs.readdirSync(logDir));

    const started = await service.execute(
      "echo read-me",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(started.kind).toBe("backgrounded");
    const processId = (started as { processId: string }).processId;
    const logPath = (started as { logFilePath?: string }).logFilePath;
    expect(logPath).toBeTruthy();

    const entry = (service as any).processes.get(processId);
    expect(entry?.kind).toBe("native");

    expect(
      await waitFor(
        () => (service as any).processes.get(processId)?.status !== "running",
        10_000,
      ),
    ).toBe(true);
    const newFiles = fs
      .readdirSync(logDir)
      .filter((f) => !filesBefore.has(f));
    expect(newFiles).toEqual([path.basename(logPath!)]);
    // 有 jobId 时通知权归 Registry（job.settled → notifier），不再直接 enqueue
    expect(chatRunner.enqueueMessage).not.toHaveBeenCalled();

    // 非破坏性：读两次内容一致，entry 不被删除
    const first = await service.readProcessLog(processId, SESSION_ID);
    expect(first).not.toBeNull();
    expect(first!.status).toBe("completed");
    expect(first!.content).toContain("read-me");
    expect(first!.logFilePath).toBe(logPath);
    expect(first!.offset).toBe(0);
    expect((service as any).processes.has(processId)).toBe(true);

    const second = await service.readProcessLog(processId, SESSION_ID);
    expect(second!.content).toBe(first!.content);

    const delta = await service.readProcessLog(processId, SESSION_ID, {
      offset: first!.nextOffset,
    });
    expect(delta!.content).toBe("");
    expect(delta!.nextOffset).toBe(first!.nextOffset);

    const listed = service
      .listBySession(SESSION_ID)
      .find((p) => p.id === processId);
    expect(listed).toMatchObject({
      status: "completed",
      exitCode: 0,
      logFilePath: logPath,
    });

    // 已完成 entry 有 TTL 兜底清理；cleanup 时同步清掉 timer
    expect(entry.completedCleanupTimer).toBeDefined();
    (service as any).cleanupProcess(processId, SESSION_ID);
    expect(entry.completedCleanupTimer).toBeUndefined();
  }, 40_000);
});

const powershellPath = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const describePwsh =
  isWindows && fs.existsSync(powershellPath) ? describe : describe.skip;

describePwsh("ProcessManagerService native PowerShell", () => {
  let service: ProcessManagerService;
  let tmpDir: string;
  let chatRunner: { enqueueMessage: jest.Mock };

  beforeAll(() => {
    process.env.GUADA_WIN32_JOB_SPAWN = "1";
    process.env.GUADA_SHELL = powershellPath;
  });

  afterAll(() => {
    delete process.env.GUADA_SHELL;
    delete process.env.GUADA_WIN32_JOB_SPAWN;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-native-pwsh-"));
    chatRunner = { enqueueMessage: jest.fn().mockResolvedValue(undefined) };
    service = new ProcessManagerService(
      chatRunner as unknown as ChatRunnerService,
      new EventEmitter2(),
      makeStubRegistry(),
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses the native path, injects env, and pins UTF-8 output", async () => {
    expect(service.getShellKind()).toBe("powershell");

    const result = await service.execute(
      'Write-Output "TOKEN=$env:GUADA_EXEC_TOKEN"; Write-Output "HELLO-中文"',
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 20_000 },
    );

    expect(result.kind).toBe("completed");
    const output = (result as { output: string }).output;
    expect(output).toMatch(/TOKEN=exec-[A-Za-z0-9_-]+/);
    expect(output).toContain("HELLO-中文");
  }, 40_000);

  it("writes to a native PowerShell process's stdin", async () => {
    const started = await service.execute(
      '$line = [Console]::In.ReadLine(); Write-Output "GOT:$line"; exit 0',
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(started.kind).toBe("backgrounded");
    const processId = (started as { processId: string }).processId;

    const entry = (service as any).processes.get(processId);
    expect(entry?.kind).toBe("native");

    service.writeToStdin(processId, "hello-pwsh\n");

    let output = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !output.includes("GOT:hello-pwsh")) {
      const polled = await service.poll(processId, 200, SESSION_ID);
      if (polled) output += polled.output;
    }
    expect(output).toContain("GOT:hello-pwsh");
  }, 40_000);
});

describeWin("ProcessManagerService shell gate", () => {
  it("keeps cmd.exe on the legacy path", () => {
    const previous = process.env.GUADA_SHELL;
    process.env.GUADA_SHELL =
      process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    try {
      const service = new ProcessManagerService(
        { enqueueMessage: jest.fn() } as unknown as ChatRunnerService,
        new EventEmitter2(),
      );
      service.onModuleInit();
      try {
        expect(service.getShellKind()).toBe("cmd");
        expect((service as any).canUseNativeSpawn()).toBe(false);
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous === undefined) delete process.env.GUADA_SHELL;
      else process.env.GUADA_SHELL = previous;
    }
  });
});
