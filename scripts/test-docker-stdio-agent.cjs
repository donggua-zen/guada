/**
 * Docker 容器工作区 · agent stdio 传输冒烟测试
 *
 * 把 guada-agent 注入运行中的容器，以 `docker exec -i <container> guada-agent --stdio`
 * 走 NDJSON JSON-RPC，验证容器工作区链路的协议正确性（不依赖 GuaDa 后端）。
 *
 * 用法:
 *   node scripts/test-docker-stdio-agent.cjs [container] [--keep]
 *
 *   container  目标容器名（缺省 guada-docker-smoke；不存在会尝试用 alpine 创建）
 *   --keep     结束后保留容器与 /tmp/.guada-agent（默认也不删除容器，仅清理 agent 目录）
 *
 * 环境要求: Docker daemon 可用；仓库内 guada-agent/dist/guada-agent-linux-amd64 已构建。
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONTAINER = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "guada-docker-smoke";
const AGENT_DIR = "/tmp/.guada-agent";
const AGENT_BIN = `${AGENT_DIR}/guada-agent`;
const ROOT = "/tmp/guada-ws-test";
const binaryPath = path.join(__dirname, "..", "guada-agent", "dist", "guada-agent-linux-amd64");

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...opts });
}

function ensureContainer() {
  let r = docker(["inspect", "--format", "{{.State.Running}}", CONTAINER]);
  if (r.status !== 0 || !r.stdout.includes("true")) {
    console.log(`容器 ${CONTAINER} 不可用，创建 alpine 测试容器...`);
    docker(["rm", "-f", CONTAINER]);
    r = docker(["run", "-d", "--name", CONTAINER, "alpine:latest", "sleep", "infinity"]);
    if (r.status !== 0) {
      throw new Error(`创建容器失败: ${r.stderr || r.stdout}`);
    }
  }
}

function injectAgent() {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`未找到 agent 二进制: ${binaryPath}（先执行 cd guada-agent && make linux-amd64）`);
  }
  let r = docker(["exec", CONTAINER, "mkdir", "-p", AGENT_DIR]);
  if (r.status !== 0) throw new Error(`容器内创建目录失败: ${r.stderr}`);
  r = docker(["cp", binaryPath, `${CONTAINER}:${AGENT_BIN}`]);
  if (r.status !== 0) throw new Error(`docker cp 失败: ${r.stderr}`);
  r = docker(["exec", CONTAINER, "chmod", "+x", AGENT_BIN]);
  if (r.status !== 0) throw new Error(`chmod 失败: ${r.stderr}`);
  docker(["exec", CONTAINER, "mkdir", "-p", ROOT]);
}

/** NDJSON 上的 JSON-RPC 客户端（与后端 RpcClient 同协议，最小实现） */
class StdioRpc {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.seq = 0;
    this.closed = false;
    this.stderr = "";
    this.buf = "";
    child.stdout.on("data", (d) => this._onData(d));
    child.stderr.on("data", (d) => (this.stderr += d.toString()));
    child.on("close", () => {
      this.closed = true;
      for (const [, p] of this.pending) p.reject(new Error("agent process exited"));
      this.pending.clear();
    });
  }

  _onData(d) {
    this.buf += d.toString("utf-8");
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("!! 非法 JSON 行:", line.slice(0, 120));
        continue;
      }
      const p = this.pending.get(msg.id);
      if (!p) {
        if (msg.event) console.log(`   [push] ${msg.event}`);
        continue;
      }
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error);
        err.code = msg.code;
        p.reject(err);
      } else {
        p.resolve(msg.result);
      }
    }
  }

  call(method, params, timeoutMs = 30000) {
    const id = `t${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC 超时(${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  close() {
    try {
      this.child.stdin.end();
    } catch {}
    setTimeout(() => {
      try {
        this.child.kill();
      } catch {}
    }, 500);
  }
}

// ── 用例 ──
let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (cond) passed++;
  else failed++;
}

(async () => {
  ensureContainer();
  injectAgent();

  const child = spawn(
    "docker",
    ["exec", "-i", CONTAINER, AGENT_BIN, "--stdio", "--root", ROOT, "--perm", "workspace"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const rpc = new StdioRpc(child);

  try {
    // 1) ping
    const ping = await rpc.call("ping");
    check("ping: pong + version", ping.pong === "ok" && !!ping.version, `version=${ping.version} root=${ping.root}`);
    check("ping: root 与配置一致", (ping.root || "").includes("guada-ws-test"), `root=${ping.root}`);

    // 2) writeFile / readFile（utf-8 与 base64 两种取回）
    await rpc.call("writeFile", { path: "sub/hello.txt", content: "hello 容器\n第二行\n" });
    const rf = await rpc.call("readFile", { path: "sub/hello.txt", encoding: "utf-8" });
    check("writeFile→readFile(utf-8) 往返", rf.data === "hello 容器\n第二行\n", JSON.stringify(rf.data));

    const rfB64 = await rpc.call("readFile", { path: "sub/hello.txt" });
    check("readFile(base64) 可解码且一致", Buffer.from(rfB64.data, "base64").toString("utf-8") === "hello 容器\n第二行\n");

    // 3) 大消息 1MB 文本往返（管道大 payload）
    const bigText = "abcdefghij".repeat(100_000); // 1MB
    await rpc.call("writeFile", { path: "big.txt", content: bigText }, 60000);
    const bigBack = await rpc.call("readFile", { path: "big.txt", encoding: "utf-8" }, 60000);
    check("1MB 文本往返一致", bigBack.data === bigText, `got ${bigBack.data?.length} chars`);

    // 3b) 二进制往返：走 upload* 分块（后端写二进制的真实路径）
    const bin = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < bin.length; i++) bin[i] = (i * 7) % 256;
    const up = await rpc.call("uploadStart", { remotePath: `${ROOT}/bin.dat`, totalBytes: bin.length });
    const CHUNK = 1024 * 1024;
    for (let off = 0; off < bin.length; off += CHUNK) {
      await rpc.call("uploadChunk", {
        uploadId: up.uploadId,
        data: bin.subarray(off, Math.min(off + CHUNK, bin.length)).toString("base64"),
      }, 60000);
    }
    await rpc.call("uploadEnd", { uploadId: up.uploadId }, 60000);
    const binBack = await rpc.call("readFile", { path: "bin.dat" }, 60000);
    check("1MB 二进制 upload* 往返一致", Buffer.from(binBack.data, "base64").equals(bin));

    // 4) stat / readdir / mkdir / rename / unlink
    const st = await rpc.call("stat", { path: "sub/hello.txt" });
    check("stat: 文件大小正确", st.size === Buffer.byteLength("hello 容器\n第二行\n"), `size=${st.size}`);
    const rd = await rpc.call("readdir", { path: "sub" });
    check("readdir: 列出 hello.txt", Array.isArray(rd) && rd.some((e) => e.name === "hello.txt"));
    await rpc.call("mkdir", { path: "a/b", recursive: true });
    await rpc.call("rename", { oldPath: "sub/hello.txt", newPath: "sub/renamed.txt" });
    const rd2 = await rpc.call("readdir", { path: "sub" });
    check("rename 生效", rd2.some((e) => e.name === "renamed.txt"));
    await rpc.call("unlink", { path: "sub/renamed.txt" });
    const rd3 = await rpc.call("readdir", { path: "sub" });
    check("unlink 生效", Array.isArray(rd3) && !rd3.some((e) => e.name === "renamed.txt"));
    // 空目录必须返回 []（nil slice → null 会让调用方误解为响应缺失）
    check("readdir: 空目录返回 []", Array.isArray(rd3) && rd3.length === 0, JSON.stringify(rd3));

    // 5) replaceInFile
    await rpc.call("writeFile", { path: "edit.txt", content: "alpha beta gamma" });
    const rep = await rpc.call("replaceInFile", { path: "edit.txt", oldText: "beta", newText: "BETA" });
    const after = await rpc.call("readFile", { path: "edit.txt", encoding: "utf-8" });
    check("replaceInFile 生效", rep.count >= 1 && after.data === "alpha BETA gamma", JSON.stringify(rep));

    // 6) glob / grep（agent ≥0.5.0 原生实现）
    const g = await rpc.call("glob", { pattern: "**/*.txt", cwd: ROOT, limit: 50 });
    check("glob: 命中 edit.txt", Array.isArray(g.files) && g.files.some((f) => f.path.includes("edit.txt")), JSON.stringify(g.files?.map((f) => f.path)));
    const gr = await rpc.call("grep", { pattern: "BETA", path: ROOT, maxResults: 10 });
    check("grep: 命中替换后内容", Array.isArray(gr) && gr.some((l) => String(l).includes("edit.txt")), JSON.stringify(gr));

    // 7) execute：正常/非零退出码/stderr/编码
    const ok = await rpc.call("execute", { command: "echo hello-from-container && pwd", cwd: ROOT, timeout: 15000 });
    check("execute: 输出含标记", String(ok.output || "").includes("hello-from-container"), JSON.stringify(ok.output));
    check("execute: exitCode=0", ok.exitCode === 0, `exitCode=${ok.exitCode}`);
    const bad = await rpc.call("execute", { command: "echo to-stderr >&2; exit 3", cwd: ROOT, timeout: 15000 });
    check("execute: 非零退出码透传", bad.exitCode === 3, `exitCode=${bad.exitCode}`);
    check("execute: stderr 并入输出", String(bad.output || "").includes("to-stderr"), JSON.stringify(bad.output));

    // 8) 权限（workspace 模式）：root 外的写入被拒
    let denied = false;
    let denyMsg = "";
    try {
      await rpc.call("writeFile", { path: "/etc/should-fail.txt", content: "x" });
    } catch (e) {
      denied = true;
      denyMsg = e.message;
    }
    check("perm=workspace: root 外写入被拒", denied, denyMsg.slice(0, 120));

    // 9) 后台进程：超时转后台后 poll
    const bg = await rpc.call("execute", { command: "sleep 5; echo bg-done", cwd: ROOT, timeout: 800 });
    check("execute: 超时转后台(backgrounded)", bg.kind === "backgrounded" && !!bg.processId, JSON.stringify({ kind: bg.kind, pid: bg.processId, log: bg.logFile }));
    if (bg.processId) {
      const poll = await rpc.call("poll", { processId: bg.processId, timeoutMs: 8000 }, 15000);
      check("poll: 后台进程完成且输出可读", poll && poll.status === "completed", JSON.stringify(poll));
    }
  } catch (e) {
    check("未捕获异常", false, e.message);
  } finally {
    rpc.close();
    setTimeout(() => {
      const stderrTail = rpc.stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
      if (stderrTail) console.log(`\nagent stderr(尾 3 行): ${stderrTail}`);
      docker(["exec", CONTAINER, "rm", "-rf", AGENT_DIR]);
      console.log(`\n== DOCKER STDIO AGENT: ${passed} passed, ${failed} failed ==`);
      process.exit(failed === 0 ? 0 : 1);
    }, 800);
  }
})().catch((e) => {
  console.error("脚本错误:", e.message);
  process.exit(2);
});
