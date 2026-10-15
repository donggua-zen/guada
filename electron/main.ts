import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  Tray,
  MenuItemConstructorOptions,
  dialog,
  clipboard,
  screen,
  crashReporter,
  nativeImage,
  powerSaveBlocker,
} from "electron";
import * as path from "path";
import * as os from "os";
import { ChildProcess, exec, spawn } from "child_process";
import * as fs from "fs";
// import { autoUpdater } from "electron-updater";
import log from "electron-log";
import { BrowserWebviewManager } from "./browser-tab-manager";
import {
  BridgeServer,
  generatePipePath,
  generateBridgeToken,
} from "./bridge-server";
import { BrowserAutomationService } from "./browser-automation-service";
let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let windowManager: BrowserWebviewManager | null = null; // 窗口管理器
let isBackendStarting = false; // 防止重复启动
let isBackendStopping = false; // 标记后端正在被主动停止（非异常退出）
let backendPort: number | null = null; // 记录后端端口
let browserBridgeInitialized = false; // Browser Bridge 是否已初始化
let bridgeServer: BridgeServer | null = null;
let automationService: BrowserAutomationService | null = null;
let stderrBuffer: string[] = []; // 后端 stderr 缓冲，用于崩溃诊断
const MAX_STDERR_LINES = 200;
/** 标题栏高度(px)：原生窗口按钮 overlay 用；修改需同步前端 CustomTitlebar.vue 根节点的 h-9 */
const TITLEBAR_HEIGHT = 36;
let tray: Tray | null = null; // 系统托盘图标
let floatWindow: BrowserWindow | null = null; // 托盘悬浮小窗
/** 当前聚合的托盘统计信息 */
let trayStats = { running: 0, unread: 0 };
/** 悬浮窗设置（默认隐藏，用户在设置页开启后生效） */
let traySettings = { enabled: false, opacity: 95 };
let isBackendReady = false; // 后端真正就绪标志（仅 startBackend resolve 后为 true）

/**
 * 防休眠（keep-awake）：主进程持有 powerSaveBlocker("prevent-app-suspension")，
 * 只阻止系统因空闲休眠（屏幕可照常关闭），防不了合盖/手动睡眠。
 * 三个来源驱动：启动时直读 system.json、设置页 IPC 推送、后端经 bridge 上报的忙碌状态。
 */
type KeepAwakeMode = "off" | "busy" | "always";
let keepAwakeMode: KeepAwakeMode = "busy"; // 与后端 KEEP_AWAKE_MODE_DEFAULT 一致
let keepAwakeBusy = false; // 后端是否有对话/定时任务在执行（bridge keep_awake_state）
let powerSaveBlockerId: number | null = null;

function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return value === "off" || value === "busy" || value === "always";
}

/** 幂等开关 blocker：模式与忙碌状态任一变化后调用 */
function reconcileKeepAwakeBlocker(): void {
  const shouldBlock =
    keepAwakeMode === "always" || (keepAwakeMode === "busy" && keepAwakeBusy);
  if (shouldBlock && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log(
      `[keep-awake] blocker started id=${powerSaveBlockerId} mode=${keepAwakeMode} busy=${keepAwakeBusy}`,
    );
  } else if (!shouldBlock && powerSaveBlockerId !== null) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId);
    } catch {
      // id 可能已失效，忽略
    }
    console.log(`[keep-awake] blocker stopped id=${powerSaveBlockerId}`);
    powerSaveBlockerId = null;
  }
}

/**
 * 启动时直读设置文件。后端设置按「一组一文件」落盘，而 Electron 传给后端的
 * SETTINGS_DIR 就是 detectDataPath() 的数据根目录，故路径为 <dataHome>/system.json。
 * 走文件而不是等前端拉取，保证窗口（渲染进程）还没就绪时设置已经生效。
 */
function readKeepAwakeModeFromSettings(): KeepAwakeMode {
  try {
    const file = path.join(detectDataPath(), "system.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isKeepAwakeMode(raw?.keepAwakeMode)) return raw.keepAwakeMode;
  } catch {
    // 文件不存在/不可读/非法 JSON：按缺省走，不打断启动
  }
  return "busy";
}

// —— 后端健康看门狗状态（仅记录日志，不自动重启）——
// 背景：dev 模式 Electron 只持有 cmd/npx 包装进程，真实 NestJS 进程是孙进程；
// ts-node-dev 也不会因子进程退出而重启它（只有文件变更触发 restart），所以真实进程
// 死亡在全链路里是静默的。死亡定性由两路观测留下：看门狗的 HTTP 判定 +
// watchBackendRealExit 抓到的真实进程退出码。
let backendStartedAt = 0; // 后端子进程 spawn 时刻
let backendHealthFailures = 0;
let backendHealthAlerted = false;
let lastBackendHealthOkAt = 0;
let lastBackendHealthFailReason = "";
let backendWatchdogTimer: NodeJS.Timeout | null = null;
const BACKEND_WATCHDOG_INTERVAL_MS = 15000;
const BACKEND_HEALTH_ALERT_THRESHOLD = 3;

/**
 * 后端自身的真实 PID（由 bridge 的 port_ready 上报）。
 * dev 模式下 backendProcess.pid 是 cmd/npx 包装进程，真实 NestJS 进程是孙进程，
 * 其退出 Electron 收不到 exit 事件 —— 记下真实 PID 才能为它挂退出码监视。
 */
let backendRealPid = 0;
/** 持有后端进程句柄、阻塞等待其退出码的辅助子进程 */
let backendExitWatcher: ChildProcess | null = null;
/**
 * 最近一次 ts-node-dev 在 stdout 上公告重启（"Restarting: xxx has been modified"）的时刻。
 * 热重载走的是 child.kill('SIGTERM')，Windows 下即 TerminateProcess：退出码 1、不留任何
 * JS 侧日志，与 logFatal 的主动 exit(1) 无法区分 —— 这条公告是判定「正常热重载」的唯一硬证据。
 */
let lastHotReloadNoticeAt = 0;
/** 致命错误诊断报告目录（Node 不会自建，目录缺失时报告被静默丢弃） */
function diagnosticReportDir(logsDir: string): string {
  const dir = path.join(logsDir, "diagnostic-reports");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    log.error("创建诊断报告目录失败:", err);
  }
  return dir;
}

/** 进程是否仍存在。用于校验 taskkill 是否真的清干净了进程树 */
function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code !== "ESRCH";
  }
}

/** 退出码语义：区分「自己退出」「被外部强杀」「原生崩溃」的硬证据 */
const EXIT_CODE_HINTS: Record<number, string> = {
  0: "退出码 0：优雅 process.exit(0)（bridge shutdown），或外部 TerminateProcess 以 0 收尾（如 taskkill /F）—— 同码不可区分",
  1: "退出码 1：后端 logFatal 主动退出（error 日志同刻有「进程级 …」条目），或 ts-node-dev 热重载/停机时的 SIGTERM=TerminateProcess（Windows 下同为 1，error 日志无条目）",
  3: "V8 致命错误",
  134: "SIGABRT：原生模块 abort 或堆内存耗尽",
  0xc0000005: "访问违例（原生模块崩溃），通常有 WER 事件",
  0xc00000fd: "栈溢出",
  0xc0000409: "fail-fast（__fastfail）：Node abort 路径，绕过 WER，故常无崩溃报告",
  0xc0000374: "堆损坏",
};

function describeExitCode(code: number | null): string {
  if (code === null) return "退出码不可得（监视进程被提前终止或非 Windows 句柄等待）";
  return EXIT_CODE_HINTS[code] || "未分类退出码，无已知语义";
}

/** 崩溃现场落盘（生产/开发共用），供 backend-crash.log 事后分析 */
function writeBackendCrashLog(info: Record<string, unknown>): void {
  try {
    const crashLogsDir = computeDataPaths(detectDataPath()).logsDir;
    const crashLogPath = path.join(crashLogsDir, "backend-crash.log");
    fs.writeFileSync(
      crashLogPath,
      JSON.stringify({ timestamp: new Date().toISOString(), ...info }, null, 2),
      "utf-8",
    );
    log.info(`崩溃日志已保存: ${crashLogPath}`);
  } catch (err) {
    log.error("保存崩溃日志失败:", err);
  }
}

/**
 * 等待真实后端进程退出并取回退出码的 PowerShell 助手。
 * Electron 无法监听非直接子进程的退出，只能 OpenProcess 持句柄 + WaitForSingleObject；
 * 退出码是判定死亡性质的唯一硬证据（历史上三个观测点全部失效，才误判成「外部强杀」）。
 */
const BACKEND_EXIT_WAITER_PS = `param([Parameter(Mandatory = $true)][int]$TargetPid)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace GuadaDiag -Name ProcessWait -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern System.IntPtr OpenProcess(int access, bool inherit, int pid);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetExitCodeProcess(System.IntPtr handle, out uint exitCode);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint WaitForSingleObject(System.IntPtr handle, uint milliseconds);
'@
$handle = [GuadaDiag.ProcessWait]::OpenProcess(0x101000, $false, $TargetPid)
if ($handle -eq [System.IntPtr]::Zero) {
  Write-Output ("OPENFAILED " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 0
}
while ([GuadaDiag.ProcessWait]::WaitForSingleObject($handle, 2000) -ne 0) { }
$code = [uint32]0
[void][GuadaDiag.ProcessWait]::GetExitCodeProcess($handle, [ref]$code)
Write-Output ("EXIT " + $code + " 0x" + ("{0:X8}" -f $code))
exit 0
`;

function stopBackendExitWatcher(): void {
  const watcher = backendExitWatcher;
  backendExitWatcher = null; // 先摘引用：助手退出回调据此判断是否已被取代（热重载）
  if (watcher && !watcher.killed) watcher.kill("SIGKILL");
}

