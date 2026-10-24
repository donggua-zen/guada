import { EventEmitter2 } from "@nestjs/event-emitter";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { JobRegistryService } from "../jobs/job-registry.service";
import { ProcessManagerService } from "./process-manager.service";

/**
 * kill() 的进程树终止测试（Unix）。
 *
 * 背景（P0）：kill 曾只给**直接子进程**发 SIGTERM，且兜底的 SIGKILL 用 `childProcess.killed`
 * 判断 —— 该标志在"信号发送成功"后就为 true，并不代表进程已退出，因此兜底几乎不会触发。
 * 结果是忽略 SIGTERM 的进程、以及命令派生出的孙进程都残留：面板显示已终止，机器上还在跑。
 *
 * 这里起「忽略 SIGTERM 的脚本 + 它派生的孙进程」，kill 后断言整棵树都消失 ——
 * 旧实现下这条必然失败（父进程忽略 TERM、孙进程不受直接子进程 kill 影响）。
 */

const isWindows = process.platform === "win32";
const describeUnix = isWindows ? describe.skip : describe;

/** 进程是否存活（signal 0 只做存在性探测） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 进程组是否还活着（负 PID 探测整组） */
function isGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
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
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}

/**
 * 机器上管道类进程的 {名字:WINPID} 快照（Windows 用）。
 *
 * 判断「终止是否真的清干净」只能直接看进程还在不在：命令输出改走文件 fd 之后，
 * 管道 EOF / close 早到不再是"整树已死"的证据（已经没有任何管道了）。
 */
function pipelineProcessPids(): Set<string> {
  const pids = new Set<string>();
  const names = [
    "find.exe",
    "sort.exe",
    "head.exe",
    "timeout.exe",
    "cat.exe",
    "sleep.exe",
  ];
  for (const name of names) {
    try {
      const out = execFileSync(
        "tasklist",
        ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"],
        { encoding: "utf8" },
      );
      for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (m) pids.add(`${name}:${m[2]}`);
      }
    } catch {
      // 探测失败当作没有：这只是一个判据，不该让用例因环境问题失败
    }
  }
  return pids;
}

/** 快照之后新出现的进程（本用例自己起的） */
function newPipelineProcessesSince(baseline: Set<string>): string[] {
  return [...pipelineProcessPids()].filter((p) => !baseline.has(p));
}

/** 清理指定进程（用例兜底：失败路径也不能把残留留给机器） */
function killProcesses(entries: string[]): void {
  for (const entry of entries) {
    const pid = entry.split(":")[1];
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" });
    } catch {
      // 已退出
    }
  }
}

function makeStubRegistry(): JobRegistryService {
  return new JobRegistryService({ emit: () => {} } as any);
}

