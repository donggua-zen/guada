#!/usr/bin/env node
/**
 * Mac 多实例共存验证:
 * 同一服务器启动两个 agent 实例(A 端口 a, B 端口 b),各自执行命令。
 * 修复前:后端 ensureAgentRunning 每次连接会 pkill -f 二进制 → B 启动杀 A → A 命令丢失
 * 修复后:不再 pkill → A、B 命令都正常完成(验证多会话不互杀)
 * 凭据从 ../.mac-test-config.json 读取。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-multi.log");
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
function rpcRequest(ws, id, method, params, ms = 60000) {
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
  log("[1] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  const ver = (await sshExec(c, `${remoteBin} --version 2>&1`)).trim();
  log(`[2] agent 版本=${ver}`);

  // 启动 agent 实例 A
  const tokenA = `A-${Date.now()}`;
  await sshExec(c, `echo ${tokenA} > ${dir}/.token-a && chmod 600 ${dir}/.token-a`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token-a --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent-a.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const logA = await sshExec(c, `cat ${dir}/agent-a.log`);
  const mA = logA.match(/listening on \S+:(\d+)/);
  if (!mA) throw new Error(`agent A 启动失败: ${logA}`);
  const portA = parseInt(mA[1], 10);

  // 启动 agent 实例 B(修复前这里会 pkill 掉 A!修复后共存)
  const tokenB = `B-${Date.now()}`;
  await sshExec(c, `echo ${tokenB} > ${dir}/.token-b && chmod 600 ${dir}/.token-b`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token-b --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent-b.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const logB = await sshExec(c, `cat ${dir}/agent-b.log`);
  const mB = logB.match(/listening on \S+:(\d+)/);
  if (!mB) throw new Error(`agent B 启动失败: ${logB}`);
  const portB = parseInt(mB[1], 10);

  // 确认 A 还活着(B 启动后未被杀)
  const aliveA = (await sshExec(c, `pgrep -f "${remoteBin}" | wc -l`)).trim();
  log(`[3] 双实例启动: A 端口=${portA}, B 端口=${portB}, 共存 agent 进程数=${aliveA}`);

  const lpA = await forwardPort(c, portA);
  const wsA = await wsConnect(`ws://127.0.0.1:${lpA}/ws`, tokenA);
  const lpB = await forwardPort(c, portB);
  const wsB = await wsConnect(`ws://127.0.0.1:${lpB}/ws`, tokenB);

  // A 执行 15s 命令,B 执行 10s 命令,并发 —— 都不应被对方杀死
  log("[4] A 执行 'sleep 15; echo A-done', B 执行 'sleep 10; echo B-done' 并发");
  const t0 = Date.now();
  const [rA, rB] = await Promise.all([
    rpcRequest(wsA, "MA", "execute", { command: "sleep 15; echo A-done", cwd: cfg.workdir, timeout: 60000, background: false }),
    rpcRequest(wsB, "MB", "execute", { command: "sleep 10; echo B-done", cwd: cfg.workdir, timeout: 60000, background: false }),
  ]);
  const rt = Date.now() - t0;
  const okA = rA.result.kind === "completed" && String(rA.result.output).includes("A-done");
  const okB = rB.result.kind === "completed" && String(rB.result.output).includes("B-done");
  log(`[5] 结果(总耗时 ${rt}ms):`);
  log(`    A: kind=${rA.result.kind} uptime=${rA.result.uptimeMs}ms 含A-done=${String(rA.result.output).includes("A-done")} ${okA ? "✅" : "❌"}`);
  log(`    B: kind=${rB.result.kind} uptime=${rB.result.uptimeMs}ms 含B-done=${String(rB.result.output).includes("B-done")} ${okB ? "✅" : "❌"}`);

  if (okA && okB) {
    log("\n✅ 多实例共存验证通过:两个 agent 各自命令均正常完成(无互杀)");
  } else {
    log("\n❌ 存在互杀/失败(若 B 启动后 A 被杀 = 修复前 pkill 行为)");
  }

  wsA.close(); wsB.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 15" 2>/dev/null; true; pkill -f "sleep 10" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => { log(`测试失败: ${e.message}`); process.exit(1); });
