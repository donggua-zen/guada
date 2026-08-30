#!/usr/bin/env node
/**
 * 转后台时效性实测:
 * execute timeout=10s + 30s 任务(sleep 30; echo done)
 * 若 ~10s 返回 backgrounded → 转后台正常;
 * 若 ~30s 返回(等命令完成)→ 转后台失效(根因);
 * 若 >30s → 更严重。
 * 凭据从 ../.wsl-test-config.json 读取。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");
const LOG = path.join(__dirname, "wsl-timeout.log");
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
  log("[1/3] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(c, `mkdir -p ${dir}; pkill -f "${remoteBin}" 2>/dev/null; true`);
  await sftpPut(c, distBin, remoteBin);
  await sshExec(c, `chmod +x ${remoteBin}`);
  const token = `to-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 1500));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[2/3] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  log("[3/3] 执行: timeout=10000ms + 命令 'sleep 30; echo done'(30s 任务)");
  log("      期望: ~10s 返回 backgrounded;若 ~30s 返回 = 转后台失效");
  const t0 = Date.now();
  const r = await rpcRequest(ws, "T", "execute", {
    command: "sleep 30; echo done",
    cwd: dir,
    timeout: 10000,
    background: false,
  }, 60000);
  const rt = Date.now() - t0;
  const up = r.result.uptimeMs;
  const kind = r.result.kind;
  const logFile = r.result.logFile;
  log(`实测: round-trip=${rt}ms  kind=${kind}  uptime=${up}ms  logFile=${logFile || "(无)"}`);
  if (kind === "backgrounded" && rt < 15000) {
    log("✅ 转后台正常: 10s 超时准时返回 backgrounded");
  } else {
    log(`❌ 转后台失效: 期望 ~10s 返回 backgrounded,实际 ${(rt / 1000).toFixed(1)}s 返回 ${kind}`);
  }
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 30" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`测试失败: ${e.message}`); process.exit(1); });
