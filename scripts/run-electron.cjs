/**
 * Electron 测试启动器。
 *
 * 直接 `electron xxx.js` 有两个坑：
 *
 * 1. 在有 ELECTRON_RUN_AS_NODE 环境变量的机器上会退化成纯 Node（拿不到 app/BrowserWindow），
 *    而 cross-env 把它置空也无效——Electron 是按「变量是否存在」判断的。这里 spawn 一份干净环境。
 * 2. 脚本一旦抛异常（尤其是解析期 SyntaxError），Electron 内置处理器只会弹一个
 *    "A JavaScript error occurred in the main process" 的模态框并且**不退出进程**，
 *    父进程（run_command 起的 shell）因此永久阻塞、模型拿不到任何错误文本。
 *    这里统一经 scripts/lib/electron-test-bootstrap.cjs 启动：先注册异常处理器再加载目标脚本，
 *    错误直接写 stderr 并以非零码退出。
 *
 * 用法：node scripts/run-electron.cjs <script.js> [args...]
 *       node scripts/run-electron.cjs --timeout=30000 <script.js> [args...]
 */
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const electronBinary = require("electron");

const BOOTSTRAP = path.join(__dirname, "lib", "electron-test-bootstrap.cjs");
/** 默认上限：远大于任何正常测试脚本的耗时，只用于兜住"进程挂死" */
const DEFAULT_TIMEOUT_MS = 120_000;
/** 超时退出码，与 shell 的 124 约定一致 */
const TIMEOUT_EXIT_CODE = 124;

const argv = process.argv.slice(2);
let timeoutMs = DEFAULT_TIMEOUT_MS;
while (argv.length > 0 && argv[0].startsWith("--timeout=")) {
  const raw = argv.shift().slice("--timeout=".length);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) timeoutMs = parsed;
}

if (argv.length === 0) {
  console.error("[run-electron] 缺少目标脚本。用法：node scripts/run-electron.cjs <script.js> [args...]");
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [BOOTSTRAP, ...argv], {
  stdio: "inherit",
  env,
  windowsHide: true,
});

/**
 * 结束整棵进程树。
 * Windows 上 child.kill() 只杀直接子进程，Electron 的 GPU/渲染子进程会残留；
 * 走 taskkill /T 才能连根带走（与 backend ProcessManager 的终止策略一致）。
 */
function killTree() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // 落到 child.kill 兜底
    }
  }
  child.kill();
}

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[run-electron] 超时 ${timeoutMs}ms，强制结束 Electron 进程（pid=${child.pid}）`);
  killTree();
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timer);
  console.error("[run-electron] 启动失败:", error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  if (timedOut) {
    process.exit(TIMEOUT_EXIT_CODE);
  }
  if (code === null) {
    console.error(`[run-electron] Electron 被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code);
});

// 父进程收到中断信号时把子进程一起带走，避免 Electron 变成孤儿继续弹窗
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    killTree();
  });
}
