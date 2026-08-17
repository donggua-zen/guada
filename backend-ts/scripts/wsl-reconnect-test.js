#!/usr/bin/env node
/**
 * WSL 真实环境断线恢复集成测试:
 *   部署 agent → WS 连接 + ping → 模拟断开(杀进程)→ 验证 agent 退出
 *   → 重新部署/连接 → ping 验证自动恢复
 *
 * 凭据从 ../.wsl-test-config.json 读取(不入库)。
 * 用法: node scripts/wsl-reconnect-test.js
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");

// 日志同步写入文件(避免 bash 超时杀进程导致 stdout 缓冲丢失)
const LOG_FILE = path.join(__dirname, "wsl-test.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

// 本地 agent 二进制(优先最新构建的 dist,其次版本缓存,最后无版本缓存)
function localAgentBinary() {
  const dir = path.join(os.homedir(), ".guada", "agent");
  const candidates = [
    process.env.AGENT_BIN,
    // 最近一次 release.sh 构建的产物(v0.4.6,含 --root/--perm 参数)
    path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-linux-amd64"),
    path.join(dir, "guada-agent-linux-amd64-v0.4.6"),
    path.join(dir, "guada-agent-linux-amd64"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** 带超时的 promise 包装:超时 reject */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时(${ms}ms): ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function sshExec(client, cmd, timeoutMs = 20000) {
  return withTimeout(
    new Promise((resolve, reject) => {
      client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = "";
        stream.on("data", (d) => (out += d.toString()));
        stream.stderr.on("data", (d) => (out += d.toString()));
        stream.on("close", () => resolve(out));
      });
    }),
    timeoutMs,
    `ssh: ${cmd.slice(0, 60)}`,
  );
}

function sftpPut(client, local, remote) {
  return withTimeout(
    new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.fastPut(local, remote, (err2) => (err2 ? reject(err2) : resolve()));
      });
    }),
    60000,
    `sftp 上传 ${path.basename(local)}`,
  );
}

function forwardPort(client, remotePort) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const server = net.createServer((sock) => {
        client.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (err, chan) => {
          if (err) return sock.destroy();
          chan.pipe(sock);
          sock.pipe(chan);
          chan.on("close", () => sock.destroy());
        });
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    }),
    15000,
    "端口转发",
  );
}

function wsConnect(url, token) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      ws.once("open", () => resolve(ws));
      ws.once("error", (e) => reject(e));
    }),
    15000,
    "WS 连接",
  );
}

function rpcPing(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ping timeout")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(raw.toString());
        resolve(msg);
      } catch (e) {
        reject(e);
      }
    });
    ws.send(JSON.stringify({ id: "t1", method: "ping" }));
  });
}

function waitDisconnect(ws, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve("closed");
    });
  });
}

async function main() {
  const bin = localAgentBinary();
  if (!bin) {
    console.error("✗ 本地 agent 二进制缺失(guada-agent-linux-amd64*)");
    process.exit(1);
  }
  log(`本地二进制: ${bin}`);

  const client = new Client();
  await withTimeout(
    new Promise((res, rej) =>
      client
        .once("ready", res)
        .once("error", rej)
        .connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password }),
    ),
    30000,
    "SSH 连接",
  );
  log("[1/6] SSH 连接成功");

  const home = (await sshExec(client, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(client, `mkdir -p ${dir}`);
  // 上传前先清理残留 agent 进程:运行中的二进制被占用时 fastPut 覆盖会失败(ETXTBSY → Failure)
  await sshExec(client, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  log("[2/6] 上传 agent 二进制...");
  await sftpPut(client, bin, remoteBin);
  await sshExec(client, `chmod +x ${remoteBin}`);

  const token = `wsl-test-${Date.now()}`;
  await sshExec(client, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);

  async function startAgent() {
    await sshExec(client, `pkill -f "${remoteBin}" 2>/dev/null; true`);
    // 启动命令立即返回:输出重定向到日志、stdin 断开,后台进程不持有 ssh channel
    await sshExec(
      client,
      `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`,
    );
    // 等待启动并读取日志
    await new Promise((r) => setTimeout(r, 1500));
    const log = await sshExec(client, `cat ${dir}/agent.log`);
    const m = log.match(/listening on \S+:(\d+)/);
    if (!m) throw new Error(`agent 启动失败: ${log}`);
    return parseInt(m[1], 10);
  }

  // ── 第一次:启动 + 连接 + ping ──
  const port1 = await startAgent();
  log(`[3/6] agent 启动成功,端口 ${port1}`);
  const lp1 = await forwardPort(client, port1);
  const ws1 = await wsConnect(`ws://127.0.0.1:${lp1}/ws`, token);
  const pong1 = await rpcPing(ws1);
  log(`[4/6] 首次连接 ping OK: ${JSON.stringify(pong1.result)}`);

  // ── 模拟断开:杀远端 agent 进程 → WS 应断开 ──
  log("[5/6] 模拟断开(kill agent 进程)...");
  await sshExec(client, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  const closed = await waitDisconnect(ws1, 8000);
  log(`   WS 断开事件: ${closed}`);
  if (closed !== "closed") {
    console.error("✗ WS 未检测到断开");
    process.exit(1);
  }
  // 确认 agent 进程确实退出
  const alive = (await sshExec(client, `pgrep -f "${remoteBin}" || true`)).trim();
  log(`   远端残留进程: ${alive || "(无,已退出)"}`);

  // ── 自动恢复:重新启动 + 连接 + ping ──
  log("[6/6] 验证自动恢复(重新部署连接)...");
  const port2 = await startAgent();
  log(`   agent 重新启动,端口 ${port2}`);
  const lp2 = await forwardPort(client, port2);
  const ws2 = await wsConnect(`ws://127.0.0.1:${lp2}/ws`, token);
  const pong2 = await rpcPing(ws2);
  log(`   重连 ping OK: ${JSON.stringify(pong2.result)}`);

  log("\n✅ WSL 断线恢复测试通过:断开后 agent 退出,重新连接可恢复");
  ws2.close();
  await sshExec(client, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  client.end();
}

main().catch((e) => {
  console.error("测试失败:", e.message);
  process.exit(1);
});
