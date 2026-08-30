#!/usr/bin/env node
/**
 * Mac 实测用户报告"几乎必卡"的命令:
 *   sleep 120; echo "--- log ---"; tail -2 ~/models/pull_14b.log 2>/dev/null | tr '\r' '\n' | tail -2;
 *   echo "--- 已下载 ---"; du -sh ~/.ollama/models 2>/dev/null; ps -ef | grep -c "[o]llama pull"
 * 验证:
 *   1) agent 60s 超时转后台是否准时返回(timeout=60000)
 *   2) 转后台期间其他命令(ping)是否不阻塞
 *   3) 响应里是否有 logFile(可预测路径)
 * 用已安装的 agent 版本测试(不重新上传);凭据 ../.mac-test-config.json。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-cmd.log");
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
function sshExec(c, cmd, ms = 20000) {
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
function rpcRequest(ws, id, method, params, ms = 180000) {
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

const USER_CMD = 'sleep 120; echo "--- log ---"; tail -2 ~/models/pull_14b.log 2>/dev/null | tr \'\\r\' \'\\n\' | tail -2; echo "--- 已下载 ---"; du -sh ~/.ollama/models 2>/dev/null; ps -ef | grep -c "[o]llama pull"';

async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) =>
    c.once("ready", res).once("error", rej)
      .connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000, "SSH");
  log("[1] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  const ver = (await sshExec(c, `${remoteBin} --version 2>&1`)).trim();
  log(`[2] agent 版本=${ver}`);

  // 启动 agent(清理同路径残留是必要的,避免旧实例干扰;不杀其他场景)
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  const token = `cmd-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[3] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  // 执行用户命令(timeout=60000)
  log(`[4] 执行用户命令(timeout=60000): ${USER_CMD.slice(0, 60)}...`);
  log("    期望: ~60s 转后台返回 backgrounded + logFile;若 >60s 未返回 = 卡住");
  const t0 = Date.now();
  const r = await rpcRequest(ws, "CMD", "execute", {
    command: USER_CMD,
    cwd: cfg.workdir,
    timeout: 60000,
    background: false,
  });
  const rt = Date.now() - t0;
  log(`[5] 响应: round-trip=${rt}ms kind=${r.result.kind} uptime=${r.result.uptimeMs}ms logFile=${r.result.logFile || "(无)"}`);
  const expected = r.result.kind === "backgrounded" && rt < 70000;
  log(expected ? "    ✅ 60s 准时转后台,命令不卡住" : `    ❌ 未按预期返回(${(rt / 1000).toFixed(1)}s,kind=${r.result.kind})`);

  // 转后台期间 ping 不阻塞
  const t1 = Date.now();
  const ping = await rpcRequest(ws, "PING", "ping", {}, 10000);
  const pingRt = Date.now() - t1;
  log(`[6] 转后台后 ping: ${pingRt}ms ${pingRt < 3000 ? "✅ 不阻塞" : "❌ 被阻塞"}`);

  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 120" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`测试失败: ${e.message}`); process.exit(1); });
