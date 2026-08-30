#!/usr/bin/env node
/**
 * WSL 复现测试:定位命令响应延迟发生层
 * 对比:命令实际耗时(uptime)vs 客户端收到响应耗时(round-trip)
 * 若 uptime 小但 round-trip 大 → 响应传输/写入延迟;两者接近 → 正常
 * 场景:单命令 / 并发 5 命令 / 大输出(10MB) / 20s 长命令
 * 凭据从 ../.wsl-test-config.json 读取(不入库)。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");
const LOG = path.join(__dirname, "wsl-repro.log");
fs.writeFileSync(LOG, "");
function log(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function withTimeout(p, ms, label) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`超时(${ms}ms): ${label}`)), ms);
    p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e)));
  });
}
function sshExec(c, cmd, ms = 30000) {
  return withTimeout(new Promise((res, rej) => {
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let o = "";
      s.on("data", (d) => (o += d.toString()));
      s.stderr.on("data", (d) => (o += d.toString()));
      s.on("close", () => res(o));
    });
  }), ms, `ssh:${cmd.slice(0, 40)}`);
}
function sftpPut(c, local, remote) {
  return withTimeout(new Promise((res, rej) => {
    c.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.fastPut(local, remote, (e2) => (e2 ? rej(e2) : res()));
    });
  }), 120000, "sftp");
}
function forwardPort(c, remotePort) {
  return withTimeout(new Promise((res, rej) => {
    const srv = net.createServer((sock) => {
      c.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (e, chan) => {
        if (e) return sock.destroy();
        chan.pipe(sock); sock.pipe(chan);
        chan.on("close", () => sock.destroy());
      });
    });
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => res(srv.address().port));
  }), 15000, "转发");
}
function wsConnect(url, token) {
  return withTimeout(new Promise((res, rej) => {
    const ws = new WebSocket(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    ws.once("open", () => res(ws));
    ws.once("error", (e) => rej(e));
  }), 15000, "WS");
}
function rpcRequest(ws, id, method, params, ms = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC 超时: ${method}`)), ms);
    const onMsg = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          ws.off("message", onMsg);
          msg.error ? reject(new Error(msg.error)) : resolve(msg);
        }
      } catch {}
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-linux-amd64");
  if (!fs.existsSync(distBin)) { log("✗ dist 缺失"); process.exit(1); }

  const c = new Client();
  await withTimeout(new Promise((res, rej) =>
    c.once("ready", res).once("error", rej)
      .connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000, "SSH");
  log("[1/4] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(c, `mkdir -p ${dir}; pkill -f "${remoteBin}" 2>/dev/null; true`);
  await sftpPut(c, distBin, remoteBin);
  await sshExec(c, `chmod +x ${remoteBin}`);
  const token = `repro-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 1500));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[2/4] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);
  log("[3/4] 开始延迟测量(round-trip = 客户端发送到收到响应;uptime = 命令实际耗时)");

  // 场景 A:单命令 2s
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "A", "execute", { command: "sleep 2; echo hi", cwd: dir, timeout: 60000, background: false }, 30000);
    const rt = Date.now() - t0;
    const up = r.result.uptimeMs;
    log(`场景A 单命令2s:   round-trip=${rt}ms  uptime=${up}ms  传输差=${rt - up}ms  kind=${r.result.kind} ${rt - up > 5000 ? "❌响应延迟!" : "✅"}`);
  }

  // 场景 B:并发 5 个命令
  {
    const t0 = Date.now();
    const results = await Promise.all([
      rpcRequest(ws, "B1", "execute", { command: "sleep 1; echo b1", cwd: dir, timeout: 60000, background: false }, 60000),
      rpcRequest(ws, "B2", "execute", { command: "sleep 2; echo b2", cwd: dir, timeout: 60000, background: false }, 60000),
      rpcRequest(ws, "B3", "execute", { command: "sleep 1; echo b3", cwd: dir, timeout: 60000, background: false }, 60000),
      rpcRequest(ws, "B4", "execute", { command: "sleep 2; echo b4", cwd: dir, timeout: 60000, background: false }, 60000),
      rpcRequest(ws, "B5", "execute", { command: "sleep 1; echo b5", cwd: dir, timeout: 60000, background: false }, 60000),
    ]);
    const rt = Date.now() - t0;
    const maxUp = Math.max(...results.map((r) => r.result.uptimeMs));
    log(`场景B 并发5命令:  round-trip=${rt}ms  最大uptime=${maxUp}ms  传输差=${rt - maxUp}ms ${rt - maxUp > 5000 ? "❌响应延迟!" : "✅"}`);
  }

  // 场景 C:大输出(10MB)
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "C", "execute", { command: "head -c 10485760 /dev/zero | tr '\\0' 'x'; echo DONE", cwd: dir, timeout: 60000, background: false }, 60000);
    const rt = Date.now() - t0;
    const up = r.result.uptimeMs;
    const outLen = (r.result.output || "").length;
    log(`场景C 大输出10MB:  round-trip=${rt}ms  uptime=${up}ms  输出长度=${outLen}  传输差=${rt - up}ms ${rt - up > 10000 ? "❌大输出响应延迟!" : "✅"}`);
  }

  // 场景 D:20s 长命令(模拟用户场景)
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "D", "execute", { command: "sleep 20; echo done", cwd: dir, timeout: 60000, background: false }, 120000);
    const rt = Date.now() - t0;
    const up = r.result.uptimeMs;
    log(`场景D 20s长命令:   round-trip=${rt}ms  uptime=${up}ms  传输差=${rt - up}ms ${rt - up > 5000 ? "❌响应延迟!" : "✅"}`);
  }

  log("[4/4] 测量完成");
  log("\n结论: 若各场景 传输差 均为小值(ms级) → agent 响应链路正常,20分钟延迟不在 agent 端;若某场景 传输差 巨大 → 该场景是延迟源(需进一步排查)");
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`测试失败: ${e.message}`); process.exit(1); });
