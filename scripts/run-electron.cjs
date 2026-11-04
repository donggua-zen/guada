/**
 * Electron 测试启动器。
 *
 * 直接 `electron xxx.js` 在有 ELECTRON_RUN_AS_NODE 环境变量的机器上会退化成
 * 纯 Node（拿不到 app/BrowserWindow），而 cross-env 把它置空也无效——
 * Electron 是按「变量是否存在」判断的。这里 spawn 一份干净环境。
 *
 * 用法：node scripts/run-electron.cjs <script.js> [args...]
 */
const { spawnSync } = require("node:child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronBinary, process.argv.slice(2), {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error("[run-electron] 启动失败:", result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
