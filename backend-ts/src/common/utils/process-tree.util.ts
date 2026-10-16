import { spawn, spawnSync } from "child_process";
import { Logger } from "@nestjs/common";

/**
 * 进程树终止工具（MCP stdio 服务器专用）
 *
 * 为什么需要它：SDK 的 `StdioClientTransport.close()` 只对**直接子进程**发信号
 * （node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js），而 MCP 服务器常以
 * `npx xxx-mcp` 这类包装命令启动——Windows 下还会经 `cmd.exe` 中转。直接子进程退出后，
 * 真正的 node 服务器进程会成为孤儿并继续占用端口与内存。
 *
 * 与 `modules/shell/process-manager.service.ts` 的 terminateTree 是同一问题的两套实现，
 * 但**刻意不共用**：那边的下刀逻辑与本模块无关的进程条目模型深度耦合（spool 尾读器、
 * MSYS 标记清扫、killed 态兜底结算、2s 升级看门狗），抽取会牵动一条经充分验证的路径。
 * 这里只服务 MCP 这一类「无 shell 包装、无需 MSYS 清扫」的子进程，逻辑更短。
 * 若日后两处需求收敛，应优先把此处提升为共用实现。
 */

const logger = new Logger("ProcessTree");

/** 默认 SIGTERM → SIGKILL 的宽限时间 */
const DEFAULT_GRACE_MS = 750;

/** `ps` 列举进程表的超时：卡住的 ps 不能拖住连接关闭 */
const PS_TIMEOUT_MS = 3_000;

/** 进程是否仍存在（EPERM 表示存在但无权限，同样算存在） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/**
 * 终止整个进程树，返回是否确认全部退出。
 *
 * Windows：`taskkill /F /T` 按活着的父子链递归。
 * POSIX：先枚举子孙再自底向上下刀——StdioClientTransport 不用 detached 启动，
 * 子进程不是进程组组长，`process.kill(-pid)` 组杀不可用，只能显式枚举。
 */
export async function killProcessTree(
  pid: number | null | undefined,
  options: { graceMs?: number } = {},
): Promise<boolean> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return true;
  if (!isProcessAlive(pid)) return true;

  try {
    if (process.platform === "win32") {
      await killWindowsTree(pid);
    } else {
      await killPosixTree(pid, options.graceMs ?? DEFAULT_GRACE_MS);
    }
  } catch (err: any) {
    logger.warn(`终止进程树 ${pid} 失败: ${err?.message || err}`);
  }

  const survived = isProcessAlive(pid);
  if (survived) {
    logger.warn(`进程树 ${pid} 下刀后仍存活，可能成为孤儿进程`);
  }
  return !survived;
}

/**
 * 退出阶段的最后一道网：只做**同步**操作（`process.on('exit')` 里无法 await）。
 *
 * 正常路径已由 OnApplicationShutdown 异步回收；这里兜的是「后端被强杀/超时直接
 * process.exit」的场景——main.ts 的 Bridge shutdown 用 2s 超时 race 包住 app.close()，
 * 超时即 process.exit(0)，异步清理可能来不及跑完。
 */
export function killProcessTreeSyncBestEffort(
  pid: number | null | undefined,
): void {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 2_000,
      });
      return;
    }
    // 同步路径不做子孙枚举：拿不到「下刀成功」的确认，但至少不会留下直接子进程
    process.kill(pid, "SIGKILL");
  } catch {
    // 进程可能已退出：退出阶段的清理不得改变退出语义
  }
}

// ============ 平台实现 ============

/** Windows：taskkill /F /T，失败重试一次 */
async function killWindowsTree(pid: number, attempt = 1): Promise<void> {
  const ok = await runTaskkill(pid);
  if (ok || !isProcessAlive(pid)) return;
  if (attempt >= 2) {
    logger.warn(`taskkill 两次均未能终止进程树 ${pid}`);
    return;
  }
  await delay(300);
  return killWindowsTree(pid, attempt + 1);
}

function runTaskkill(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on("error", () => done(false));
    // 128 = 目标不存在：进程已自行退出，视为成功
    child.on("exit", (code) => done(code === 0 || code === 128));
  });
}

/**
 * POSIX：枚举子孙 → 自底向上 SIGTERM → 宽限 → 对存活者 SIGKILL。
 *
 * 自底向上（叶子优先）是为了让父进程不会在子进程之前消失——父进程一旦被回收，
 * 其子进程会被 init 收养，之后就只能靠遍历全进程表才找得回来。
 */
async function killPosixTree(pid: number, graceMs: number): Promise<void> {
  const tree = collectProcessTree(pid);
  const deepestFirst = [...tree].sort((a, b) => b.depth - a.depth);

  for (const node of deepestFirst) signal(node.pid, "SIGTERM");
  signal(pid, "SIGTERM");

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!deepestFirst.some((n) => isProcessAlive(n.pid)) && !isProcessAlive(pid)) {
      return;
    }
    await delay(50);
  }

  for (const node of deepestFirst) {
    if (isProcessAlive(node.pid)) signal(node.pid, "SIGKILL");
  }
  if (isProcessAlive(pid)) signal(pid, "SIGKILL");
}

interface ProcessNode {
  pid: number;
  depth: number;
}

/**
 * 从 `ps -eo pid=,ppid=` 构造 root 的子孙列表（不含 root 本身）。
 *
 * 用 ps 而不是 `pgrep -P`：pgrep 在部分精简发行版与旧版 macOS 上不存在，
 * 而 ps -eo 是 POSIX 标准且两只平台行为一致。
 */
function collectProcessTree(rootPid: number): ProcessNode[] {
  const table = readProcessTable();
  if (table.size === 0) return [];

  const childrenOf = new Map<number, number[]>();
  for (const [pid, ppid] of table) {
    const siblings = childrenOf.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(ppid, [pid]);
  }

  const out: ProcessNode[] = [];
  const seen = new Set<number>([rootPid]);
  let frontier: Array<{ pid: number; depth: number }> = [{ pid: rootPid, depth: 0 }];

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const child of childrenOf.get(node.pid) ?? []) {
        // seen 兼作环保护：进程表在读取与遍历之间可能已变化
        if (seen.has(child)) continue;
        seen.add(child);
        out.push({ pid: child, depth: node.depth + 1 });
        next.push({ pid: child, depth: node.depth + 1 });
      }
    }
    frontier = next;
  }
  return out;
}

/** 读取 pid → ppid 映射；失败返回空表（调用方视为「无子孙」） */
function readProcessTable(): Map<number, number> {
  const table = new Map<number, number>();
  const result = spawnSync("ps", ["-eo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: PS_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) return table;

  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    table.set(Number(match[1]), Number(match[2]));
  }
  return table;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // ESRCH：进程已退出
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
