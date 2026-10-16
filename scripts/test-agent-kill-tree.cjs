/**
 * 远端 agent · 进程树终止冒烟测试（容器工作区 / SSH 远端共用同一份 Go 逻辑）
 *
 * 为什么需要它：终止是否真的终止只能在容器里看见效果——只杀掉 `sh` 时，管道成员
 * （sort/head/cat/sleep）会变成孤儿继续跑，而 GNU `timeout` 还会给自己和子命令另开进程组，
 * 让"整组终止"也够不到。这里把修复前实测出的四类形态固化成断言。
 *
 * 用法:
 *   node scripts/test-agent-kill-tree.cjs [container] [--image=<img>] [--keep]
 *
 *   container   目标容器名（缺省 guada-kill-tree-smoke；不存在则按 --image 创建）
 *   --image     创建容器用的镜像，缺省 debian:stable-slim
 *               （需要 GNU ps/timeout 与 sh：alpine/busybox 不支持本用例）
 *   --keep      结束后保留容器（默认删除）
 *
 * 环境要求: Docker daemon 可用；本机有 Go（用于交叉编译 agent 与测试二进制）。
 *
 * 退出码: 0 = 全部通过；1 = 有场景未达标。
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const CONTAINER =
  args.find((a) => !a.startsWith("--")) || "guada-kill-tree-smoke";
const IMAGE =
  (args.find((a) => a.startsWith("--image=")) || "").split("=")[1] ||
  "debian:stable-slim";
const KEEP = args.includes("--keep");

const REPO_ROOT = path.join(__dirname, "..");
const AGENT_SRC = path.join(REPO_ROOT, "guada-agent");
const AGENT_DIR = "/tmp/.guada-agent";
const AGENT_BIN = `${AGENT_DIR}/guada-agent`;
const TEST_BIN = "/tmp/.guada-agent/killtree.test";
const ROOT = "/tmp/guada-ws-test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localBin = path.join(os.tmpdir(), `guada-agent-killtree-${Date.now()}`);
const localTestBin = `${localBin}.test`;

function docker(cmdArgs, opts = {}) {
  return spawnSync("docker", cmdArgs, {
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    const detail = `${(r.stdout || "").trim().split("\n").slice(-5).join("\n")}\n${(r.stderr || "").trim().split("\n").slice(-5).join("\n")}`;
    throw new Error(`${cmd} 退出码 ${r.status}\n${detail}`.trim());
  }
  return r.stdout;
}

function ensureContainer() {
  const inspect = docker(["inspect", "--format", "{{.State.Running}}", CONTAINER]);
  if (inspect.status === 0 && inspect.stdout.includes("true")) {
    console.log(`复用容器 ${CONTAINER}`);
    return;
  }
  console.log(`创建容器 ${CONTAINER} (image=${IMAGE})...`);
  docker(["rm", "-f", CONTAINER]);
  const created = docker([
    "run", "-d", "--init", "--name", CONTAINER, "--entrypoint", "/usr/bin/tail",
    IMAGE, "-f", "/dev/null",
  ]);
  if (created.status !== 0) {
    // 镜像里没有 tail 的极简发行版：退回 sleep
    const retry = docker([
      "run", "-d", "--init", "--name", CONTAINER, IMAGE, "sleep", "infinity",
    ]);
    if (retry.status !== 0) {
      throw new Error(`创建容器失败: ${(created.stderr || created.stdout).trim()}`);
    }
  }
}

function buildBinaries() {
  console.log("交叉编译 agent 与测试二进制 (linux/amd64)...");
  run("go", ["build", "-o", localBin, "."], { cwd: AGENT_SRC, env: { ...process.env, GOOS: "linux", GOARCH: "amd64" } });
  run("go", ["test", "-c", "-o", localTestBin, "."], { cwd: AGENT_SRC, env: { ...process.env, GOOS: "linux", GOARCH: "amd64" } });
  docker(["exec", CONTAINER, "sh", "-c", `mkdir -p ${AGENT_DIR} ${ROOT}`]);
  run("docker", ["cp", localBin, `${CONTAINER}:${AGENT_BIN}`]);
  run("docker", ["cp", localTestBin, `${CONTAINER}:${TEST_BIN}`]);
  run("docker", ["exec", CONTAINER, "sh", "-c", `chmod +x ${AGENT_BIN} ${TEST_BIN}`]);
}

function ensureTooling() {
  const probe = docker([
    "exec", CONTAINER, "sh", "-c",
    "for t in sh ps timeout sleep sort head cat; do command -v $t >/dev/null || echo MISSING:$t; done",
  ]);
  const missing = (probe.stdout || "").trim();
  if (missing) {
    throw new Error(
      `容器缺少用例所需工具（${missing}）——请用 --image=debian:stable-slim 这类带 GNU ps/coreutils 的镜像`,
    );
  }
}

/** 容器内管道类进程快照：pid → 原始 ps 行 */
function procs() {
  const out = run("docker", [
    "exec", CONTAINER, "ps", "-eo", "pid,ppid,pgid,stat,cmd",
  ]);
  const map = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim() || /ps -eo|guada-agent|killtree\.test|PID/.test(line)) continue;
    if (!/sh -c|timeout|setsid|\bsleep\b|\bcat\b|\bsort\b|\bhead\b/.test(line)) continue;
    map.set(line.trim().split(/\s+/)[0], line.trim());
  }
  return map;
}