function watchBackendRealExit(pid: number): void {
  if (!pid || pid === backendRealPid) return; // 同一进程重复上报（bridge 重连）
  stopBackendExitWatcher();
  backendRealPid = pid;

  const wrapperPid = backendProcess?.pid;
  if (wrapperPid === pid) return; // 生产模式：直接子进程，exit 事件已带退出码

  let helper: ChildProcess | null = null;
  let stdout = "";
  try {
    if (process.platform === "win32") {
      const scriptPath = path.join(app.getPath("temp"), "guada-backend-exit-waiter.ps1");
      fs.writeFileSync(scriptPath, BACKEND_EXIT_WAITER_PS, "utf-8");
      helper = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-TargetPid",
          String(pid),
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    } else {
      helper = spawn(
        "/bin/sh",
        ["-c", `while kill -0 ${pid} 2>/dev/null; do sleep 1; done; echo "EXIT null"`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    }
  } catch (err) {
    log.error(`[BackendExit] 启动退出码监视失败 (PID=${pid}):`, err);
    return;
  }
  if (!helper) return;
  backendExitWatcher = helper;
  helper.stdout?.on("data", (d) => {
    stdout += String(d);
  });
  helper.on("error", (err) => {
    log.warn(`[BackendExit] 退出码监视进程异常 (PID=${pid}): ${err.message}`);
  });
  helper.on("exit", () => {
    if (backendExitWatcher !== helper) return; // 已被新监视取代 → 视为热重载
    backendExitWatcher = null;
    const m = /EXIT\s+(\d+)/.exec(stdout);
    onBackendRealProcessGone(pid, m ? Number(m[1]) : null, stdout.trim());
  });
}

/**
 * 真实后端进程消失后的定性。
 * 两段式：10s 未见重启只记 warn（ts-node-dev 编译+启动实测 8~20s，一刀切会误报死亡），
 * 再等 35s 仍无重启且期间没有热重载公告才落 error + 崩溃日志。
 */
function onBackendRealProcessGone(
  pid: number,
  code: number | null,
  detail: string,
): void {
  const decide = (final: boolean) => {
    const restarted =
      (backendRealPid !== pid && backendRealPid !== 0) ||
      (bridgeServer?.hasAuthenticatedClient() ?? false);
    const hotReload = Date.now() - lastHotReloadNoticeAt < 60_000;
    const head =
      `后端真实进程 PID=${pid} 已退出，退出码=${code ?? "未知"} —— ${describeExitCode(code)}`;
    if (isBackendStopping || restarted || hotReload) {
      const why = isBackendStopping ? "主动停机" : restarted ? "随后已重启" : "ts-node-dev 热重载";
      log.info(`[BackendExit] ${head}（${why}）`);
      return;
    }
    if (!final) {
      log.warn(`[BackendExit] ${head}，10s 内未见重启，继续观察 35s…`);
      setTimeout(() => decide(true), 35_000);
      return;
    }
    log.error(
      `[BackendExit] ${head}\n` +
        `  包装进程 PID=${backendProcess?.pid ?? "无"} 存活=${isPidAlive(backendProcess?.pid)}` +
        `（包装树存活 = ts-node-dev 仍在，但它不会因子进程退出而重启，只有文件变更会）\n` +
        `  监视助手输出=${detail || "无"}\n` +
        `  判读：若 logs/backend-last-breath.log 同刻无记录 = 句柄级终止（TerminateProcess/原生崩溃）；` +
        `有 exit(N)/beforeExit/signal 行则看 backend-ts 侧退出路径`,
    );
    writeBackendCrashLog({
      pid,
      exitCode: code,
      exitCodeMeaning: describeExitCode(code),
      wrapperPid: backendProcess?.pid ?? null,
      wrapperAlive: isPidAlive(backendProcess?.pid),
      stderrTail: stderrBuffer.slice(-50).join("\n") || "(无 stderr 输出)",
      watcherOutput: detail || null,
    });
  };
  setTimeout(() => decide(false), 10_000);
}

/**
 * 终止后端进程树并校验清理干净。
 * 仅 taskkill 包装树会漏掉已脱离父链的孙进程（曾累积 6 套泄漏包装树 / 1.1GB），
 * 故对包装树与真实 PID 分别下刀并验证，失败时留日志而不是静默置空。
 */
async function forceKillBackendTree(): Promise<void> {
  const wrapperPid = backendProcess?.pid ?? 0;
  const realPid = backendRealPid;
  const taskkill = (pid: number) =>
    new Promise<void>((resolve) => {
      if (!pid) return resolve();
      exec(
        `taskkill /pid ${pid} /T /F`,
        { windowsHide: true },
        (error: any, _stdout: string, stderr: string) => {
          if (error) {
            log.error(`[BackendStop] taskkill PID=${pid} 失败: ${stderr || error.message}`);
          }
          resolve();
        },
      );
    });

  if (process.platform === "win32") {
    await taskkill(wrapperPid);
    if (realPid && realPid !== wrapperPid && isPidAlive(realPid)) {
      log.warn(`[BackendStop] 真实后端 PID=${realPid} 未随包装树退出，单独终止`);
      await taskkill(realPid);
    }
  } else {
    if (wrapperPid) {
      try {
        process.kill(wrapperPid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
    if (realPid && realPid !== wrapperPid) {
      try {
        process.kill(realPid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (isPidAlive(realPid) || isPidAlive(wrapperPid)) {
    log.error(
      `[BackendStop] 进程树未清理干净：wrapper=${wrapperPid}(${isPidAlive(wrapperPid)}) real=${realPid}(${isPidAlive(realPid)})`,
    );
  } else {
    log.info(`[BackendStop] 进程树已清理（wrapper=${wrapperPid} real=${realPid}）`);
  }
}

/**
 * 查询监听指定端口的进程（PID + 命令行）。
 * 用 -File 传脚本而不是 -Command 内联，避免 exec 的引号转义问题（与退出码监视器同一套路）。
 */
const PORT_OWNER_PS = `param([Parameter(Mandatory = $true)][int]$Port)
$ErrorActionPreference = 'SilentlyContinue'
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1
if (-not $conn) { Write-Output "NONE"; exit 0 }
$proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $conn.OwningProcess)
Write-Output ("PID " + $conn.OwningProcess)
if ($proc) { Write-Output ("CMD " + $proc.CommandLine) }
exit 0
`;

async function findPortOwner(port: number): Promise<{ pid: number; commandLine: string } | null> {
  if (process.platform !== "win32" || !port) return null;
  let scriptPath: string;
  try {
    scriptPath = path.join(app.getPath("temp"), "guada-port-owner.ps1");
    fs.writeFileSync(scriptPath, PORT_OWNER_PS, "utf-8");
  } catch (err) {
    log.error("[BackendReclaim] 写入端口查询脚本失败:", err);
    return null;
  }
  const stdout = await new Promise<string>((resolve) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" -Port ${port}`,
      { windowsHide: true },
      (_error, out) => resolve(String(out || "").trim()),
    );
  });
  if (!stdout || stdout.startsWith("NONE")) return null;
  const pid = Number(/^PID (\d+)/m.exec(stdout)?.[1]);
  if (!pid) return null;
  const commandLine = /^CMD (.*)$/m.exec(stdout)?.[1]?.trim() ?? "";
  return { pid, commandLine };
}

/**
 * dev 固定端口启动前对账。
 * 上一次退出若把真实后端孤儿化，它会一直占着该端口，使本次 bind 失败（EADDRINUSE），
 * 而 ts-node-dev 的 --respawn 不会因此重启——表现为「重启无效」。这里在 spawn 前清理：
 * 只有确认占用者就是本仓库的后端进程（命令行含仓库根 + backend-ts/main.ts）才下手，
 * 不是我们的进程一律只告警、绝不误杀。
 */
async function reclaimDevPort(port: number, repoRoot: string): Promise<void> {
  const owner = await findPortOwner(port);
  if (!owner) return;

  const normalize = (s: string) => s.replace(/[\\/]+/g, "\\").toLowerCase();
  const cmdLine = normalize(owner.commandLine);
  const isOurBackend =
    cmdLine.includes(normalize(repoRoot)) &&
    /backend-ts\\/.test(cmdLine) &&
    /main\.(ts|js)/.test(cmdLine);

  if (!isOurBackend) {
    log.warn(
      `[BackendReclaim] 端口 ${port} 已被 PID=${owner.pid} 占用，但它不像本项目的后端进程，跳过清理：` +
        ((owner.commandLine || "(命令行不可得)").slice(0, 200)),
    );
    return;
  }

  log.warn(`[BackendReclaim] 端口 ${port} 被遗留后端 PID=${owner.pid} 占用，清理进程树...`);
  await new Promise<void>((resolve) => {
    exec(`taskkill /pid ${owner.pid} /T /F`, { windowsHide: true }, (error, _out, stderr) => {
      if (error) {
        log.error(`[BackendReclaim] taskkill PID=${owner.pid} 失败: ${stderr || error.message}`);
      } else {
        log.info(`[BackendReclaim] 已清理遗留后端 PID=${owner.pid}`);
      }
      resolve();
    });
  });

  // 等进程真正消失（最多 ~3s），避免紧接着 spawn 又撞上 EADDRINUSE
  for (let i = 0; i < 15 && isPidAlive(owner.pid); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

// 检查更新函数（定义在全局作用域，供 IPC 和自动检查共用）
async function doCheckForUpdates() {
  try {
    const currentVersion = app.getVersion();
    const platform =
      process.platform === "win32"
        ? "win"
        : process.platform === "darwin"
          ? "mac"
          : "linux";
    const apiUrl = `https://ai.dingd.cn/api/check_update?version=${currentVersion}&platform=${platform}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data: any = await response.json();

    if (data.hasUpdate) {
      mainWindow?.webContents.send("update-status", {
        status: "available",
        info: data,
      });
    } else {
      mainWindow?.webContents.send("update-status", {
        status: "not-available",
      });
    }

    return { success: true, data };
  } catch (error: any) {
    mainWindow?.webContents.send("update-status", {
      status: "error",
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// 扩展 App 类型以支持退出标记
interface AppExtended extends Electron.App {
  isQuiting?: boolean;
}

// 配置 electron-log
log.transports.file.level = "info";
log.transports.file.maxSize = 50 * 1024 * 1024; // 50MB
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

// 将 console 输出重定向到日志文件（可选，生产环境建议启用）
// Object.assign(console, log.functions)

// ── 开发实例数据隔离 ──
// GUADA_DEV_DATA=1    ：dev 模式（热重载）使用独立数据 ~/.guada-dev，与正式数据解耦，可与 prod-debug 并行
// GUADA_PROD_DEBUG=1  ：生产调试模式（无热重载、静态前端）直接使用正式数据 ~/.guada
const GUADA_DEV_DATA = process.env.GUADA_DEV_DATA === "1";
const GUADA_PROD_DEBUG = process.env.GUADA_PROD_DEBUG === "1";
if (GUADA_DEV_DATA) {
  app.setPath("userData", path.join(app.getPath("appData"), "guada-dev"));
} else if (GUADA_PROD_DEBUG) {
  app.setPath("userData", path.join(app.getPath("appData"), "guada-prod-debug"));
}
// 锁键基于 userData —— 上述 setPath 必须在 requestSingleInstanceLock() 之前

crashReporter.start({
  uploadToServer: false,
  compress: false,
});
log.info(`[CrashReporter] dumps directory: ${app.getPath("crashDumps")}`);

// 单实例锁：确保同一时间只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock();
// ── 进程级异常保护 ──
process.on("uncaughtException", (error) => {
  log.error("[Process] Uncaught exception:", error);
  log.error("[Process] Stack:", error.stack);
  // 不退出，让应用继续运行
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : "";
  log.error(`[Process] Unhandled rejection: ${msg}`);
  if (stack) log.error("[Process] Stack:", stack);
  // 不退出，让应用继续运行
});

// ── 终端信号 → 优雅退出 ──
// 背景：dev 下 Ctrl+C 只打到 concurrently/electron，而真实后端是 Electron 的
// 「cmd/npx → ts-node-dev → fork」重孙进程；Electron 若不主动跑 before-quit 清理，
// 这条链就被孤儿化，后端会一直占着 3000（2026-10-10 现场：连环 EADDRINUSE，
// 孤儿进程每 15s 重连一个早已消失的 bridge 管道）。Node 默认的 SIGINT/SIGTERM 行为是
// 直接终止进程、不触发 before-quit，所以必须显式接管。
let terminationRequested = false;
function handleTerminationSignal(signal: NodeJS.Signals): void {
  log.warn(`[Process] received ${signal}, quitting gracefully...`);
  if (terminationRequested) {
    // 第二次 Ctrl+C：用户不想再等，直接退
    log.warn(`[Process] second ${signal}, forcing exit`);
    process.exit(1);
  }
  terminationRequested = true;
  // 兜底：优雅清理若卡住，不能把 Ctrl+C 变成空操作（首次 Ctrl+C 后 12s 强制退出）
  setTimeout(() => {
    log.error("[Process] graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 12_000);
  app.quit();
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(signal, () => handleTerminationSignal(signal));
}

app.on("render-process-gone", (_event, webContents, details) => {
  log.error(
    `[Process] Renderer gone: webContentsId=${webContents.id}, reason=${details.reason}, exitCode=${details.exitCode}, url=${webContents.getURL()}`,
  );
});

app.on("child-process-gone", (_event, details) => {
  log.error(
    `[Process] Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}, serviceName=${details.serviceName || ""}, name=${details.name || ""}`,
  );
});

app.on("before-quit", () => {
  log.warn("[Process] before-quit received");
});

app.on("will-quit", () => {
  log.warn("[Process] will-quit received");
});

app.on("quit", (_event, exitCode) => {
  log.warn(`[Process] quit completed, exitCode=${exitCode}`);
});

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，立即退出当前实例
  log.warn("检测到已有应用实例在运行，退出当前实例");
  app.quit();
} else {
  // 如果获取锁成功，监听第二个实例启动事件
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // 当用户尝试启动第二个实例时，激活已存在的主窗口
    if (mainWindow) {
      // 如果窗口隐藏在托盘，则显示出来
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      // 如果窗口最小化，则还原窗口
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      // 聚焦窗口（将窗口带到前台）
      mainWindow.focus();
    }
  });
}

// 判断是否为开发模式（根据是否打包，而不是 NODE_ENV）
const isDev = !app.isPackaged;

// 旧数据目录（Electron 默认 userData）
const DEFAULT_USER_DATA = app.getPath("userData");
// 新数据目录（用户主目录下的 .guada；dev 模式隔离到 .guada-dev，与正式数据解耦）
const GUADA_HOME = GUADA_DEV_DATA
  ? path.join(os.homedir(), ".guada-dev")
  : path.join(os.homedir(), ".guada");
// 迁移标记文件
const MIGRATED_FLAG = path.join(GUADA_HOME, ".migrated");
// 跳过迁移标记
const SKIP_MIGRATION_FLAG = path.join(DEFAULT_USER_DATA, ".skip_migration");

/**
 * 检测应使用的数据目录
 * 优先级：已迁移标记 > 已存在 ~/.guada 数据 > 老用户 AppData > 新安装
 * Electron 环境下，环境变量由主进程动态设置，不作为用户自定义依据
 * @returns 数据根目录（~/guada/ 或 AppData/Roaming/guada-ai/）
 */
function detectDataPath(): string {
  // 已迁移：~/.guada/ 下有数据或迁移标记
  if (
    fs.existsSync(MIGRATED_FLAG) ||
    fs.existsSync(path.join(GUADA_HOME, "data", "ai_chat.db"))
  ) {
    return GUADA_HOME;
  }
  // 老用户：AppData 下已有数据库
  if (fs.existsSync(path.join(DEFAULT_USER_DATA, "ai_chat.db"))) {
    return DEFAULT_USER_DATA;
  }
  // 新安装：直接使用 ~/.guada/
  return GUADA_HOME;
}

/** 数据路径集合 */
interface DataPaths {
  dataHome: string; // 数据根目录
  dbPath: string; // 数据库文件
  // 旧全局向量库路径。知识库已改为「每库一个 kb.db」，本路径**只用于兼容**：
  // 启动迁移时若它存在，会改名保留为 .pre-sqlite 并把向量搬进各库。
  vectorDbPath: string;
  versionFile: string; // 数据库版本标记
  uploadDir: string; // 上传文件目录
  logsDir: string; // 日志目录
  skillsDir: string; // 技能目录
  providersDir: string; // 供应商配置文件目录（YAML）
  workspaceDir: string; // 工作目录
  pluginsDir: string; // 插件目录
  isNewLayout: boolean; // 是否使用新目录结构（data/ 子目录）
}

/**
 * 根据数据根目录计算所有子路径
 * 自动区分新旧布局：
 *   - 旧用户（dataHome === DEFAULT_USER_DATA）：文件直接在根目录
 *   - 新安装/已迁移（dataHome === GUADA_HOME）：文件在 data/ 子目录
 */
function computeDataPaths(dataHome: string): DataPaths {
  const isNewLayout = dataHome !== DEFAULT_USER_DATA;
  if (isNewLayout) {
    return {
      dataHome,
      dbPath: path.join(dataHome, "data", "ai_chat.db"),
      vectorDbPath: path.join(dataHome, "data", "vector_db.sqlite"),
      versionFile: path.join(dataHome, "data", "db_version.json"),
      uploadDir: path.join(dataHome, "file_stores"),
      logsDir: path.join(dataHome, "logs"),
      skillsDir: path.join(dataHome, "skills"),
      providersDir: path.join(dataHome, "providers"),
      workspaceDir: path.join(dataHome, "workspaces"),
      pluginsDir: path.join(dataHome, "plugins"),
      isNewLayout: true,
    };
  }
  // 旧布局：数据库、上传文件等直接在根目录
  return {
    dataHome,
    dbPath: path.join(dataHome, "ai_chat.db"),
    vectorDbPath: path.join(dataHome, "vector_db.sqlite"),
    versionFile: path.join(dataHome, "db_version.json"),
    uploadDir: path.join(dataHome, "file_stores"),
    logsDir: path.join(dataHome, "logs"),
    skillsDir: path.join(dataHome, "skills"),
    providersDir: path.join(dataHome, "providers"),
    workspaceDir: path.join(dataHome, "workspace"),
    pluginsDir: path.join(dataHome, "plugins"),
    isNewLayout: false,
  };
}

// 配置更新（已改为自定义 API 检测，不再使用 electron-updater）
// autoUpdater.autoDownload = false;
// if (isDev) {
//   autoUpdater.forceDevUpdateConfig = true;
// }

// 获取后端路径
function getBackendPath(): string {
  if (isDev) {
    // 编译后的文件在 electron/dist/，需要向上两级到达项目根目录
    return path.join(__dirname, "..", "..", "backend-ts");
  } else {
    // 生产环境：从 resources 目录获取（extraResources）
    return path.join(process.resourcesPath, "backend-ts");
  }
}

/**
 * 后端 node_modules 的位置。
 *
 * 打包版把它打进 app.asar（安装期只需写 1 个大文件，而不是 1.5 万个小文件 ——
 * 实测安装耗时 ≈ 文件数 × 18ms，与包体字节数无关）。入口 dist/main.js 仍是真实
 * 目录，Node 从它出发的 node_modules 向上查找永远走不到 asar 内，所以必须用
 * NODE_PATH 显式指路（ELECTRON_RUN_AS_NODE 下 asar 的 fs/解析补丁有效）。
 */
function getBackendNodeModulesPath(): string {
  return path.join(process.resourcesPath, "app.asar", "backend-ts", "node_modules");
}

/**
 * 把随包分发的 VC++ 运行时目录挂到后端进程 PATH 首位（仅 Windows）。
 *
 * @node-rs/jieba 的原生二进制动态链接 vcruntime140*.dll（全包唯一，其余原生模块都静态
 * 链接 CRT），干净系统没装 VC++ 运行时会 dlopen 失败，而它是在模块顶层被 require 的，
 * 会把整个后端进程带崩（实测：全新 Win10 虚拟机装完包后端起不来）。DLL 单份放在
 * resources/vc-runtime（打包时由 scripts/rebuild-native-electron.js 收集），靠 PATH
 * 让所有原生模块都能解析到。放「可执行文件同级」无效：libuv 用
 * LoadLibraryExW(LOAD_WITH_ALTERED_SEARCH_PATH) 加载 .node，搜索顺序是
 * 「.node 同目录 → System32 → Windows → cwd → PATH」，应用目录那一档会被替换掉。
 *
 * 键名沿用 process.env 里的原始大小写：Windows 环境块按 key 字符串存储，多造一个 "PATH"
 * 会与已有的 "Path" 并存、取值取前一个，注入就会静默失效。
 */
function backendCrtPathEnv(): Record<string, string> {
  if (process.platform !== "win32") return {};
  const crtDir = path.join(process.resourcesPath, "vc-runtime");
  if (!fs.existsSync(crtDir)) return {};
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  return { [pathKey]: `${crtDir}${path.delimiter}${process.env[pathKey] ?? ""}` };
}

// 确保 data 目录存在（数据库迁移由后端 MigrationRunner 负责）
function ensureDataDir(dataHome: string): void {
  const paths = computeDataPaths(dataHome);
  const dataDir = path.dirname(paths.dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 迁移状态枚举
type MigrationStatus =
  | "available"
  | "migrated"
  | "new_install"
  | "skipped"
  | "env_override";

/**
 * 检测迁移状态（供前端判断是否显示迁移提示）
 */
function getMigrationStatus(): MigrationStatus {
  if (
    process.env.DATABASE_URL ||
    process.env.UPLOAD_ROOT_DIR ||
    process.env.SKILLS_DIR
  ) {
    return "env_override";
  }
  if (
    fs.existsSync(MIGRATED_FLAG) ||
    fs.existsSync(path.join(GUADA_HOME, "data", "ai_chat.db"))
  ) {
    return "migrated";
  }
  if (fs.existsSync(SKIP_MIGRATION_FLAG)) {
    return "skipped";
  }
  if (fs.existsSync(path.join(DEFAULT_USER_DATA, "ai_chat.db"))) {
    return "available";
  }
  return "new_install";
}

/** 递归复制目录 */
function copyRecursiveSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * 执行数据迁移（从 AppData 复制到 ~/.guada/）
 * 注意：必须在后端进程停止后执行，否则 SQLite 文件被锁定
 */
async function handleMigration(): Promise<void> {
  const oldDir = DEFAULT_USER_DATA;
  const newDir = GUADA_HOME;

  // 1. 创建目标目录结构
  const newPaths = computeDataPaths(newDir);
  fs.mkdirSync(path.dirname(newPaths.dbPath), { recursive: true });
  fs.mkdirSync(newPaths.logsDir, { recursive: true });
  fs.mkdirSync(path.join(newDir, "skills"), { recursive: true });

  // 2. 复制数据文件（后端已停止，数据库处于一致状态）
  const oldDbPath = path.join(oldDir, "ai_chat.db");
  const copyTasks = [
    // 数据库文件
    { src: oldDbPath, dest: newPaths.dbPath },
    {
      src: path.join(oldDir, "ai_chat.db-wal"),
      dest: path.join(path.dirname(newPaths.dbPath), "ai_chat.db-wal"),
    },
    {
      src: path.join(oldDir, "ai_chat.db-shm"),
      dest: path.join(path.dirname(newPaths.dbPath), "ai_chat.db-shm"),
    },
    { src: path.join(oldDir, "vector_db.sqlite"), dest: newPaths.vectorDbPath },
    {
      src: path.join(oldDir, "vector_db.sqlite-wal"),
      dest: path.join(path.dirname(newPaths.vectorDbPath), "vector_db.sqlite-wal"),
    },
    {
      src: path.join(oldDir, "vector_db.sqlite-shm"),
      dest: path.join(path.dirname(newPaths.vectorDbPath), "vector_db.sqlite-shm"),
    },
    { src: path.join(oldDir, "db_version.json"), dest: newPaths.versionFile },
    // 上传文件
    { src: path.join(oldDir, "file_stores"), dest: newPaths.uploadDir },
    // 技能
    { src: path.join(oldDir, "skills"), dest: newPaths.skillsDir },
    // 日志
    { src: path.join(oldDir, "logs"), dest: newPaths.logsDir },
    // 定时任务
    { src: path.join(oldDir, "scheduler"), dest: path.join(newDir, "scheduler") },
    // 子 Agent
    { src: path.join(oldDir, "agents"), dest: path.join(newDir, "agents") },
    // 微信机器人会话
    { src: path.join(oldDir, "wechat-personal"), dest: path.join(newDir, "wechat-personal") },
    // 设置中心配置文件（模型偏好、插件开关、OCR、外观等）
    { src: path.join(oldDir, ".config"), dest: path.join(newDir, ".config") },
  ];

  for (const task of copyTasks) {
    if (fs.existsSync(task.src)) {
      copyRecursiveSync(task.src, task.dest);
      console.log(`已复制: ${task.src} → ${task.dest}`);
    }
  }

  // 3. 校验目标数据库文件头（SQLite 格式标记 "SQLite format 3\0"）
  const newDbPath = newPaths.dbPath;
  if (fs.existsSync(newDbPath)) {
    const fd = fs.openSync(newDbPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const header = buffer.toString('utf8', 0, 16);
    if (header !== 'SQLite format 3\0') {
      throw new Error(`目标数据库文件格式无效: ${header}`);
    }
    console.log('目标数据库校验通过（SQLite 格式正确）');
  }

  // 4. 写迁移标记
  fs.writeFileSync(
    MIGRATED_FLAG,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        from: oldDir,
        to: newDir,
        version: 2,
      },
      null,
      2,
    ),
  );
  console.log(`迁移标记已写入: ${MIGRATED_FLAG}`);
}

// 后端健康看门狗：HTTP 探测 /api/v1/health，仅记录日志不做恢复动作。
// 探测失败原因必须区分：连接被拒（进程已死/端口未监听）vs 超时（进程在但事件循环阻塞）。
// 与 bridge 断开事件、真实进程退出码监视（watchBackendRealExit）三路交叉才能定性。
async function pingBackendHealth(): Promise<{ ok: boolean; reason: string }> {
  if (!backendPort) return { ok: false, reason: "未获取到端口" };
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return { ok: res.ok, reason: res.ok ? "" : `HTTP ${res.status}` };
  } catch (err: any) {
    const code = err?.cause?.code || err?.code;
    if (err?.name === "TimeoutError" || code === "ETIMEDOUT") {
      return { ok: false, reason: "超时(3s)：进程在但事件循环阻塞" };
    }
    if (code === "ECONNREFUSED") {
      return { ok: false, reason: "连接被拒：端口无监听（进程已死或端口未 bind）" };
    }
    return { ok: false, reason: `${err?.name || "Error"}${code ? `/${code}` : ""}: ${err?.message || ""}` };
  }
}

function startBackendWatchdog(): void {
  if (backendWatchdogTimer) return;
  backendWatchdogTimer = setInterval(() => {
    // 启动期与主动停机期不判定失败
    if (isBackendStarting || isBackendStopping) return;
    void pingBackendHealth().then(({ ok, reason }) => {
      if (ok) {
        lastBackendHealthOkAt = Date.now();
        if (backendHealthAlerted) {
          log.info("[BackendWatchdog] 后端恢复响应");
        }
        backendHealthFailures = 0;
        backendHealthAlerted = false;
        lastBackendHealthFailReason = "";
        return;
      }
      lastBackendHealthFailReason = reason;
      backendHealthFailures += 1;
      if (backendHealthFailures === BACKEND_HEALTH_ALERT_THRESHOLD && !backendHealthAlerted) {
        backendHealthAlerted = true;
        const bridgeConnected = bridgeServer?.hasAuthenticatedClient() ?? false;
        const uptimeMin = backendStartedAt
          ? Math.round((Date.now() - backendStartedAt) / 60000)
          : -1;
        log.error(
          `[BackendWatchdog] 后端健康检查连续 ${BACKEND_HEALTH_ALERT_THRESHOLD} 次失败，` +
            `原因=${reason || "未知"}，bridge 已连接=${bridgeConnected}，` +
            `包装进程 PID=${backendProcess?.pid ?? "无"}(存活=${isPidAlive(backendProcess?.pid)})，` +
            `真实进程 PID=${backendRealPid || "未上报"}(存活=${isPidAlive(backendRealPid)})，` +
            `后端已启动 ${uptimeMin} 分钟，` +
            `最后正常响应=${lastBackendHealthOkAt ? new Date(lastBackendHealthOkAt).toLocaleTimeString() : "无记录"}。` +
            `真实进程退出码由 [BackendExit] 监视器在 10s 内给出；` +
            `若无 [BackendExit] 且真实进程已消失，才是外部强杀（TerminateProcess 不产生 WER/诊断报告）`,
        );
      } else if (backendHealthAlerted && backendHealthFailures % 20 === 0) {
        log.error(
          `[BackendWatchdog] 后端仍无响应（连续失败 ${backendHealthFailures} 次，原因=${lastBackendHealthFailReason}）`,
        );
      }
    });
  }, BACKEND_WATCHDOG_INTERVAL_MS);
}

// 启动 NestJS 后端服务
async function startBackend(): Promise<void> {
  // 防止重复启动
  if (isBackendStarting) {
    console.warn("⚠️  后端已在启动中，跳过重复调用");
    return Promise.resolve();
  }

  // 如果后端已经在运行，直接返回
  if (backendProcess && !backendProcess.killed) {
    console.warn("⚠️  后端已在运行，跳过重复调用");
    return Promise.resolve();
  }

  isBackendStarting = true;
  stderrBuffer = []; // 清空上次的 stderr 缓冲

  return new Promise(async (resolve, reject) => {
    const backendPath = getBackendPath();

    if (isDev) {
      // 开发模式：端口可通过 PORT 环境变量配置（0 = 系统自动分配，默认 3000）
      backendPort = parseInt(process.env.PORT || "3000", 10);
      // 生产调试模式禁用热重载（改代码不触发后端重启，用于自举开发）
      const noWatch = GUADA_PROD_DEBUG;
      const portDesc = backendPort === 0 ? "自动分配（随机）" : String(backendPort);
      console.log(
        `开发模式：使用端口 ${portDesc}${noWatch ? "（生产调试，无热重载）" : "（热重载）"}`,
      );
      // dev 端口固定（默认 3000）：先对账清掉上一次遗留的孤儿后端，否则本次 bind 必失败
      if (backendPort !== 0) {
        await reclaimDevPort(backendPort, path.resolve(backendPath, ".."));
      }
      // 开发模式：使用 spawn 启动后端
      const { spawn } = await import("child_process");
      const nodePath = process.platform === "win32" ? "npx.cmd" : "npx";
      const launcher = noWatch ? "ts-node" : "ts-node-dev";
      const entryScript = path.join(backendPath, "src", "main.ts");
      const args = noWatch
        ? [launcher, "--transpile-only", entryScript]
        : [launcher, "--respawn", "--transpile-only", entryScript];

      console.log(
        noWatch
          ? "生产调试模式：使用 ts-node 启动后端（无热重载）"
          : "开发模式：使用 ts-node-dev 启动后端（支持热重载）",
      );

      // 检测数据目录
      const dataHome = detectDataPath();
      const paths = computeDataPaths(dataHome);
      console.log(`数据目录: ${dataHome}`);

      ensureDataDir(dataHome);

      const staticDir = path.join(backendPath, "static");

      console.log("Database path:", paths.dbPath);
      console.log("Legacy vector database path (compat only):", paths.vectorDbPath);
      console.log("Static directory:", staticDir);
      console.log("Upload directory:", paths.uploadDir);
      console.log("Backend logs directory:", paths.logsDir);
      console.log("Skills directory:", paths.skillsDir);
      console.log("Workspace directory:", paths.workspaceDir);
      console.log("Plugins directory:", paths.pluginsDir);

      const devPluginsDir = path.join(backendPath, "..", "plugins");

      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          // Windows：VC++ 运行时目录进 PATH 首位（见 backendCrtPathEnv），
          // 保证 @node-rs/jieba 这类动态链接运行时的原生模块在干净系统上也能加载
          ...backendCrtPathEnv(),
          NODE_ENV: "development",
          PORT: String(backendPort),
          BASE_URL: "__auto__", // 与生产一致：动态设置 BASE_URL，后端返回的资源 URL 指向实际端口
          // 致命错误诊断报告：原生崩溃/内存耗尽时生成完整现场（native 栈、模块列表）。
          // 外部强杀（TerminateProcess）与 process.exit() 都不产生报告：报告缺失不能证明是他杀，
          // 定性以 [BackendExit] 记录的退出码为准（Node 不会自建 --report-dir，故需先 mkdir）
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            "--max-old-space-size=4096",
            "--report-on-fatalerror",
            "--report-uncaught-exception",
            `--report-dir=${diagnosticReportDir(paths.logsDir)}`,
          ].filter(Boolean).join(" "),
          DATABASE_URL: `file:${paths.dbPath}`,
          VECTOR_DB_PATH: paths.vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: paths.uploadDir,
          UPLOAD_URL_PREFIX: "/uploads",
          SETTINGS_DIR: dataHome, // 传递设置目录
          USERDATA_DIR: dataHome, // 传递用户数据目录
          LOGS_DIR: paths.logsDir, // 传递后端日志目录
          SKILLS_DIR: paths.skillsDir, // 传递技能目录
          PROVIDERS_DIR: paths.providersDir, // 供应商配置文件目录（YAML）
          WORKSPACE_BASE_DIR: paths.workspaceDir, // 传递会话工作目录基础路径
          PLUGINS_USER_DIR: paths.pluginsDir, // 用户安装的插件目录
          PLUGINS_DEV_DIR: devPluginsDir, // 开发模式外部插件目录
          ELECTRON_APP: "true", // 标识这是 Electron 环境
          GUADA_BRIDGE_PATH: process.env.GUADA_BRIDGE_PATH,
          GUADA_BRIDGE_TOKEN: process.env.GUADA_BRIDGE_TOKEN,
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      // 后端保持隐藏；终端使用 node-pty 随包 conpty.dll，
      // 不再依赖 Electron/ts-node-dev 的控制台上下文。
      windowsHide: true,
      };

      backendProcess = spawn(nodePath, args, spawnOptions);
      backendStartedAt = Date.now();
    } else {
      // 生产模式：使用 0 让系统自动分配端口，通过 IPC 获取
      backendPort = 0;
      const { spawn } = await import("child_process");
      const nodePath = process.execPath;
      const scriptPath = path.join(backendPath, "dist", "main.js");

      // 检查文件是否存在
      if (!fs.existsSync(scriptPath)) {
        console.error("后端文件不存在:", scriptPath);
        reject(new Error("Backend files not found"));
        return;
      }

      console.log("生产模式：从 unpacked 目录启动后端");
      console.log("后端路径:", backendPath);

      // 检测数据目录
      const dataHome = detectDataPath();
      const paths = computeDataPaths(dataHome);
      console.log(`数据目录: ${dataHome}`);

      // 初始化数据库
      ensureDataDir(dataHome);

      const staticDir = path.join(backendPath, "static");

      console.log("Database path:", paths.dbPath);
      console.log("Legacy vector database path (compat only):", paths.vectorDbPath);
      console.log("Static directory:", staticDir);
      console.log("Upload directory:", paths.uploadDir);
      console.log("Backend logs directory:", paths.logsDir);
      console.log("Skills directory:", paths.skillsDir);
      console.log("Workspace directory:", paths.workspaceDir);
      console.log("Plugins directory:", paths.pluginsDir);
      // 随包分发的插件目录（extraResources: plugins/guada-themes → resources/plugins）。
      // 生产后端没有 TS loader，插件入口必须是 JS；内置主题靠这里才加载得到。
      const builtinPluginsDir = path.join(process.resourcesPath, "plugins");
      console.log("Builtin plugins directory:", builtinPluginsDir);

      // 使用 spawn 启动后端
      const spawnOptions: any = {
        cwd: backendPath,
        env: {
          ...process.env,
          // Windows：VC++ 运行时目录进 PATH 首位（见 backendCrtPathEnv），
          // 保证 @node-rs/jieba 这类动态链接运行时的原生模块在干净系统上也能加载
          ...backendCrtPathEnv(),
          NODE_ENV: "production",
          ELECTRON_RUN_AS_NODE: "1", // 关键：以纯 Node 模式运行
          NODE_NO_WARNINGS: "1", // 抑制 Node.js 警告（如 punycode 弃用警告）
          // 致命错误诊断报告：原生崩溃/内存耗尽时生成完整现场（native 栈、模块列表）。
          // 外部强杀（TerminateProcess）与 process.exit() 都不产生报告：报告缺失不能证明是他杀，
          // 定性以 [BackendExit] 记录的退出码为准（Node 不会自建 --report-dir，故需先 mkdir）
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            "--max-old-space-size=4096",
            "--report-on-fatalerror",
            "--report-uncaught-exception",
            `--report-dir=${diagnosticReportDir(paths.logsDir)}`,
          ].filter(Boolean).join(" "),
          // 后端依赖在 app.asar 内（见 getBackendNodeModulesPath），真实目录里没有 node_modules
          NODE_PATH: getBackendNodeModulesPath(),
          PORT: backendPort.toString(),
          BASE_URL: "__auto__", // Electron 生产环境使用自动模式，动态设置 BASE_URL
          DATABASE_URL: `file:${paths.dbPath}`,
          VECTOR_DB_PATH: paths.vectorDbPath,
          STATIC_DIR: staticDir,
          UPLOAD_ROOT_DIR: paths.uploadDir,
          UPLOAD_URL_PREFIX: "/uploads",
          SETTINGS_DIR: dataHome, // 传递设置目录
          USERDATA_DIR: dataHome, // 传递用户数据目录
          LOGS_DIR: paths.logsDir, // 传递后端日志目录
          SKILLS_DIR: paths.skillsDir, // 传递技能目录
          WORKSPACE_BASE_DIR: paths.workspaceDir, // 传递会话工作目录基础路径
          PLUGINS_USER_DIR: paths.pluginsDir, // 用户安装的插件目录
          PLUGINS_BUILTIN_DIR: builtinPluginsDir, // 随包分发的内置插件目录（只读）
          ELECTRON_APP: "true", // 标识这是 Electron 环境
          GUADA_BRIDGE_PATH: process.env.GUADA_BRIDGE_PATH,
          GUADA_BRIDGE_TOKEN: process.env.GUADA_BRIDGE_TOKEN,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      };

      backendProcess = spawn(nodePath, [scriptPath], spawnOptions);
      backendStartedAt = Date.now();
    }

    if (!backendProcess) {
      reject(new Error("Failed to create backend process"));
      return;
    }

    let isResolved = false;
    // 通过 BridgeServer 监听后端端口上报事件
    bridgeServer?.onEvent("port_ready", (data: any) => {
      // 后端上报自身 PID：dev 包装链下 Electron 只能看到 cmd/npx，真实进程的死亡
      // 需要它自己的句柄退出监视来留证据（ts-node-dev 热重载会再次上报，据此换监视器）
      if (typeof data?.pid === "number") watchBackendRealExit(data.pid);
      if (data?.port && !isResolved) {
        backendPort = data.port;
        console.log(`通过 Bridge 接收到后端端口号 ${backendPort}`);
        isBackendStarting = false;
        isResolved = true;
        resolve();
      }
    });

    // 处理 stdout
    backendProcess.stdout?.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        console.log(`[Backend] ${message}`);
        // ts-node-dev 的 restart() 会往 stdout 打 "Restarting: <file> has been modified"，
        // 这是判定热重载的唯一硬证据（Windows 下 SIGTERM=TerminateProcess，退出码与日志都和异常死亡一样）
        const plain = message.replace(/\u001b\[[0-9;]*m/g, "");
        if (/\[(INFO|WARN)\]\s*(Restarting|Reinitializing TS compilation)/.test(plain)) {
          lastHotReloadNoticeAt = Date.now();
          log.info(`[BackendReload] ${plain}`);
        }
      }

      // // 开发模式：通过日志检测启动成功（开发环境固定端口 3000）
      // if (isDev && message.includes("Application is running on") && !isResolved) {
      //   isBackendStarting = false;
      //   isResolved = true;
      //   console.log(`[Backend] Application is running on port ${backendPort}`);
      //   resolve();
      // }
    });

    // 处理 stderr
    backendProcess.stderr?.on("data", (data) => {
      const errorMessage = data.toString().trim();
      if (errorMessage) {
        console.error(`[Backend Error] ${errorMessage}`);
        stderrBuffer.push(errorMessage);
        if (stderrBuffer.length > MAX_STDERR_LINES) {
          stderrBuffer.shift();
        }
      }
    });

    // 处理错误
    backendProcess.on("error", (error) => {
      log.error("后端进程启动失败:", error);
      isBackendStarting = false; // 重置标志
      reject(error);
    });

    // 处理退出（dev 下这是 cmd/npx 包装进程，真实后端的退出由 [BackendExit] 监视器报告）
    backendProcess.on("exit", (code) => {
      log.info(`后端包装进程退出，退出码: ${code} (pid=${backendProcess?.pid})`);
      isBackendStarting = false; // 重置标志
      isBackendReady = false;
      backendProcess = null;
      stopBackendExitWatcher();
      const realAlive = isPidAlive(backendRealPid);
      if (realAlive && !isBackendStopping) {
        log.error(
          `[BackendExit] 包装树已死但真实后端 PID=${backendRealPid} 仍在运行（孤儿进程，无人重启它），请检查进程树清理`,
        );
      }
      backendRealPid = 0;

      if (code !== 0 && code !== null && !isBackendStopping) {
        log.error(`后端进程异常退出，退出码: ${code} —— ${describeExitCode(code)}`);

        // 保存崩溃日志（stderr 最后 200 行）
        writeBackendCrashLog({
          exitCode: code,
          exitCodeMeaning: describeExitCode(code),
          signal: code === 134 ? "SIGABRT (原生模块崩溃或内存不足)" : undefined,
          realProcessAlive: realAlive,
          stderr: stderrBuffer.join("\n") || "(无 stderr 输出)",
        });

        // 显示重启对话框
        const exitCodeDesc = code === 134 ? "\n\n退出码 134 = SIGABRT，通常由原生模块崩溃或内存不足引起。" : "";
        const msgOptions = {
          type: "error" as const,
          title: "后端异常退出",
          message: `后端服务异常退出（退出码: ${code}）`,
          detail: `可能由于内存不足或原生模块异常导致。${exitCodeDesc}\n\n是否重新启动后端服务？`,
          buttons: ["重启后端", "不重启"],
          defaultId: 0,
          cancelId: 1,
        };

        (mainWindow && !mainWindow.isDestroyed()
          ? dialog.showMessageBox(mainWindow, msgOptions)
          : dialog.showMessageBox(msgOptions)
        ).then((result) => {
          if (result.response === 0) {
            log.info("用户选择重启后端");
            stderrBuffer = [];
            backendReadyPromise = startBackend()
              .then(() => {
                isBackendReady = true;
                log.info("后端重启成功");
              })
              .catch((err) => {
                log.error("后端重启失败:", err);
                isBackendReady = true;
              });
          }
        });
      }
    });

    // 设置超时
    setTimeout(() => {
      reject(new Error("Backend startup timeout"));
    }, 60000);
  });
}

// 创建系统托盘图标
function createTray() {
  // 开发环境：electron/dist/main.js 在 electron/dist/ 下，向上两级到项目根目录
  // 生产环境：build-resources 在 resources/ 下
  const isMac = process.platform === "darwin";
  const iconName = process.platform === "win32" ? "icon.ico" : isMac ? "menubar-iconTemplate.png" : "icon.png";
  const iconPath = isDev
    ? path.join(__dirname, "..", "..", "build-resources", iconName)
    : path.join(process.resourcesPath, "build-resources", iconName);

  // macOS 菜单栏使用 Template 图标（自动适配深色/浅色菜单栏）
  const trayIcon = nativeImage.createFromPath(iconPath);
  if (isMac) {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("GuaDa");

  updateTrayMenu();

  // 左键单击恢复窗口
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });

  // macOS 双击行为
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/** 更新托盘上下文菜单（含动态状态信息） */
function updateTrayMenu() {
  if (!tray) return;
  const items: MenuItemConstructorOptions[] = [
    {
      label: `运行中: ${trayStats.running}  未读: ${trayStats.unread}`,
      enabled: trayStats.running > 0 || trayStats.unread > 0,
      icon: undefined,
    },
    { type: "separator" },
    {
      label: "显示主窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

/**
 * 创建托盘悬浮小窗
 * 主窗口隐藏时，在屏幕右下角显示一个半透明状态卡片
 */
function createFloatWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  const floatingHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: transparent; }
html, body { height: 100%; overflow: hidden; }
body {
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e8e9ed;
  user-select: none;
  white-space: nowrap;
  display: flex; flex-direction: column; justify-content: center;
  padding: 0;
}
.card {
  background: rgba(30, 30, 35, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  width: 100%; height: 100%;
  display: flex; flex-direction: column; justify-content: center;
  padding: 6px 12px;
}
.row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px; }
.icon-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #4caf50; box-shadow: 0 0 3px #4caf50; }
.dot-orange { background: #ff9800; box-shadow: 0 0 3px #ff9800; }
.row .val { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
</style></head>
<body>
<div class="card" id="card" style="opacity:0">
  <div class="row"><span class="icon-dot dot-green"></span><span>任务运行中</span><span class="val" id="val-running">0</span></div>
  <div class="row"><span class="icon-dot dot-orange"></span><span>未读消息</span><span class="val" id="val-unread">0</span></div>
</div>
<script>
const { ipcRenderer } = require('electron');
const card = document.getElementById('card');

// 接收用户设置的透明度（浮窗就绪后主进程 float:ready → applyTraySettings 会立即下发）
ipcRenderer.on('float:settings', (_, settings) => {
  if (settings.opacity !== undefined) {
    card.style.opacity = String(settings.opacity / 100);
  }
});

// 悬浮窗统计数据更新（仅更新数字，不设置透明度）
ipcRenderer.on('float:update', (_, data) => {
  document.getElementById('val-running').textContent = data.running;
  document.getElementById('val-unread').textContent = data.unread;
});

// 双击恢复主窗口
card.addEventListener('dblclick', () => {
  ipcRenderer.send('float:dblclick');
});

// JS 拖拽实现（替代 -webkit-app-region，避免鼠标事件被拦截）
let isDragging = false;
let dragStartX = 0, dragStartY = 0;

card.addEventListener('mousedown', (e) => {
  isDragging = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;

  const onMouseMove = (e) => {
    if (e.buttons !== 1) { cleanup(); return; }
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      isDragging = true;
      ipcRenderer.send('float:drag-move', { dx, dy });
      dragStartX = e.screenX;
      dragStartY = e.screenY;
    }
  };

  const onMouseUp = () => {
    cleanup();
    isDragging = false;
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  });

  // 接收悬浮窗设置（透明度）
  ipcRenderer.on('float:settings', (_, settings) => {
    if (settings.opacity !== undefined) {
      userOpacity = settings.opacity / 100;
      card.style.opacity = String(userOpacity);
    }
  });

  // 通知主进程：浮窗已就绪，可下发缓存设置
  ipcRenderer.send('float:ready');
  <\/script>
</body>
</html>`;

  floatWindow = new BrowserWindow({
    width: 160,
    height: 80,
    x: screenWidth - 180,
    y: screenHeight - 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  floatWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(floatingHTML)}`,
  );

  floatWindow.on("closed", () => {
    floatWindow = null;
  });
}

/**
 * 应用悬浮窗设置（显隐 + 透明度）
 */
function applyTraySettings() {
  if (!floatWindow || floatWindow.isDestroyed()) return;

  // 显隐控制：主窗口最小化或隐藏时且 enabled 才显示浮窗
  const isMinimized = mainWindow?.isMinimized() ?? false;
  const isHidden = mainWindow ? !mainWindow.isVisible() : true;
  const shouldShow =
    traySettings.enabled && mainWindow && (isMinimized || isHidden);
  if (shouldShow) {
    floatWindow.show();
    floatWindow.webContents.send("float:settings", {
      opacity: traySettings.opacity,
    });
  } else {
    floatWindow.hide();
  }
}

// 判断是否为本地地址（允许在主窗口内导航）
function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 判断是否为安全的外部链接（仅允许 http/https）
function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// 拦截外部链接：弹窗确认后用系统默认浏览器打开
async function handleExternalUrl(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    log.warn(`[Security] Blocked non-http(s) URL: ${url}`);
    return;
  }
  const result = await dialog.showMessageBox(mainWindow!, {
    type: "question",
    title: "打开外部链接",
    message: "即将在默认浏览器中打开以下链接：",
    detail: url,
    buttons: ["打开", "取消"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    await shell.openExternal(url);
  }
}

// 设置应用菜单（macOS 需要标准菜单栏：App 菜单 / 编辑 / 视图 / 窗口 / 帮助）
function setupApplicationMenu() {
  const isMac = process.platform === "darwin";

  const appMenuItems: MenuItemConstructorOptions[] = isMac
    ? [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ]
    : [];

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    ...(isMac
      ? ([
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ] as MenuItemConstructorOptions[])
      : ([
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" },
        ] as MenuItemConstructorOptions[])),
  ];

  const windowSubmenu: MenuItemConstructorOptions[] = isMac
    ? [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" },
      ]
    : [{ role: "minimize" }, { role: "close" }];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ label: app.name, submenu: appMenuItems }] as MenuItemConstructorOptions[]) : []),
    {
      label: "编辑",
      submenu: editSubmenu,
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: windowSubmenu,
    },
    {
      role: "help",
      submenu: [
        {
          label: "打开数据目录",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "打开安装目录",
          click: () => {
            const installPath = isDev ? __dirname : path.dirname(app.getPath("exe"));
            shell.openPath(installPath);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // 不用 frame: false —— 完全无边框会移除原生 caption，丢失 Win11 贴靠布局
    // （snap layouts）、贴靠键盘动画等 DWM 能力；hidden 保留不可见原生标题栏，
    // 自绘标题栏照常覆盖其上
    titleBarStyle: "hidden", // Windows：隐藏但保留原生 caption；macOS：隐藏红绿灯栏
    // Windows：原生窗口按钮（Win11 贴靠布局 flyout 的前提）。overlay 底色全透明
    // （Qoder 同款做法）——去掉系统灰底，按钮符号直接画在主题标题栏上；
    // 符号色由渲染进程按主题经 IPC（titlebar-overlay-color）同步，高度来自 TITLEBAR_HEIGHT
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#ffffff",
      height: TITLEBAR_HEIGHT,
    },
    icon: isDev
      ? path.join(__dirname, "..", "build-resources", "icon.ico")
      : path.join(process.resourcesPath, "build-resources", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 启用 <webview> 标签，用于浏览器自动化内嵌预览
    },
    show: false,
    backgroundColor: "#000000",
    // macOS：红绿灯与 40px 高标题行垂直对齐（默认位置偏上）
    trafficLightPosition: { x: 14, y: 13 },
  });

  // 设置应用菜单
  setupApplicationMenu();

  if (isDev) {
    // 开发环境：根据 USE_STATIC_FRONTEND 决定加载方式
    if (process.env.USE_STATIC_FRONTEND === "true") {
      // 使用编译后的静态前端文件
      const frontendPath = path.join(
        __dirname,
        "..",
        "..",
        "frontend",
        "dist",
        "index.html",
      );
      console.log("~ file: main.ts ~ line 438 ~ frontendPath", frontendPath);
      mainWindow.loadFile(frontendPath);
    } else {
      // 使用 Vite 开发服务器（热重载）
      mainWindow.loadURL("http://localhost:5173");
    }

    // 不再自动打开开发者工具，用户可以通过 Debug 菜单手动打开
    // setTimeout(() => {
    //   mainWindow?.webContents.openDevTools({ mode: 'right' })
    // }, 1000)
  } else {
    // 生产环境加载打包后的前端文件
    // __dirname 指向 app.asar/electron/dist，需要向上两级到 app.asar，然后进入 frontend/dist
    const frontendPath = path.join(
      __dirname,
      "..",
      "..",
      "frontend",
      "dist",
      "index.html",
    );

    mainWindow.loadFile(frontendPath);

    // 生产环境也不自动打开开发者工具
    // if (process.env.DEBUG_MODE === 'true') {
    //   setTimeout(() => {
    //     mainWindow?.webContents.openDevTools({ mode: 'right' })
    //   }, 1000)
    // }
  }

  // 窗口准备好后显示。
  // 主题防闪烁由前端加载页承担：后端未就绪时路由守卫强制停留在品牌加载页
  // （/empty），后端就绪后前端先应用主题再跳回主页面（frontend/src/main.js
  // 的 waitBackendReady 回调），因此窗口显示时机无需等待主题，首帧即为
  // 加载页或主题已就绪的主页面。
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // 拦截 window.open() 和 target="_blank" 链接
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isLocalUrl(url)) {
      return { action: "allow" };
    }
    handleExternalUrl(url);
    return { action: "deny" };
  });

  // 拦截页面内导航（如点击 <a href="..."> 链接）
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isLocalUrl(url)) {
      return; // 允许本地导航
    }
    event.preventDefault();
    handleExternalUrl(url);
  });

  // 前端加载完成后检查更新
  mainWindow.webContents.on("did-finish-load", () => {
    if ((app as AppExtended).isQuiting) return;
    log.info("Frontend loaded, checking for updates...");
    doCheckForUpdates();

    // 每 6 小时定期检查更新
    setInterval(
      () => {
        log.info("Periodic update check...");
        doCheckForUpdates();
      },
      6 * 60 * 60 * 1000,
    );
  });

  // 关闭按钮最小化到托盘（hide 事件中执行 applyTraySettings，避免重复触发闪烁）
  mainWindow.on("close", (event) => {
    if (!(app as AppExtended).isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // 主窗口隐藏/最小化 → 延迟 1s 显示浮窗（避免闪烁），恢复/显示 → 立即隐藏
  let floatShowTimeout: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on("hide", () => {
    if (floatShowTimeout) clearTimeout(floatShowTimeout);
    floatShowTimeout = setTimeout(() => {
      applyTraySettings();
      floatShowTimeout = null;
    }, 500);
  });
  mainWindow.on("minimize", () => {
    if (floatShowTimeout) clearTimeout(floatShowTimeout);
    floatShowTimeout = setTimeout(() => {
      applyTraySettings();
      floatShowTimeout = null;
    }, 500);
  });
  mainWindow.on("show", () => {
    if (floatShowTimeout) {
      clearTimeout(floatShowTimeout);
      floatShowTimeout = null;
    }
    if (floatWindow) floatWindow.hide();
  });
  mainWindow.on("restore", () => {
    if (floatShowTimeout) {
      clearTimeout(floatShowTimeout);
      floatShowTimeout = null;
    }
    if (floatWindow) floatWindow.hide();
  });

  // 全屏状态推送给渲染进程：macOS 原生全屏会隐藏红绿灯，
  // 前端据此取消标题栏/侧边栏为其预留的左侧留白
  const sendFullscreenState = (isFullscreen: boolean) => {
    mainWindow?.webContents.send("window-fullscreen-changed", isFullscreen);
  };
  mainWindow.on("enter-full-screen", () => sendFullscreenState(true));
  mainWindow.on("leave-full-screen", () => sendFullscreenState(false));

  mainWindow.on("closed", () => {
    // 清理窗口管理器
    windowManager?.closeAllWindows();
    windowManager = null;
    mainWindow = null;
  });

  // 初始化窗口管理器（webview 架构：绑定主窗口监听 did-attach-webview）
  windowManager = new BrowserWebviewManager();
  windowManager.attachMainWindow(mainWindow);

  // 监听窗口大小变化（独立窗口不需要）
  // mainWindow.on('resize', () => {
  //   windowManager?.handleResize()
  // })
}

// IPC 通信处理
function setupIpcHandlers() {
  ipcMain.handle("get-app-info", () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      userDataPath: app.getPath("userData"),
      backendPort: backendPort,
      migration: {
        status: getMigrationStatus(),
        oldPath: DEFAULT_USER_DATA,
        newPath: GUADA_HOME,
      },
    };
  });

  // 数据迁移 IPC
  ipcMain.handle("migrate-data", async () => {
    try {
      console.log("开始数据迁移...");
      // 先停止后端（标记为主动停机，避免包装进程退出时弹崩溃框）
      if (backendProcess && !backendProcess.killed) {
        isBackendStopping = true;
        await forceKillBackendTree();
        backendProcess = null;
      }

      await handleMigration();
      console.log("数据迁移完成，重新启动后端...");

      // 重启后端（startBackend 会检测到 .migrated 标记，使用新路径）
      isBackendReady = false;
      isBackendStarting = false;
      backendReadyPromise = startBackend()
        .then(() => {
          isBackendReady = true;
          console.log("后端迁移后重启成功");
        })
        .catch((error) => {
          console.error("后端迁移后重启失败:", error);
          isBackendReady = true;
        });

      await backendReadyPromise;
      isBackendStopping = false; // 迁移后重启完成，恢复看门狗与崩溃判定
      return { success: true, message: "迁移完成" };
    } catch (error: any) {
      console.error("数据迁移失败:", error);
      isBackendStopping = false;
      return { success: false, message: error.message };
    }
  });

  // wait-backend-ready：单次 IPC 调用，后端就绪后返回，无需双向通信
  ipcMain.handle("wait-backend-ready", async () => {
    if (!isBackendReady) {
      await backendReadyPromise;
    }
    return { port: backendPort, error: null };
  });

  // 同步查询后端就绪状态（用于刷新场景，在 Vue 挂载前阻塞式确定初始值）
  // 附带端口：刷新场景下前端无需再走异步 IPC 获取端口，避免竞态
  ipcMain.on("get-backend-status-sync", (event) => {
    event.returnValue = { ready: isBackendReady, port: backendPort };
  });

  ipcMain.handle("show-notification", (_, { title, body }) => {
    // 可以在这里实现系统通知
    console.log("Notification:", title, body);
  });

  // 接收渲染进程推送的托盘统计信息，更新悬浮窗 + 托盘菜单
  ipcMain.on(
    "tray:update-stats",
    (_, stats: { running: number; unread: number }) => {
      trayStats = stats;
      // 更新托盘工具提示
      if (tray) {
        const parts: string[] = [];
        if (stats.running > 0) parts.push(`${stats.running} 个任务运行中`);
        if (stats.unread > 0) parts.push(`${stats.unread} 条未读`);
        tray.setToolTip(
          `GuaDa${parts.length > 0 ? ` - ${parts.join("，")}` : ""}`,
        );
      }
      // 更新托盘菜单
      updateTrayMenu();
      // 更新悬浮窗内容（仅统计数据，不携带设置项）
      if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send("float:update", stats);
      }
    },
  );

  // 悬浮窗双击 → 显示主窗口
  ipcMain.on("float:dblclick", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // 悬浮窗鼠标拖拽移动
  ipcMain.on("float:drag-move", (_, { dx, dy }: { dx: number; dy: number }) => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    const [x, y] = floatWindow.getPosition();
    floatWindow.setPosition(x + dx, y + dy);
  });

  // 接收前端设置的悬浮窗配置（始终下发浮窗，不依赖主窗口可见状态）
  ipcMain.on(
    "tray:update-settings",
    (_, settings: { enabled: boolean; opacity: number }) => {
      traySettings = settings;
      if (floatWindow && !floatWindow.isDestroyed()) {
        floatWindow.webContents.send("float:settings", {
          opacity: traySettings.opacity,
        });
      }
      applyTraySettings();
    },
  );

  // 防休眠模式：设置页「通用 → 桌面行为」变更时推送（落盘由后端负责，这里只管 blocker）
  ipcMain.on("power:update-keep-awake-mode", (_, mode: unknown) => {
    if (!isKeepAwakeMode(mode)) return;
    if (mode === keepAwakeMode) return;
    keepAwakeMode = mode;
    reconcileKeepAwakeBlocker();
  });

  // 浮窗就绪后主动发送缓存的设置
  ipcMain.on("float:ready", () => {
    applyTraySettings();
    // 推送当前统计数据
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.webContents.send("float:update", trayStats);
    }
  });

  // 窗口控制
  ipcMain.on("window-minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on("window-close", () => {
    mainWindow?.close();
  });

  // 获取窗口最大化状态
  ipcMain.handle("is-window-maximized", () => {
    return mainWindow?.isMaximized() || false;
  });

  // 获取窗口全屏状态（渲染进程挂载时查询初始值）
  ipcMain.handle("is-window-fullscreen", () => {
    return mainWindow?.isFullScreen() || false;
  });

  // 主题切换时同步 Windows 原生窗口按钮（titleBarOverlay）配色；
  // height 用常量兜底重申（渲染层只传配色，不传高度）
  ipcMain.on(
    "titlebar-overlay-color",
    (_e, c: { color?: string; symbolColor?: string; height?: number }) => {
      if (c && typeof c === "object")
        mainWindow?.setTitleBarOverlay({ color: "#00000000", height: TITLEBAR_HEIGHT, ...c });
    },
  );

  // 打开/关闭开发者工具
  ipcMain.on("toggle-devtools", () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: "right" });
      }
    }
  });

  // 自动更新相关 IPC（自定义 API 检测）
  ipcMain.handle("check-for-updates", async () => {
    return doCheckForUpdates();
  });

  // 显示调试菜单（固定菜单项）
  ipcMain.handle("show-debug-menu", async (event) => {
    log.debug("[DebugMenu] Showing debug menu");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      log.error("[DebugMenu] No window found");
      return;
    }

    const menuItems: MenuItemConstructorOptions[] = [
      {
        label: "Open DevTools",
        click: () => {
          log.debug("[DebugMenu] Opening dev tools");
          win.webContents.openDevTools();
        },
      },
      { type: "separator" },
      {
        label: "Open Data Directory",
        click: () => {
          log.debug("[DebugMenu] Opening user data folder");
          shell.openPath(app.getPath("userData"));
        },
      },
      {
        label: "Open Install Directory",
        click: () => {
          log.debug("[DebugMenu] Opening install folder");
          const installPath = isDev
            ? path.join(__dirname, "..", "..")
            : path.dirname(app.getPath("exe"));
          shell.openPath(installPath);
        },
      },
    ];

    const menu = Menu.buildFromTemplate(menuItems);
    menu.popup({ window: win });
  });

  // 显示标签页右键菜单
  ipcMain.handle(
    "show-tab-context-menu",
    async (
      event,
      { tabId, isSplitMode }: { tabId: string; isSplitMode: boolean },
    ) => {
      log.debug("[TabMenu] Showing context menu for tab:", tabId);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        log.error("[TabMenu] No window found");
        return;
      }

      // 获取目标窗口的 WebContents
      const targetWin = windowManager?.getWebContents(tabId);
      if (!targetWin) {
        log.error("[TabMenu] Target window not found:", tabId);
        return;
      }

      const menuItems: MenuItemConstructorOptions[] = [];

      // 打开开发者工具（内联模式）
      menuItems.push({
        label: "打开开发者工具",
        click: () => {
          targetWin.openDevTools({ mode: "right" });
        },
      });

      menuItems.push({ type: "separator" });

      // 隐藏/显示窗口（后台/前台模式）
      const isVisible = windowManager?.isWindowVisible(tabId) ?? false;
      menuItems.push({
        label: isVisible ? "隐藏窗口（后台模式）" : "显示窗口（前台模式）",
        click: () => {
          if (isVisible) {
            windowManager?.hideWindow(tabId);
          } else {
            windowManager?.showWindow(tabId);
          }
        },
      });

      menuItems.push({ type: "separator" });

      // 关闭窗口
      menuItems.push({
        label: "关闭窗口",
        click: () => {
          log.debug("[TabMenu] Closing window:", tabId);
          windowManager?.closeWindow(tabId);
        },
      });

      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup({ window: win });
    },
  );

  // 打开用户数据目录
  ipcMain.on("open-user-data-folder", () => {
    const targetPath = detectDataPath();
    shell.openPath(targetPath).then((error) => {
      if (error) {
        console.error("Failed to open user data folder:", error);
      }
    });
  });

  // 打开安装目录
  ipcMain.on("open-install-folder", () => {
    let installPath: string;
    if (isDev) {
      // 开发环境：打开项目根目录
      installPath = path.join(__dirname, "..", "..");
    } else {
      // 生产环境：打开应用安装目录
      installPath = path.dirname(app.getPath("exe"));
    }
    shell.openPath(installPath).then((error) => {
      if (error) {
        console.error("Failed to open install folder:", error);
      }
    });
  });

  // 打开指定文件夹
  ipcMain.handle("open-folder", async (_, folderPath: string) => {
    try {
      await shell.openPath(folderPath);
      return { success: true };
    } catch (error) {
      log.error("打开文件夹失�?", error);
      return { success: false, error: String(error) };
    }
  });

  // 在资源管理器中显示并选中文件
  ipcMain.handle("show-item-in-folder", async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      log.error("在资源管理器中显示文件失败", error);
      return { success: false, error: String(error) };
    }
  });

  // 用外部编辑器打开文件/目录（支持 vscode, 后续可扩展 cursor, webstorm 等）
  ipcMain.handle(
    "open-with-editor",
    async (_, params: { path: string; editor: string }) => {
      const { path: targetPath, editor } = params;
      try {
        let cmd: string;
        switch (editor) {
          case "vscode":
            cmd = `code "${targetPath}"`;
            break;
          case "terminal":
            // 系统终端打开：按平台选择打开方式
            if (process.platform === "win32") {
              cmd = `start "" cmd /k "cd /d ${targetPath}"`;
            } else if (process.platform === "darwin") {
              cmd = `open -a Terminal "${targetPath}"`;
            } else {
              cmd = `x-terminal-emulator --working-directory="${targetPath}"`;
            }
            break;
          default:
            return { success: false, error: `Unknown editor: ${editor}` };
        }
        await new Promise<void>((resolve, reject) => {
          exec(cmd, { windowsHide: true }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        return { success: true };
      } catch (error) {
        log.error(`用 ${editor} 打开失败`, error);
        return { success: false, error: String(error) };
      }
    },
  );

  // 选择文件夹对话框
  ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择工作目录",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // 选择文件对话框(私钥路径选择)
  ipcMain.handle("select-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "选择私钥文件",
      filters: [
        { name: "Private Key", extensions: ["pem", "key", "ppk", "id_rsa", "id_ed25519", "*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // 剪贴板操作（通过 IPC）
  ipcMain.handle("clipboard-write-text", (_, text: string) => {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      console.error("[Main] 剪贴板写入失败", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("clipboard-read-text", () => {
    try {
      const text = clipboard.readText();
      return { success: true, text };
    } catch (error) {
      console.error("[Main] 剪贴板读取失败", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 打开外部链接
  ipcMain.handle("open-external", async (_, url: string) => {
    try {
      if (!isSafeExternalUrl(url)) {
        log.warn(`[Security] Blocked open-external for non-http(s) URL: ${url}`);
        return { success: false, error: "仅允许 http/https 协议" };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error("打开外部链接失败:", error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== 浏览器窗口管理 IPC ====================

  // 创建新窗口
  ipcMain.handle("browser:create-window", async (_, { url, metadata }) => {
    try {
      const windowInfo = await windowManager!.createWindow(url, metadata);
      return { success: true, window: windowInfo };
    } catch (error: any) {
      log.error("创建窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 关闭窗口
  ipcMain.handle("browser:close-window", async (_, { windowId }) => {
    try {
      const success = await windowManager!.closeWindow(windowId);
      return { success };
    } catch (error: any) {
      log.error("关闭窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 获取窗口列表
  ipcMain.handle("browser:get-windows", () => {
    try {
      const windows = windowManager!.getWindowList();
      return { success: true, windows };
    } catch (error: any) {
      log.error("获取窗口列表失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 激活/聚焦窗口
  ipcMain.handle("browser:activate-window", async (_, { windowId }) => {
    try {
      // 使用 windowManager 的 showWindow 方法，会自动触发 window-updated 事件
      windowManager!.showWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("激活窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== Browser Shell IPC（已废弃 — webview 架构下无需外壳窗口）====================

  // ==================== 浏览器窗口文件存储 IPC ====================

  // 获取浏览器窗口数据存储目录
  function getBrowserDataDir(sessionPath?: string): string {
    if (!sessionPath) {
      throw new Error("缺少会话路径，无法确定文件保存位置");
    }

    // 确保目录存在
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    return sessionPath;
  }

  // 验证文件名安全性（防止路径穿越）
  function sanitizeFilename(filename: string): {
    valid: boolean;
    sanitized?: string;
    error?: string;
  } {
    if (!filename || typeof filename !== "string") {
      return { valid: false, error: "文件名不能为空" };
    }

    // 移除非法字符，仅保留字母、数字、下划线、连字符、点和中文
    const sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();

    if (!sanitized) {
      return { valid: false, error: "文件名无效" };
    }

    // 禁止路径穿越特征
    if (
      sanitized.includes("..") ||
      sanitized.startsWith("/") ||
      sanitized.startsWith("\\")
    ) {
      return { valid: false, error: "文件名包含非法路径字符" };
    }

    // 限制文件名长度
    if (sanitized.length > 255) {
      return { valid: false, error: "文件名过长（最大255字符）" };
    }

    return { valid: true, sanitized };
  }

  // 保存数据到文件
  ipcMain.handle(
    "browser:save-to-file",
    async (event, { filename, data, options }) => {
      try {
        const validation = sanitizeFilename(filename);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // 通过 event.sender 反查窗口元数据，获取会话工作路径
        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        const metadata = windowId
          ? windowManager!.getWindowMetadata(windowId)
          : undefined;
        const sessionPath = metadata?.sessionPath as string | undefined;

        const targetDir = getBrowserDataDir(sessionPath);
        const filePath = path.join(targetDir, validation.sanitized!);

        // 根据编码方式处理数据
        const encoding = options?.encoding || "utf8";

        if (encoding === "base64") {
          // base64 模式：剥离 data URI 前缀后解码为 Buffer 写入
          let base64Data =
            typeof data === "string" ? data : JSON.stringify(data);
          // 处理 data URI 格式：data:image/png;base64,iVBOR...
          const dataUriMatch = base64Data.match(
            /^data:[^;]+;base64,(.*)$/,
          );
          if (dataUriMatch) {
            base64Data = dataUriMatch[1];
          }
          await fs.promises.writeFile(
            filePath,
            Buffer.from(base64Data, "base64"),
          );
          log.info(`[BrowserData] 二进制文件已保存: ${filePath}`);
        } else {
          // utf8 模式：文本或 JSON 数据异步写入
          await fs.promises.writeFile(
            filePath,
            typeof data === "string" ? data : JSON.stringify(data, null, 2),
            "utf-8",
          );
          log.info(`[BrowserData] 文本文件已保存: ${filePath}`);
        }

        return { success: true, filePath };
      } catch (error: any) {
        log.error("[BrowserData] 保存文件失败:", error);
        return { success: false, error: error.message || "保存文件失败" };
      }
    },
  );

  // 从文件读取数据
  ipcMain.handle(
    "browser:read-from-file",
    async (event, { filename, options }) => {
      try {
        const validation = sanitizeFilename(filename);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // 通过 event.sender 反查窗口元数据，获取会话工作路径
        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        const metadata = windowId
          ? windowManager!.getWindowMetadata(windowId)
          : undefined;
        const sessionPath = metadata?.sessionPath as string | undefined;

        const targetDir = getBrowserDataDir(sessionPath);
        const filePath = path.join(targetDir, validation.sanitized!);

        try {
          await fs.promises.access(filePath);
        } catch {
          return { success: false, error: "文件不存在" };
        }

        // 根据编码方式读取文件
        const encoding = options?.encoding || "utf8";

        if (encoding === "base64") {
          // base64 模式：异步读取为 Buffer 后编码为 base64 字符串
          const buffer = await fs.promises.readFile(filePath);
          log.info(`[BrowserData] 二进制文件已读取: ${filePath}`);
          return { success: true, content: buffer.toString("base64") };
        } else {
          // utf8 模式：异步读取为文本
          const content = await fs.promises.readFile(filePath, "utf-8");
          log.info(`[BrowserData] 文本文件已读取: ${filePath}`);
          return { success: true, content };
        }
      } catch (error: any) {
        log.error("[BrowserData] 读取文件失败:", error);
        return { success: false, error: error.message || "读取文件失败" };
      }
    },
  );

  // 获取 Cookie
  ipcMain.handle("browser:get-cookies", async (event, filter) => {
    try {
      const sender = event.sender;
      const cookies = await sender.session.cookies.get(filter || {});
      log.info(`[BrowserCookie] 获取到 ${cookies.length} 个 cookie`);
      return { success: true, cookies };
    } catch (error: any) {
      log.error("[BrowserCookie] 获取 cookie 失败:", error);
      return { success: false, error: error.message || "获取 cookie 失败" };
    }
  });

  // 设置 Cookie
  ipcMain.handle("browser:set-cookie", async (event, cookie) => {
    try {
      const sender = event.sender;
      await sender.session.cookies.set(cookie);
      log.info(`[BrowserCookie] 设置 cookie: ${cookie.name}`);
      return { success: true };
    } catch (error: any) {
      log.error("[BrowserCookie] 设置 cookie 失败:", error);
      return { success: false, error: error.message || "设置 cookie 失败" };
    }
  });

  // 删除 Cookie
  ipcMain.handle("browser:remove-cookie", async (event, { url, name }) => {
    try {
      const sender = event.sender;
      // 补全 URL scheme：Electron cookies.remove 要求完整 URL
      let cookieUrl = url;
      if (cookieUrl && !/^[a-z]+:\/\//i.test(cookieUrl)) {
        cookieUrl = "http://" + cookieUrl;
      }
      await sender.session.cookies.remove(cookieUrl, name);
      log.info(`[BrowserCookie] 删除 cookie: ${name}`);
      return { success: true };
    } catch (error: any) {
      log.error("[BrowserCookie] 删除 cookie 失败:", error);
      return { success: false, error: error.message || "删除 cookie 失败" };
    }
  });

  // ==================== 浏览器窗口后台/前台模式控制 ====================

  // 隐藏窗口（后台模式）
  ipcMain.handle("browser:hide-window", async (_, { windowId }) => {
    try {
      windowManager!.hideWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("隐藏窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 显示窗口（前台模式）
  ipcMain.handle("browser:show-window", async (_, { windowId }) => {
    try {
      windowManager!.showWindow(windowId);
      return { success: true };
    } catch (error: any) {
      log.error("显示窗口失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 切换窗口可见性
  ipcMain.handle(
    "browser:toggle-window-visibility",
    async (_, { windowId }) => {
      try {
        const isVisible = windowManager!.toggleWindowVisibility(windowId);
        return { success: true, isVisible };
      } catch (error: any) {
        log.error("切换窗口可见性失败:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // 获取窗口可见性状态
  ipcMain.handle("browser:get-window-visibility", async (_, { windowId }) => {
    try {
      const isVisible = windowManager!.isWindowVisible(windowId);
      return { success: true, isVisible };
    } catch (error: any) {
      log.error("获取窗口可见性失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 清空所有浏览器自动化 session 数据（cookie、缓存、localStorage 等）
  ipcMain.handle("browser:clear-all-data", async () => {
    try {
      await windowManager?.clearAllBrowserData();
      return { success: true };
    } catch (error: any) {
      log.error("清除浏览器数据失败:", error.message);
      return { success: false, error: error.message };
    }
  });

  // glob 转正则匹配 URL（* → .*，? → .）
  function matchUrl(pattern: string, url: string): boolean {
    const re =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$";
    return new RegExp(re).test(url);
  }

  // 解析 @match / @exclude 头
  function parseUserscriptHeader(code: string): {
    include: string[];
    exclude: string[];
  } {
    const result = { include: ["**"] as string[], exclude: [] as string[] };
    const headerMatch = code.match(
      /\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==/,
    );
    if (!headerMatch) return result;
    const header = headerMatch[1];
    const matches = header.matchAll(/\/\/ @(match|include|exclude)\s+(\S+)/g);
    let hasMatch = false;
    const include: string[] = [];
    for (const [, key, pattern] of matches) {
      if (key === "exclude") result.exclude.push(pattern);
      else {
        include.push(pattern);
        hasMatch = true;
      }
    }
    if (hasMatch) result.include = include;
    return result;
  }

  // 获取用户脚本（preload 读取 .browser-work/scripts/*.js 用，带 URL 匹配过滤）
  ipcMain.handle(
    "browser:get-user-scripts",
    async (event, currentUrl: string) => {
      try {
        if (
          !currentUrl ||
          currentUrl.startsWith("chrome-error://") ||
          currentUrl.startsWith("about:")
        ) {
          return { success: true, scripts: [] };
        }

        const senderId = (event.sender as any).id;
        const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
        if (!windowId) {
          log.warn("[UserScripts] no windowId for sender " + senderId);
          return { success: true, scripts: [] };
        }
        const metadata = windowManager!.getWindowMetadata(windowId);
        const sessionPath = metadata?.sessionPath as string | undefined;
        if (!sessionPath) {
          log.warn("[UserScripts] no sessionPath for window " + windowId);
          return { success: true, scripts: [] };
        }
        const scriptsDir = path.join(sessionPath, ".browser-work", "scripts");
        log.info(
          "[UserScripts] scanning: " + scriptsDir + " for URL: " + currentUrl,
        );
        if (!fs.existsSync(scriptsDir)) {
          log.warn("[UserScripts] dir not found: " + scriptsDir);
          return { success: true, scripts: [] };
        }
        const files = (await fs.promises.readdir(scriptsDir)).filter((f) =>
          f.endsWith(".js"),
        );
        log.info("[UserScripts] found files: " + JSON.stringify(files));
        const scripts = [];
        for (const f of files) {
          const code = await fs.promises.readFile(
            path.join(scriptsDir, f),
            "utf-8",
          );
          const { include, exclude } = parseUserscriptHeader(code);
          const matchesUrl = exclude.some((p) => matchUrl(p, currentUrl))
            ? false
            : include.some((p) => matchUrl(p, currentUrl));
          if (matchesUrl) scripts.push({ id: f, code, matchesUrl });
        }
        return { success: true, scripts };
      } catch (error: any) {
        log.error("获取用户脚本失败:", error.message);
        return { success: true, scripts: [] };
      }
    },
  );

  // 弹窗自动关闭通知（preload 中劫持 alert/confirm/prompt 后发送）
  ipcMain.on(
    "browser:dialog-auto-dismissed",
    (event, data: { type: string; message: string }) => {
      const senderId = (event.sender as any).id;
      const windowId = windowManager!.getWindowIdByWebContentsId(senderId);
      if (!windowId) return;
      windowManager!.appendDialogLog(windowId, data.type, data.message);
      log.info(
        `[Dialog] Auto-dismissed on window ${windowId}: ${data.type} - ${data.message}`,
      );
    },
  );
}

// 后端启动 Promise（供 IPC 和 Browser Bridge 等待）
let backendReadyPromise: Promise<void> | null = null;

app.whenReady().then(async () => {
  try {
    log.info("Application starting...");
    setupIpcHandlers();

    // 防休眠：启动即按设置持有 blocker，不等设置页打开或任何前端请求
    keepAwakeMode = readKeepAwakeModeFromSettings();
    reconcileKeepAwakeBlocker();

    // 立即创建窗口，不用等后端启动
    createWindow();

    // 创建系统托盘图标
    createTray();

    // 创建托盘悬浮小窗
    createFloatWindow();

    // 启动后端服务（不阻塞窗口）
    log.info("Starting backend service in background...");

    // 先启动 Bridge Server，后端启动时需要连接
    const bridgePipePath = generatePipePath();
    const bridgeToken = generateBridgeToken();
    bridgeServer = new BridgeServer(bridgePipePath, bridgeToken);
    await bridgeServer.start();

    // 防休眠：后端每 5s 幂等上报忙碌状态（有对话/定时任务在跑 = true）。
    // 后端断开/热重载时复位为 false —— 没有后端在干活，就不该继续占着 blocker。
    bridgeServer.onEvent("keep_awake_state", (data: any) => {
      const busy = data?.busy === true;
      if (busy === keepAwakeBusy) return;
      keepAwakeBusy = busy;
      reconcileKeepAwakeBlocker();
    });
    bridgeServer.onClientDisconnected(() => {
      if (!keepAwakeBusy) return;
      keepAwakeBusy = false;
      reconcileKeepAwakeBlocker();
    });

    // 将 Bridge 路径和 token 通过环境变量传递给后端
    process.env.GUADA_BRIDGE_PATH = bridgePipePath;
    process.env.GUADA_BRIDGE_TOKEN = bridgeToken;

    // backendReadyPromise 在 startBackend 完成后 resolve（无论成功失败），供 IPC 和 Browser Bridge 使用
    backendReadyPromise = startBackend()
      .then(() => {
        log.info("Backend service started successfully");
        isBackendReady = true;
      })
      .catch((error) => {
        log.error("Backend service failed to start:", error);
        isBackendReady = true; // 让 UI 正常显示，错误由前端自行处理
      });

    // 窗口创建后，初始化 Browser Bridge（等后端就绪后再初始化）
    await backendReadyPromise;

    // 后端就绪后启动健康看门狗（仅记录日志）
    startBackendWatchdog();

    // 注册浏览器自动化服务为 Bridge 默认 handler
    if (windowManager && bridgeServer) {
      automationService = new BrowserAutomationService();
      automationService.initializeWindowManager(windowManager);
      bridgeServer.registerDefaultHandler(async (params: any, method: string) => {
        return automationService!.handleToolCall({ id: "0", method, params });
      });

      browserBridgeInitialized = true;
      log.info("Browser automation registered with Bridge Server");
    } else {
      log.error("WindowManager not available, cannot initialize browser automation");
    }

    log.info("Application initialized");
  } catch (error: any) {
    log.error("Application initialization failed:", error);
    app.quit();
  }
});

// 所有窗口关闭时
app.on("window-all-closed", () => {
  // 停止后端服务
  if (backendProcess) {
    console.log("Stopping backend service...");
    isBackendStopping = true;
    // 异步清理进程树；app.quit() 随即触发 before-quit，其兜底逻辑会等待同一目标
    void forceKillBackendTree().then(() => {
      backendProcess = null;
    });
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS 激活应用
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 应用退出前清理
let isCleaningUp = false;
app.on("before-quit", async (event) => {
  (app as AppExtended).isQuiting = true;

  if (isCleaningUp) return;
  isCleaningUp = true;
  event.preventDefault();

  // 停掉健康看门狗，避免退出流程中误报
  if (backendWatchdogTimer) {
    clearInterval(backendWatchdogTimer);
    backendWatchdogTimer = null;
  }

  // 0. 显示退出画面，浏览器导航会断开前端 keep-alive HTTP 连接
  if (mainWindow && !mainWindow.isDestroyed()) {
    // spinner 用品牌粉 #fb7299，与启动加载页（BackendWaitingOverlay.vue）一致
    const shutdownHtml = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;flex-direction:column"><div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#fb7299;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:20px"></div><p>正在退出...</p></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`;
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(shutdownHtml)}`,
    );

    // 等待导航完成，确保前端 HTTP 连接全部断开
    await new Promise<void>((resolve) => {
      mainWindow!.webContents.once("did-finish-load", resolve);
      setTimeout(resolve, 1500); // 兜底
    });
  }

  // 1. 通过 Bridge 发送优雅关闭信号，等待后端自行退出
  if (bridgeServer && backendProcess && !backendProcess.killed) {
    isBackendStopping = true;
    console.log("Sending graceful shutdown to backend...");
    bridgeServer.broadcast("shutdown", {});

    // 等待后端优雅退出（最多 5 秒）
    let backendExited = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      backendProcess?.once("exit", (code) => {
        clearTimeout(timer);
        backendExited = true;
        console.log(`Backend exited with code ${code}`);
        resolve();
      });
    });

    // 如果后端仍未退出，强制终止
    if (!backendExited && backendProcess && !backendProcess.killed) {
      console.log("Backend did not exit gracefully, force killing...");
      await forceKillBackendTree();
    }
    stopBackendExitWatcher();
    backendProcess = null;
    backendRealPid = 0;
  }

  // 2. 停止 Bridge Server
  if (bridgeServer) {
    await bridgeServer.stop();
    bridgeServer = null;
  }

  // 3. 清理浏览器自动化服务
  if (automationService) {
    await automationService.destroy();
    automationService = null;
  }

  // 继续退出流程
  app.quit();
});