describeUnix("ProcessManagerService 手动终止进程树", () => {
  let service: ProcessManagerService;
  let tmpDir: string;
  let scriptPath: string;
  let grandchildPidFile: string;
  const cleanupPids: number[] = [];

  const SESSION_ID = "test-session-kill-tree";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-kill-tree-"));
    scriptPath = path.join(tmpDir, "tree.sh");
    grandchildPidFile = path.join(tmpDir, "grandchild.pid");
    // 父脚本与孙进程都忽略 SIGTERM，并各自持续运行 —— 只有整组 SIGKILL 才能收掉
    fs.writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "trap '' TERM",
        `sh -c 'trap "" TERM; while :; do sleep 1; done' &`,
        `echo $! > "${grandchildPidFile}"`,
        "while :; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  beforeEach(() => {
    fs.rmSync(grandchildPidFile, { force: true });
    service = new ProcessManagerService(
      {} as unknown as ChatRunnerService,
      new EventEmitter2(),
      makeStubRegistry(),
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    for (const pid of cleanupPids) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
    cleanupPids.length = 0;
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startTree(): Promise<string> {
    const result = await service.execute(
      `sh "${scriptPath}"`,
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(result.kind).toBe("backgrounded");
    const processId = (result as { processId: string }).processId;
    cleanupPids.push(Number(processId));
    return processId;
  }

  it("kill 后父进程、孙进程、整个进程组都不再存活，且 entry 由 close 清理", async () => {
    const processId = await startTree();
    const leaderPid = Number(processId);
    expect(isAlive(leaderPid)).toBe(true);

    // 等孙进程把 pid 落盘
    const gotGrandchild = await waitFor(
      () => fs.existsSync(grandchildPidFile),
      5_000,
    );
    expect(gotGrandchild).toBe(true);
    const grandchildPid = Number(fs.readFileSync(grandchildPidFile, "utf8").trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    expect(service.kill(processId)).toBe("killed");
    // 面板状态立即变为 killed（entry 仍在，等真实退出）
    expect(service.get(processId)?.status).toBe("killed");

    // SIGTERM 被忽略 → 靠 2s 看门狗升级为整组 SIGKILL
    expect(await waitFor(() => !isAlive(leaderPid), 8_000)).toBe(true);
    expect(await waitFor(() => !isAlive(grandchildPid), 8_000)).toBe(true);
    expect(await waitFor(() => !isGroupAlive(leaderPid), 8_000)).toBe(true);

    // entry 由 exit 事件清理（kill() 不立刻移除，留给看门狗补杀进程组）
    expect(await waitFor(() => service.get(processId) === null, 8_000)).toBe(true);
  }, 30_000);

  it("被 kill 的进程不会经由 drainCompleted 投递给 AI", async () => {
    const processId = await startTree();
    await waitFor(() => fs.existsSync(grandchildPidFile), 5_000);

    service.kill(processId);

    const drained = await service.drainCompleted(SESSION_ID);
    expect(drained.map((r) => r.processId)).not.toContain(processId);
  }, 30_000);

  it("正常响应 SIGTERM 的进程也能被终止并清理", async () => {
    const result = await service.execute(
      "sleep 600",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    const processId = (result as { processId: string }).processId;
    cleanupPids.push(Number(processId));

    expect(service.kill(processId)).toBe("killed");
    expect(await waitFor(() => !isAlive(Number(processId)), 8_000)).toBe(true);
    expect(await waitFor(() => service.get(processId) === null, 8_000)).toBe(true);
  }, 30_000);

  /** Unix legacy 路径：管道 + data 事件实时喂 tailer，单文件（无 .raw.log spool）。 */
  it("legacy 路径单文件：管道输出实时落盘，且不产生 .raw.log", async () => {
    const logDir = (service as any).getLogDir() as string;
    const filesBefore = new Set(fs.readdirSync(logDir));

    const started = await service.execute(
      "echo legacy-pipe && echo legacy-err 1>&2",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    expect(started.kind).toBe("backgrounded");
    const processId = (started as { processId: string }).processId;
    const logPath = (started as { logFilePath?: string }).logFilePath;
    expect(logPath).toBeTruthy();

    let content = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const log = await service.readLogTail(processId, SESSION_ID);
      content = log?.content ?? "";
      if (content.includes("legacy-pipe") && content.includes("legacy-err")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(content).toContain("legacy-pipe");
    expect(content).toContain("legacy-err");

    // 新文件里没有 spool；stderr（legacy-err）与 stdout 落同一份日志
    const newFiles = fs
      .readdirSync(logDir)
      .filter((f) => !filesBefore.has(f));
    expect(newFiles).toEqual([path.basename(logPath!)]);

    service.kill(processId);
  }, 30_000);
});

// ============================================================================
// Windows：Git Bash 命令的完成信号与整树回收
//
// 两条互相独立的线索：
//
// 1. 完成信号只认子进程的 exit。命令输出直写 spool 文件 fd（不再走管道），
//    所以「后代进程还攥着写句柄」再也拖不住调用——`sleep 30 &` 这种 shell 已退出、
//    后代仍在跑的命令必须立刻返回 completed，而不是顶满 timeout 误报成转后台。
// 2. 整树回收靠 taskkill /F /T + MSYS 侧清扫（见 killWindowsProcess）：管道成员
//    （timeout / sleep / cat / sort / head）是被短命的 fork 中转进程拉起来的，
//    Windows 记录的 ParentProcessId 指向已经退出的 PID，taskkill /T 够不到它们。
//    判据直接看进程还在不在（pipelineProcessPids 快照差集）。
// ============================================================================
const describeWin = isWindows ? describe : describe.skip;

describeWin("ProcessManagerService Windows 管道进程树终止", () => {
  let service: ProcessManagerService;
  let tmpDir: string;
  const SESSION_ID = "test-session-win-kill-tree";
  /** 管道 + coreutils timeout 的形态：树会跨两个 MSYS 进程组 */
  const PIPELINE =
    "for d in a b; do timeout 60 sleep 30 | cat; done | sort -u | head -5";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-win-kill-"));
    service = new ProcessManagerService(
      {} as unknown as ChatRunnerService,
      new EventEmitter2(),
      makeStubRegistry(),
    );
    service.onModuleInit();
  });

  afterEach(async () => {
    service.onModuleDestroy();
    // 终止是 fire-and-forget（清扫要等 helper 起来），删目录前得给残留进程退场的时间：
    // 它们的 cwd 还锁着 tmpDir，Windows 上会 EPERM。
    for (let i = 0; i < 50; i++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }, 15_000);

  it("前台等待中被 abort：结果立即返回，不等任何外部事件", async () => {
    const controller = new AbortController();
    const execPromise = service.execute(PIPELINE, tmpDir, "utf8", SESSION_ID, {
      timeout: 60_000,
      abortSignal: controller.signal,
    });

    // 让命令真正跑起来（进入前台 poll 等待）
    await new Promise((r) => setTimeout(r, 2_000));
    expect(service.listBySession(SESSION_ID)[0]?.status).toBe("running");

    controller.abort();
    const abortedAt = Date.now();
    const result = await execPromise;

    expect(result.kind).toBe("completed");
    expect((result as { processStatus: string }).processStatus).toBe("killed");
    // 旧管道实现会卡到 sleep 30 自己结束（>20s）；这里要求"点终止即刻返回"
    expect(Date.now() - abortedAt).toBeLessThan(3_000);
  }, 30_000);

  /**
   * 旗舰回归：shell 已退出、后代进程（sleep 30）仍活着并持有 spool fd。
   * 完成信号必须是「子进程 exit」，而不是「输出通道 EOF」——旧管道实现下这条会顶满
   * timeout 并把结果误报成 backgrounded（后代攥着管道不放）。
   */
  it("shell 退出但后代仍在跑：前台立刻按 completed 返回，不误报转后台", async () => {
    const baseline = pipelineProcessPids();
    const startedAt = Date.now();
    const result = await service.execute(
      "sleep 30 & echo done",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 10_000 },
    );
    const elapsed = Date.now() - startedAt;

    expect(result.kind).toBe("completed");
    expect((result as { output: string }).output).toContain("done");
    expect(elapsed).toBeLessThan(5_000);

    // 本例故意留下一个孤儿 sleep：它属于"结果之后的输出"，不该拖住调用，但测试得自己收尾
    killProcesses(newPipelineProcessesSince(baseline));
  }, 30_000);

  /**
   * 整树回收：管道成员在 Windows 上父链是断的（taskkill /T 够不到），
   * 旧实现因此留下「面板显示已终止、机器上还在跑」的残留。判据直接看进程是否消失。
   */
  it("kill 后管道进程整树消失（不留 find/sort/head/timeout/cat/sleep）", async () => {
    const baseline = pipelineProcessPids();
    const started = await service.execute(PIPELINE, tmpDir, "utf8", SESSION_ID, {
      timeout: 60_000,
      background: true,
    });
    const processId = (started as { processId: string }).processId;

    // 等管道真正铺开（timeout/sleep/cat/sort/head 都起来了）
    expect(
      await waitFor(
        () => newPipelineProcessesSince(baseline).length > 0,
        5_000,
      ),
    ).toBe(true);
    expect(service.get(processId)?.status).toBe("running");

    expect(service.kill(processId)).toBe("killed");

    // 清扫是 fire-and-forget：给它一段有界时间，然后断言一个都不剩
    const cleared = await waitFor(
      () => newPipelineProcessesSince(baseline).length === 0,
      6_000,
    );
    const leftovers = newPipelineProcessesSince(baseline);
    if (!cleared) killProcesses(leftovers); // 失败路径也不把残留留给机器
    expect(leftovers).toEqual([]);

    // entry 由 exit 事件退场（killed 路径不投递系统消息）
    expect(await waitFor(() => service.get(processId) === null, 3_000)).toBe(true);
  }, 30_000);

  it("清洗转写仍生效：ANSI 擦除、\\r 进度帧折叠、无换行提示词可见", async () => {
    const started = await service.execute(
      "printf '\\033[31mred\\033[0m\\nprog 1\\rprog 2\\rprog 3\\nContinue? (y/n): '; sleep 2; echo y",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    const processId = (started as { processId: string }).processId;

    // poll 会消费输出，所以要跨多次 poll 累积（AI 侧就是这么看的）；
    // 提示词不以 \n 结尾，靠 500ms 空闲转写交出去（等价原 SanitizerTransform 的 idle flush）
    let accumulated = "";
    for (let i = 0; i < 25 && !accumulated.includes("Continue?"); i++) {
      await new Promise((r) => setTimeout(r, 200));
      const polled = await service.poll(processId, 0, SESSION_ID);
      accumulated += polled?.output ?? "";
    }

    expect(accumulated).toContain("red"); // ANSI 已擦除
    expect(accumulated).not.toContain("\x1b");
    expect(accumulated).toContain("prog 3"); // \r 帧只留最后一帧
    expect(accumulated).not.toContain("prog 1");
    expect(accumulated).toContain("Continue? (y/n): ");

    const final = await service.poll(processId, 6_000, SESSION_ID);
    expect(final?.status).toBe("completed");
  }, 30_000);

  it("GBK 字节按 GBK 转写（读侧流式解码在文件路径上仍然生效）", async () => {
    const result = await service.execute(
      "printf '\\326\\320\\316\\304\\n'", // 中文（cp936 字节）
      tmpDir,
      "utf8", // 显式声明 utf-8 也不能盲信（zh-CN 事故回归）
      SESSION_ID,
      { timeout: 60_000 },
    );
    expect(result.kind).toBe("completed");
    expect((result as { output: string }).output).toContain("中文");
    expect((result as { output: string }).output).not.toContain("\uFFFD");
  }, 30_000);

  it("终止中的进程可以重复下刀（不再是空操作）", async () => {
    const started = await service.execute(PIPELINE, tmpDir, "utf8", SESSION_ID, {
      timeout: 60_000,
      background: true,
    });
    const processId = (started as { processId: string }).processId;
    await new Promise((r) => setTimeout(r, 1_500));

    expect(service.kill(processId)).toBe("killed");
    const second = service.kill(processId);
    expect(second === "killed" || second === null).toBe(true);
    expect(await waitFor(() => service.get(processId) === null, 8_000)).toBe(true);
  }, 30_000);

  /**
   * 这条不依赖"下刀是否成功"：把两把刀都换成空操作，让进程继续活着，然后要求
   * killed 的 poll 立刻返回——完成与读取都不再依赖任何外部事件。
   * 旧管道实现在这里 `await finished(writeStream)`，会一直等到进程自己结束。
   */
  it("下刀没生效时，killed 的 poll 也不等待任何外部事件", async () => {
    // 这条用例故意不下刀，进程只能自己结束——所以命令取短寿命（8s），
    // 免得测试自己制造出"面板显示已终止、机器上还在跑"的残留。
    const started = await service.execute(
      "sleep 8 | cat",
      tmpDir,
      "utf8",
      SESSION_ID,
      { timeout: 60_000, background: true },
    );
    const processId = (started as { processId: string }).processId;
    await new Promise((r) => setTimeout(r, 1_000));

    const internals = service as unknown as {
      killWindowsProcess: (...args: unknown[]) => void;
      sweepMsysProcesses: (...args: unknown[]) => void;
    };
    const realKill = internals.killWindowsProcess;
    const realSweep = internals.sweepMsysProcesses;
    internals.killWindowsProcess = () => {};
    internals.sweepMsysProcesses = () => {};
    try {
      expect(service.kill(processId)).toBe("killed");
      // 没被杀掉：进程还活着（下刀被换成了空操作）
      expect(isAlive(Number(processId))).toBe(true);

      const startedAt = Date.now();
      const polled = await service.poll(processId, 0, SESSION_ID);
      expect(polled?.status).toBe("killed");
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      internals.killWindowsProcess = realKill;
      internals.sweepMsysProcesses = realSweep;
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", processId], {
          stdio: "ignore",
        });
      } catch {
        // 已退出
      }
    }
  }, 30_000);
});

describe("ProcessManagerService 句柄释放", () => {
  it("进程结束后立即销毁 stdin 管道，清理幂等", () => {
    const service = new ProcessManagerService(
      {} as ChatRunnerService,
      new EventEmitter2(),
    );

    // 有 poll 等待者时 handleProcessEnd 不投递系统消息，避免测试触碰 chatRunner
    const pollNotifier = (service as any).pollNotifier;
    pollNotifier.hasWaiters = () => true;
    pollNotifier.notify = () => {};

    const stdin = new PassThrough();
    const idleTimer = setInterval(() => {}, 1000);
    const entry: any = {
      id: "proc-handle-test",
      sessionId: "session-handle-test",
      command: "echo hi",
      childProcess: { stdin },
      status: "running",
      exitCode: null,
      idleTimer,
      tailer: { flushFinal: () => {}, pull: () => {} },
    };

    (service as any).handleProcessEnd(entry, "completed", 0);

    // 进程一结束就释放 stdin 写端，并停掉空闲 ticker
    expect(stdin.destroyed).toBe(true);
    expect(entry.idleTimer).toBeUndefined();

    // 后续 cleanup 再释放一次：幂等、不抛错
    (service as any).processes.set(entry.id, entry);
    (service as any).sessionProcesses.set(
      entry.sessionId,
      new Map([[entry.id, entry]]),
    );
    expect(() =>
      (service as any).cleanupProcess(entry.id, entry.sessionId),
    ).not.toThrow();
    expect(stdin.destroyed).toBe(true);
  });
});
