#!/usr/bin/env node
/**
 * WSL 真实环境验证:execute fork 子进程的命令 → cancel → 无残余进程
 *
 * 场景: 前台执行 "sleep 60 & sleep 60"(fork 两个子进程)
 *       执行中发 cancel RPC → agent 杀进程组 → pgrep 验证无残余
 * 凭据从 ../.wsl-test-config.json 读取(不入库)。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");

const LOG = path.join(__dirname, "wsl-cancel.log");
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
  return withTimeout(
    new Promise((res, rej) => {
      c.exec(cmd, (e, s) => {
        if (e) return rej(e);
        let o = "";
        s.on("data", (d) => (o += d.toString()));
        s.stderr.on("data", (d) => (o += d.toString()));
        s.on("close", () => res(o));
      });
    }),
    ms,
    `ssh:${cmd.slice(0, 50)}`,
  );
}

function sftpPut(c, local, remote) {
  return withTimeout(
    new Promise((res, rej) => {
      c.sftp((e, sftp) => {
        if (e) return rej(e);
        sftp.fastPut(local, remote, (e2) => (e2 ? rej(e2) : res()));
      });
    }),
    60000,
    "sftp",
  );
}

function forwardPort(c, remotePort) {
  return withTimeout(
    new Promise((res, rej) => {
      const srv = net.createServer((sock) => {
        c.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (e, chan) => {
          if (e) return sock.destroy();
          chan.pipe(sock);
          sock.pipe(chan);
          chan.on("close", () => sock.destroy());
        });
      });
      srv.on("error", rej);
      srv.listen(0, "127.0.0.1", () => res(srv.address().port));
    }),
    15000,
    "端口转发",
  );
}

function wsConnect(url, token) {
  return withTimeout(
    new Promise((res, rej) => {
      const ws = new WebSocket(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      ws.once("open", () => res(ws));
      ws.once("error", (e) => rej(e));
    }),
    15000,
    "WS 连接",
  );
}

/** 发送一个 RPC 请求并等待匹配 id 的响应 */
function rpcRequest(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC 超时: ${method}`)), 15000);
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
  if (!fs.existsSync(distBin)) {
    log("✗ dist 二进制缺失,先运行 release.sh 构建");
    process.exit(1);
  }

  const c = new Client();
  await withTimeout(
    new Promise((res, rej) =>
      c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password }),
    ),
    30000,
    "SSH 连接",
  );
  log("[1/5] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(c, `mkdir -p ${dir}`);
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  await sftpPut(c, distBin, remoteBin);
  await sshExec(c, `chmod +x ${remoteBin}`);
  const token = `cancel-test-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);
  log("[2/5] agent 二进制就绪");

  // 启动 agent
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 1500));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[3/5] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  // 记录环境已有 sleep 进程 pid(启动前),用于区分本次 fork 的子进程
  const envSleepPids = (await sshExec(c, "pgrep -f 'sleep 6[01]' || true"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((p) => p.trim());

  // 发前台 execute:fork 两个子进程(sleep 60 & sleep 60)
  log("[4/5] 发送前台 execute(sleep 60 & sleep 60),1.5s 后发 cancel...");
  const execPromise = rpcRequest(ws, "exec-1", "execute", {
    command: "sleep 60 & sleep 60",
    cwd: dir,
    timeout: 60000,
    background: false,
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 记录环境已有 pid 与我们 fork 出的 pid(避免环境中的同名进程干扰判断)
  const allPids = (await sshExec(c, "pgrep -f 'sleep 6[01]' || true"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((p) => p.trim());
  // fork 出的 = 当前所有 - 启动前就存在的
  const envPids = envSleepPids || [];
  const ourPids = allPids.filter((p) => !envPids.includes(p));
  log(`   cancel 前: 环境既有=${envPids.length}, 本次 fork=${ourPids.join(",") || "(无)"}`);

  // 发 cancel
  const cancelResp = await rpcRequest(ws, "cancel-1", "cancel", { requestId: "exec-1" });
  log(`   cancel 响应: ${JSON.stringify(cancelResp.result)}`);

  // execute 应返回(被终止)
  const execResp = await withTimeout(execPromise, 10000, "execute 返回");
  log(`   execute 返回: kind=${execResp.result && execResp.result.kind}`);

  // 等 SIGKILL 兜底后检查:本次 fork 的 pid 是否全部消失
  await new Promise((r) => setTimeout(r, 3500));
  const afterAll = (await sshExec(c, "pgrep -f 'sleep 6[01]' || true"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((p) => p.trim());
  const stillAlive = ourPids.filter((p) => afterAll.includes(p));
  log(`[5/5] cancel 后: 本次 fork 残余=${stillAlive.join(",") || "(无)"}`);

  if (ourPids.length === 0) {
    log("⚠️ 未能确认 fork 子进程,验证不充分");
  }
  if (stillAlive.length > 0) {
    log(`✗ fork 子进程残留: ${stillAlive.join(",")}`);
    process.exit(1);
  }
  log("✅ fork 子进程 cancel 后无残余,验证通过");

  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => {
  log(`测试失败: ${e.message}`);
  process.exit(1);
});
