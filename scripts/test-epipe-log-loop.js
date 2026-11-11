/**
 * EPIPE 自激循环回归测试
 *
 * 复现 2026-11-11 现场：dev 下终端关闭后 stdout 管道断开，console 写入抛 EPIPE，
 * 未加保护时 electron-log 的 processInternalErrorFn 会回头再写 console，
 * 形成「写日志失败 → 记错误 → 再写日志」的无限循环，几分钟刷满 50MB。
 *
 * 断言：打完补丁后，第一次写失败即关闭 console transport，后续 log 调用不再尝试写 console。
 *
 * 用法: node scripts/test-epipe-log-loop.js
 */

const assert = require("assert");

// 必须在 require electron-log 之前替换 console —— console transport 在模块加载时
// 就把 console.error/warn/info 等方法捕获进了 consoleMethods。
let consoleWriteAttempts = 0;
const epipe = () => {
  consoleWriteAttempts += 1;
  const error = new Error("EPIPE: broken pipe, write");
  error.code = "EPIPE";
  throw error;
};
for (const method of ["error", "warn", "info", "debug", "log"]) {
  console[method] = epipe;
}

const log = require("electron-log");

// ── 与 electron/main.ts 中相同的保护逻辑 ──
const consoleTransport = log.transports.console;
const rawConsoleWrite = consoleTransport.writeFn.bind(consoleTransport);
let consoleTransportBroken = false;

function disableConsoleTransport(reason) {
  if (consoleTransportBroken) return;
  consoleTransportBroken = true;
  consoleTransport.level = false;
  try {
    log.processMessage(
      {
        data: [`[Log] console transport disabled after write failure: ${reason}`],
        date: new Date(),
        level: "error",
      },
      { transports: ["file"] },
    );
  } catch {
    /* 文件也写不进去就彻底放弃 */
  }
}

consoleTransport.writeFn = (options) => {
  if (consoleTransportBroken) return;
  try {
    rawConsoleWrite(options);
  } catch (error) {
    disableConsoleTransport(error instanceof Error ? error.message : String(error));
  }
};

// 记录 processInternalErrorFn 的调用次数：它正是原循环的放大器
let internalErrorCount = 0;
log.processInternalErrorFn = () => {
  internalErrorCount += 1;
};

// ── 用例 1：连续写日志不应无限循环 ──
const BURST = 200;
for (let i = 0; i < BURST; i += 1) {
  log.error(`burst ${i}`);
}

assert.strictEqual(
  consoleWriteAttempts,
  1,
  `console 只应被尝试写 1 次，实际 ${consoleWriteAttempts} 次（说明发生了自激循环）`,
);
assert.strictEqual(
  internalErrorCount,
  0,
  `processInternalErrorFn 不应被调用，实际 ${internalErrorCount} 次`,
);
assert.strictEqual(consoleTransportBroken, true, "transport 应被标记为已关闭");
assert.strictEqual(consoleTransport.level, false, "transport level 应置为 false");

// ── 用例 2：重复触发关闭不应产生额外副作用 ──
disableConsoleTransport("manual repeat");
assert.strictEqual(consoleWriteAttempts, 1, "重复关闭不应再次尝试写 console");

// ── 用例 3：文件 transport 仍然可用 ──
assert.notStrictEqual(log.transports.file.level, false, "文件日志不应被一并关闭");

process.stdout.write(
  `[test-epipe-log-loop] PASS  写入尝试=${consoleWriteAttempts} 内部错误=${internalErrorCount} 日志条数=${BURST}\n`,
);