function newSince(baseline) {
  const now = procs();
  return [...now.entries()].filter(([pid]) => !baseline.has(pid)).map(([, row]) => row);
}

function cleanupContainerProcs() {
  docker([
    "exec", CONTAINER, "sh", "-c",
    "pkill -9 -f 'sleep 100' ; pkill -9 -f 'sleep 300' ; pkill -9 -f 'sleep 137' ; pkill -9 -f 'timeout 120' ; true",
  ]);
}

class AgentClient {
  constructor() {
    this.pending = new Map();
    this.buf = "";
    this.seq = 0;
    this.logs = [];
    this.child = spawn(
      "docker",
      ["exec", "-i", CONTAINER, AGENT_BIN, "--stdio", "--root", ROOT, "--perm", "unrestricted"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.stdout.on("data", (d) => {
      this.buf += d.toString("utf8");
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line) this.onLine(line);
      }
    });
    this.child.stderr.on("data", (d) => {
      const text = d.toString().trim();
      if (text) this.logs.push(text);
    });
  }
  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`${msg.error} (${msg.code || "-"})`));
    else p.resolve(msg.result);
  }
  call(method, params, timeoutMs = 30000) {
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc 超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  /** 只发不等（execute 会挂到命令结束）；返回 requestId 供 cancel 用 */
  fire(method, params) {
    const id = `req-${++this.seq}`;
    this.pending.set(id, { resolve: () => {}, reject: () => {} });
    this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    return id;
  }
  close() {
    try {
      this.child.stdin.end();
      this.child.kill();
    } catch {
      /* ignore */
    }
  }
}

const CMD_TIMEOUT = "for d in 1 2; do timeout 120 sleep 100 | cat; done | sort -u | head -5";
const CMD_SETSID = "for d in 1 2; do setsid sleep 300 | cat; done | sort -u | head -5";
const CMD_PIPE = "for d in 1 2; do sleep 100 | cat; done | sort -u | head -5";
const CMD_DOUBLE_ESCAPE = "( setsid sleep 137 & ) ; echo daemonized";

