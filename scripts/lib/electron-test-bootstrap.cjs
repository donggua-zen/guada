/**
 * Electron 测试脚本的统一入口包装（bootstrap）。
 *
 * 为什么需要这一层：
 * Electron 内置的未捕获异常处理器（lib/browser/init.ts）只做两件事——
 * `dialog.showErrorBox` 弹窗、**不退出进程**，而且**一个字都不写 stderr**。
 * 于是脚本崩了以后：弹窗常驻 → 进程不退 → 父 shell 不退 → run_command 只能干等到
 * 60s 转后台，模型全程拿不到任何错误信息。
 *
 * 更糟的是**解析期错误**（如 `const x` 重复声明这类 SyntaxError）：
 * 整个文件一行都不会执行，所以「在脚本自己开头注册 process.on('uncaughtException')」
 * 这种写法根本救不了——注册语句本身就没跑到。
 *
 * 本模块因此必须由外层先加载：先注册处理器，再 require 目标脚本。
 * 注册本身也顺带抑制了 Electron 的默认弹窗——它的放行条件正是
 * `process.listenerCount('uncaughtException') > 1`。
 *
 * 用法（由 scripts/run-electron.cjs 调用）：
 *   electron scripts/lib/electron-test-bootstrap.cjs <target-script.js> [args...]
 */

"use strict";

const path = require("node:path");

const TAG = "[electron-bootstrap]";

/** 目标脚本路径：argv[2]（Electron 自己的 init 会保证 argv 形状） */
const targetArg = process.argv[2];

if (!targetArg) {
  process.stderr.write(`${TAG} missing target script argument\n`);
  process.exit(2);
}

const targetPath = path.resolve(targetArg);
const targetArgs = process.argv.slice(3);

/**
 * 把 argv 还原成「直接 electron target.js」的形状。
 *
 * Electron 加载 bootstrap 时 argv 是 [electron, bootstrap, target, ...args]，
 * 要变成 [electron, target, ...args]。这里整段替换而不是 splice(1, 2, ...)——
 * 后者只删两个元素，target 之后已有的参数会留下来被重复追加。
 *
 * argv[1] 用调用方传入的原样字符串（相对路径保持相对），与直接 electron 启动一致；
 * require 时才用解析后的绝对路径。
 */
process.argv.splice(1, process.argv.length - 1, targetArg, ...targetArgs);

/** 统一出口：写 stderr 后以非零码退出。用 process.exit 而非 app.exit——app 可能还没 ready。 */
function fail(kind, error) {
  const stack = error && error.stack ? error.stack : String(error);
  process.stderr.write(`${TAG} ${kind}:\n${stack}\n`);
  // 让 stderr 先冲出去（inherit 模式下通常是同步的，这里只是兜底）
  process.exitCode = 1;
  process.exit(1);
}

/**
 * 我们的处理器先占位。注意不能直接 return —— 一旦这里 return，
 * Node 会认为异常已处理，进程继续跑，弹窗虽然没了但错误也丢了。
 */
function onUncaught(error) {
  fail("uncaught exception", error);
}

function onUnhandledRejection(reason) {
  fail("unhandled rejection", reason);
}

process.on("uncaughtException", onUncaught);
process.on("unhandledRejection", onUnhandledRejection);

/**
 * 加载目标脚本。
 *
 * try/catch 只能兜住**加载期**同步抛出的错误（含 SyntaxError、模块解析失败、
 * 顶层 throw）。运行期异常走上面的 process 处理器。
 */
const beforeUncaught = new Set(process.listeners("uncaughtException"));
const beforeRejection = new Set(process.listeners("unhandledRejection"));

let loaded = false;
try {
  require(targetPath);
  loaded = true;
} catch (error) {
  fail(`failed to load target script (${targetArg})`, error);
}

if (loaded) {
  /**
   * 让位：如果目标脚本自己注册了处理器，就撤掉我们的，把控制权交还给它
   * （例如 test-webview-navigation-crash-electron.js 要自己记录事件后 app.exit，
   * 而不是被我们直接 process.exit 打断）。
   *
   * 判据必须是「require 前后新增的监听器」——不能只数 listenerCount 或比较
   * 「有没有别人」：Electron 自己（lib/browser/init.ts）在 bootstrap 运行前就
   * 注册了 uncaughtException，把它当成脚本自注册会让我们的处理器被误删，
   * 运行期异常就又变回弹窗 + 挂死。
   */
  const addedUncaught = process
    .listeners("uncaughtException")
    .some((fn) => fn !== onUncaught && !beforeUncaught.has(fn));
  const addedRejection = process
    .listeners("unhandledRejection")
    .some((fn) => fn !== onUnhandledRejection && !beforeRejection.has(fn));

  if (addedUncaught) process.removeListener("uncaughtException", onUncaught);
  if (addedRejection) process.removeListener("unhandledRejection", onUnhandledRejection);
}
