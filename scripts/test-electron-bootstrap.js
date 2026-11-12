/**
 * electron-test-bootstrap 的行为回归。
 *
 * 用纯 Node 跑 bootstrap（它自身不依赖 electron），目标脚本也从临时目录生成：
 * 这样能确定性地覆盖「解析期 SyntaxError / 顶层 throw / 运行期异常 / 自注册处理器让位 /
 * argv 还原」这几条，而不需要真的拉起 Electron 窗口。
 *
 * 运行：node --test scripts/test-electron-bootstrap.js
 */
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BOOTSTRAP = path.join(__dirname, "lib", "electron-test-bootstrap.cjs");

function runTarget(source, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-electron-bootstrap-"));
  const file = path.join(dir, "target.js");
  fs.writeFileSync(file, source, "utf8");
  try {
    return spawnSync(process.execPath, [BOOTSTRAP, file, ...args], {
      encoding: "utf8",
      timeout: 15000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("解析期 SyntaxError：直接写 stderr 并以非零码退出", () => {
  const result = runTarget("const x = 1;\nconst x = 2;\n");
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /\[electron-bootstrap\] failed to load target script/);
  assert.match(result.stderr, /SyntaxError: Identifier 'x' has already been declared/);
});

test("加载期顶层 throw：同样被兜住", () => {
  const result = runTarget('throw new Error("top-level boom");\n');
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /\[electron-bootstrap\] failed to load target script/);
  assert.match(result.stderr, /top-level boom/);
});

test("运行期未捕获异常：写 stderr 并退出", () => {
  const result = runTarget(
    'setTimeout(() => { throw new Error("runtime boom"); }, 0);\n',
  );
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /\[electron-bootstrap\] uncaught exception/);
  assert.match(result.stderr, /runtime boom/);
});

test("运行期 unhandledRejection：写 stderr 并退出", () => {
  const result = runTarget(
    'Promise.reject(new Error("rejection boom"));\n',
  );
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /\[electron-bootstrap\] unhandled rejection/);
  assert.match(result.stderr, /rejection boom/);
});

test("目标脚本自己注册 handler：bootstrap 让位，退出码由脚本决定", () => {
  const result = runTarget(
    [
      'process.on("uncaughtException", () => {',
      '  process.stderr.write("SELF_HANDLER\\n");',
      "  process.exit(7);",
      "});",
      'setTimeout(() => { throw new Error("handled by self"); }, 0);',
    ].join("\n"),
  );
  assert.strictEqual(result.status, 7);
  assert.match(result.stderr, /SELF_HANDLER/);
  // 让位后不应再由 bootstrap 抢着退出
  assert.doesNotMatch(result.stderr, /\[electron-bootstrap\]/);
});

test("argv 还原：目标脚本看到的参数与直接启动一致", () => {
  const result = runTarget(
    "process.stdout.write(JSON.stringify(process.argv.slice(1)));\n",
    ["alpha", "beta"],
  );
  assert.strictEqual(result.status, 0);
  const [targetArg, ...rest] = JSON.parse(result.stdout);
  // argv[1] 保留调用方传入的原样字符串（bootstrap 不插入自己）
  assert.ok(targetArg.endsWith("target.js"), `argv[1] 应为目标脚本，实际 ${targetArg}`);
  assert.deepStrictEqual(rest, ["alpha", "beta"]);
});