(async () => {
  const results = [];
  try {
    ensureContainer();
    ensureTooling();
    buildBinaries();

    // ── 1) 容器内跑终止相关 Go 单测（真实 POSIX 路径：进程组 + PPID 快照） ──
    // 只跑本模块相关用例：容器里既有其它用例依赖端口/pkill/WS，环境不同不代表本改动有问题
    // （全量 `go test ./...` 由开发机 `make test` 负责）。
    console.log("\n=== Go 单测（容器内，终止相关用例）===");
    const testOut = run("docker", [
      "exec", CONTAINER, "sh", "-c",
      `cd /tmp && TMPDIR=/tmp ${TEST_BIN} -test.v -test.timeout 180s ` +
        `-test.run 'TestParseProcessTable|TestChildrenOf|TestKillTerminatesWholeTree|TestCancelTerminatesSelfRegroupedTree'`,
    ]);
    const failedLines = testOut.split("\n").filter((l) => /^\s*--- FAIL|^FAIL/.test(l));
    console.log(testOut.split("\n").filter((l) => /^(--- (PASS|SKIP|FAIL)|PASS|FAIL|ok)/.test(l)).join("\n"));
    results.push({ name: "Go 单测", ok: failedLines.length === 0, detail: failedLines.join("; ") });

    // ── 2) RPC 级四场景（与修复前实测的形态一一对应） ──
    const agent = new AgentClient();
    await sleep(800);
    const pong = await agent.call("ping", {});
    if (!pong || pong.pong !== "ok") throw new Error("agent ping 未返回预期响应");
    console.log(`\n=== RPC 场景（agent v${pong.version}）===`);

    const scenarios = [
      {
        name: "A 前台 cancel · timeout 自建组",
        baseline: procs(),
        run: async () => {
          const req = agent.fire("execute", { command: CMD_TIMEOUT, cwd: ROOT, timeout: 60000 });
          await sleep(3000);
          await agent.call("cancel", { requestId: req });
        },
      },
      {
        name: "A2 前台 cancel · setsid 换会话",
        baseline: procs(),
        run: async () => {
          const req = agent.fire("execute", { command: CMD_SETSID, cwd: ROOT, timeout: 60000 });
          await sleep(3000);
          await agent.call("cancel", { requestId: req });
        },
      },
      {
        name: "B 显式后台 + kill",
        baseline: procs(),
        run: async () => {
          const bg = await agent.call("execute", { command: CMD_PIPE, cwd: ROOT, background: true, timeout: 60000 });
          await sleep(2500);
          await agent.call("kill", { processId: bg.processId });
        },
      },
      {
        name: "C 前台超时→后台 + kill",
        baseline: procs(),
        run: async () => {
          const to = await agent.call("execute", { command: CMD_PIPE, cwd: ROOT, timeout: 3000 }, 20000);
          await sleep(1500);
          await agent.call("kill", { processId: to.processId });
        },
      },
      {
        name: "D 双重逃逸 ( setsid X & )（已知盲区，仅记录）",
        baseline: procs(),
        expectZero: false,
        run: async () => {
          agent.fire("execute", { command: CMD_DOUBLE_ESCAPE, cwd: ROOT, timeout: 8000 });
          await sleep(2500);
        },
      },
    ];

    for (const s of scenarios) {
      await s.run();
      await sleep(4000);
      const leaked = newSince(s.baseline);
      const expectZero = s.expectZero !== false;
      const ok = expectZero ? leaked.length === 0 : true;
      console.log(`==> ${s.name}: ${leaked.length === 0 ? "0 残留 ✓" : `${leaked.length} 个残留`}${expectZero ? "" : "（预期可能残留）"}`);
      if (leaked.length) console.log(leaked.map((l) => "    " + l).join("\n"));
      results.push({ name: s.name, ok, detail: leaked.join(" | ") });
      cleanupContainerProcs();
    }
    agent.close();
    await sleep(300);

    // ── 3) 汇总 ──
    console.log("\n==================== 汇总 ====================");
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
    }
    const failed = results.filter((r) => !r.ok);
    console.log(failed.length === 0 ? "结论: 全部通过" : `结论: ${failed.length} 项未达标`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    cleanupContainerProcs();
    for (const f of [localBin, localTestBin]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
    if (!KEEP) {
      docker(["rm", "-f", CONTAINER]);
      console.log(`已删除容器 ${CONTAINER}（--keep 可保留）`);
    }
  }
})()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`冒烟失败: ${err.message}`);
    process.exit(1);
  });
