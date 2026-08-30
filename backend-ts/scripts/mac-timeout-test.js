#!/usr/bin/env node
/**
 * Mac 实测(192.168.3.159):用已安装的 agent 版本复现"命令卡住不返回"问题
 * 场景:
 *   A. timeout=10s + 30s 任务 → 期望 ~10s 返回 backgrounded(转后台时效性)
 *   B. 用户报告场景: sleep 60; echo ...; curl -m 15 | python ...(30s+ 命令)
 *   C. 大输出 10MB 命令(写响应是否阻塞)
 * 凭据从 ../.mac-test-config.json 读取;使用远端已安装的 agent,不重新上传。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-timeout.log");
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
function rpcRequest(ws, id, method, params, ms = 300000) {
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
  const c = new Client();
  await withTimeout(new Promise((res, rej) =>
    c.once("ready", res).once("error", rej)
      .connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000, "SSH");
  log("[1/4] SSH 连接成功");

  // 查找已安装的 agent;UPLOAD_DIST=1 时上传本地 dist 对比测试
  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  if (process.env.UPLOAD_DIST === "1") {
    const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-darwin-amd64");
    if (!fs.existsSync(distBin)) { log(`✗ 本地 dist darwin 缺失: ${distBin}`); process.exit(1); }
    await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
    const sftp = await withTimeout(new Promise((res, rej) => c.sftp((e, s) => (e ? rej(e) : res(s)))), 30000, "sftp");
    await withTimeout(new Promise((res, rej) => sftp.fastPut(distBin, remoteBin, (e) => (e ? rej(e) : res()))), 120000, "sftp上传");
    await sshExec(c, `chmod +x ${remoteBin}`);
    log("[2/4] 已上传 dist(darwin)覆盖安装版本");
  }
  const binInfo = await sshExec(c, `ls -la ${remoteBin} 2>&1; ${remoteBin} --version 2>&1 || true`);
  log(`[2/4] 当前 agent: ${binInfo.replace(/\n/g, " | ")}`);

  // 用安装的版本启动
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  const token = `mac-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[3/4] agent 启动,端口 ${port} (已安装版本,工作目录 ${cfg.workdir})`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  // 场景 A:timeout=10s + 30s 任务
  log("场景A: timeout=10000 + 'sleep 30; echo done'(30s)→ 期望 ~10s 返回 backgrounded");
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "A", "execute", { command: "sleep 30; echo done", cwd: cfg.workdir, timeout: 10000, background: false }, 60000);
    const rt = Date.now() - t0;
    log(`  round-trip=${rt}ms kind=${r.result.kind} uptime=${r.result.uptimeMs}ms logFile=${r.result.logFile || "(无)"}`);
    log(rt < 15000 && r.result.kind === "backgrounded" ? "  ✅ 转后台准时" : `  ❌ 转后台失效(${(rt / 1000).toFixed(1)}s)`);
  }

  // 场景 B:用户报告的命令(30s+ 任务)
  log("场景B: timeout=60000 + 'sleep 20; echo done'(20s)→ 期望 ~20s 返回 completed");
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "B", "execute", { command: "sleep 20; echo done", cwd: cfg.workdir, timeout: 60000, background: false }, 90000);
    const rt = Date.now() - t0;
    log(`  round-trip=${rt}ms kind=${r.result.kind} uptime=${r.result.uptimeMs}ms`);
    const diff = rt - (r.result.uptimeMs || 0);
    log(diff < 5000 ? `  ✅ 传输差 ${diff}ms` : `  ❌ 响应延迟 ${diff}ms`);
  }

  // 场景 C:大输出 10MB
  log("场景C: 大输出 10MB 命令 → 响应写是否阻塞");
  {
    const t0 = Date.now();
    const r = await rpcRequest(ws, "C", "execute", { command: "head -c 10485760 /dev/zero | tr '\\0' 'x'; echo DONE", cwd: cfg.workdir, timeout: 60000, background: false }, 60000);
    const rt = Date.now() - t0;
    const up = r.result.uptimeMs;
    const outLen = (r.result.output || "").length;
    log(`  round-trip=${rt}ms uptime=${up}ms 输出=${outLen} 传输差=${rt - up}ms ${rt - up > 10000 ? "❌大输出响应延迟" : "✅"}`);
  }

  log("[4/4] 实测完成");
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 30" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`测试失败: ${e.message}`); process.exit(1); });
