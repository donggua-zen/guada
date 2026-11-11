/**
 * 结束本仓库启动的 Electron dev 实例（含其进程树）
 *
 * 背景：`dev:electron` 是 concurrently → electron 的两层结构。Ctrl+C / 关闭终端时
 * concurrently 只会终止直接子进程，Electron 主进程常常被孤儿化。它既不监听 5173 也
 * 不监听 3000，所以 kill-port.bat 完全够不到它，但它仍然：
 *   - 持有 userData 目录下的单实例锁 —— 下次启动的 Electron 直接 "检测到已有应用实例" 退出（exit 0，无窗口）
 *   - 占着 Chromium 的 Cache/GPUCache/Code Cache —— 新进程报
 *     "Unable to move the cache: 拒绝访问 (0x5)" / "Unable to create cache"
 * 因此清理端口之外，必须单独把 Electron 也收掉。
 *
 * 只杀命令行里带本仓库路径的 electron 进程，不会误伤 VS Code、ZCode 等其它 Electron 应用。
 *
 * 用法：
 *   node scripts/kill-dev-electron.js           结束本仓库的 Electron dev 实例
 *   node scripts/kill-dev-electron.js --list    只列出，不杀
 *
 * 退出码：0 = 已清理或本来就没有；1 = 有进程杀不掉（通常需要管理员权限）。
 */

const { spawnSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const LIST_ONLY = process.argv.includes("--list") || process.argv.includes("--dry");

/** 读取进程列表，返回 { pid, ppid, command } 数组 */
function listProcesses() {
  if (process.platform === "win32") {
    // wmic 在新版 Windows 上已移除，改用 CIM
    const script = [
      "Get-CimInstance Win32_Process",
      "| Where-Object { $_.Name -eq 'electron.exe' }",
      "| ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)\" }",
    ].join(" ");
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0) {
      throw new Error(`枚举进程失败：${(result.stderr || "").trim()}`);
    }
    return parseTabbed(result.stdout);
  }

  const result = spawnSync("ps", ["-eo", "pid=,ppid=,command="], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`枚举进程失败：${(result.stderr || "").trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    })
    .filter(Boolean)
    .filter((proc) => /electron/i.test(proc.command));
}

function parseTabbed(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, ppid, ...rest] = line.split("\t");
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        command: rest.join("\t").trim(),
      };
    })
    .filter((proc) => Number.isInteger(proc.pid) && proc.pid > 0);
}

/**
 * 是否属于本仓库的 dev 实例。
 * Electron 的渲染/GPU 等子进程命令行里也带着同一份路径，所以会一并命中；
 * 下面只杀「父进程不在命中集合里」的根进程，子进程由 /T 或进程组一起带走。
 */
function belongsToRepo(proc) {
  return proc.command.includes(REPO_ROOT);
}

function shortCommand(command, limit = 160) {
  const oneLine = command.replace(/\s+/g, " ");
  return oneLine.length > limit ? `${oneLine.slice(0, limit)} ...` : oneLine;
}

function kill(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return { ok: result.status === 0, error: (result.stderr || "").trim() };
  }
  const result = spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  return { ok: result.status === 0, error: (result.stderr || "").trim() };
}

function main() {
  const matched = listProcesses().filter(belongsToRepo);

  if (matched.length === 0) {
    console.log("[kill-dev-electron] 没有本仓库的 Electron 进程在运行。");
    return 0;
  }

  const matchedPids = new Set(matched.map((proc) => proc.pid));
  const roots = matched.filter((proc) => !matchedPids.has(proc.ppid));

  console.log(
    `[kill-dev-electron] 命中 ${matched.length} 个进程，其中根进程 ${roots.length} 个${
      LIST_ONLY ? "（仅列出，不结束）" : ""
    }`,
  );

  let failed = 0;
  for (const proc of roots) {
    console.log(`  PID ${proc.pid}  ${shortCommand(proc.command)}`);
    if (LIST_ONLY) continue;
    const result = kill(proc.pid);
    if (result.ok) {
      console.log("    [KILLED]");
    } else {
      failed += 1;
      console.log(`    [FAILED] ${result.error || "可能需要管理员权限"}`);
    }
  }

  if (failed > 0) {
    console.log(
      "[kill-dev-electron] 有进程未能结束；请以管理员身份重试，或手动在任务管理器结束 electron.exe。",
    );
    return 1;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`[kill-dev-electron] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
