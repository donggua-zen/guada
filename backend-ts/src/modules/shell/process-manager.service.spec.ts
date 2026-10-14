import { EventEmitter2 } from "@nestjs/event-emitter";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChatRunnerService } from "../chat/chat-runner.service";
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

    // entry 由 close 事件清理（不再在 kill() 里立刻移除）
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
});
