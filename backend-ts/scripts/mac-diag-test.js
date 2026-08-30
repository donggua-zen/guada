#!/usr/bin/env node
/**
 * Mac 诊断:timeout=10s + sleep 30 后,检查
 *  1) sleep 30 进程是否存活(转后台是否执行:存活=转了,消失=没转/被杀)
 *  2) 日志文件是否创建(mac 的 os.TempDir = $TMPDIR,非 /tmp)
 *  3) 响应是否到达(轮询等待)
 * 凭据从 ../.mac-test-config.json 读取。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-diag.log");
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
  const tmpDir = (await sshExec(c, "echo $TMPDIR")).trim();
  log(`[2] agent 版本=${ver}  TMPDIR=${tmpDir}`);

  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 30" 2>/dev/null; true`);
  const token = `diag-${Date.now()}`;
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

  // 发 execute(timeout=10s, sleep 30),异步等待响应
  log("[4] 发送 execute: timeout=10000 + 'sleep 30; echo done'");
  const t0 = Date.now();
  let resp = null;
  const respPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("响应等待超时(90s)")), 90000);
    const onMsg = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === "DIAG") {
          clearTimeout(timer);
          ws.off("message", onMsg);
          msg.error ? reject(new Error(msg.error)) : resolve(msg);
        }
      } catch {}
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id: "DIAG", method: "execute", params: { command: "sleep 30; echo done", cwd: cfg.workdir, timeout: 10000, background: false } }));
  });

  // 12s 后(应已转后台)检查进程与日志
  await new Promise((r) => setTimeout(r, 12000));
  const elapsed12 = Date.now() - t0;
  const procState = (await sshExec(c, `ps aux | grep -E "sleep 30" | grep -v grep || echo "无 sleep 30 进程"`)).trim();
  const logDirMac = `${tmpDir}guada-logs`;
  const logFiles = (await sshExec(c, `ls -la ${logDirMac} 2>&1 | tail -5; ls -la /tmp/guada-logs 2>&1 | tail -3`)).trim();
  const agentLog = (await sshExec(c, `tail -20 ${dir}/agent.log`)).trim();
  log(`[5] 12s 后(${elapsed12}ms):`);
  log(`    进程状态: ${procState.replace(/\n/g, " | ")}`);
  log(`    日志目录: ${logFiles.replace(/\n/g, " | ")}`);
  log(`    agent.log 尾部: ${agentLog.replace(/\n/g, " | ")}`);

  // 判断转后台是否执行
  if (procState.includes("sleep 30")) {
    log("    → sleep 30 进程存活 = 转后台逻辑执行了,但响应可能未发出(WriteMessage 阻塞?)");
  } else {
    log("    → sleep 30 进程不存在 = 转后台未执行 或 进程被杀");
  }

  // 继续等响应
  try {
    resp = await withTimeout(respPromise, 90000, "execute 响应");
    const rt = Date.now() - t0;
    log(`[6] 响应到达: ${JSON.stringify(resp.result)} round-trip=${rt}ms`);
    log(rt < 15000 ? "    ✅ 正常返回" : `    ❌ 延迟 ${(rt / 1000).toFixed(1)}s`);
  } catch (e) {
    log(`[6] 响应未到达(90s 等待超时): ${e.message}`);
  }

  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 30" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`诊断失败: ${e.message}`); process.exit(1); });
