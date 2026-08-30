#!/usr/bin/env node
/**
 * WSL 实测:后台进程输出写入远端临时文件 + 不阻塞后续命令
 *   场景1: background=true → 立即返回 logFile,输出落盘,AI 可读
 *   场景2: 前台超时 → 转后台(进程不杀),输出继续落盘
 *   场景3: 后台期间 ping 立即响应(不阻塞)
 * 凭据从 ../.wsl-test-config.json 读取(不入库)。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");
const LOG = path.join(__dirname, "wsl-bglog.log");
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
    120000,
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

function rpcRequest(ws, id, method, params, ms = 30000) {
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
  if (!fs.existsSync(distBin)) {
    log("✗ dist 二进制缺失");
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
  log("[1/6] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(c, `mkdir -p ${dir}`);
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  await sftpPut(c, distBin, remoteBin);
  await sshExec(c, `chmod +x ${remoteBin}`);
  const token = `bglog-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);

  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 1500));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[2/6] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  // ── 场景1:background=true 立即返回 + 输出落盘 ──
  log("[3/6] 场景1: background=true,命令循环输出 5 行...");
  const t0 = Date.now();
  const bg = await rpcRequest(ws, "bg-1", "execute", {
    command: "for i in 1 2 3 4 5; do echo line$i; sleep 0.5; done",
    cwd: dir, timeout: 60000, background: true,
  });
  const bgLatency = Date.now() - t0;
  const bgResult = bg.result;
  log(`   background 返回: kind=${bgResult.kind}, processId=${bgResult.processId}, 耗时=${bgLatency}ms`);
  log(`   logFile: ${bgResult.logFile}`);
  if (bgResult.kind !== "backgrounded" || !bgResult.logFile) {
    log("✗ 未返回 backgrounded/logFile");
    process.exit(1);
  }
  if (bgLatency > 3000) {
    log("✗ background 返回被阻塞(>3s)");
    process.exit(1);
  }
  log("   ✅ background 立即返回(不阻塞),logFile 已给出");

  // ── 场景2:后台期间 ping 立即响应(不阻塞后续命令) ──
  log("[4/6] 场景2: 后台运行期间发 ping(验证不阻塞)...");
  const t1 = Date.now();
  const ping = await rpcRequest(ws, "bg-ping", "ping", {});
  const pingLatency = Date.now() - t1;
  log(`   ping 响应: ${JSON.stringify(ping.result)}, 耗时=${pingLatency}ms`);
  if (pingLatency > 3000) {
    log("✗ ping 被后台命令阻塞");
    process.exit(1);
  }
  log("   ✅ ping 立即响应,后续命令不受阻塞");

  // ── 场景3:日志文件可读(中途 + 完成后) ──
  log("[5/6] 场景3: 读日志文件...");
  await new Promise((r) => setTimeout(r, 1200)); // 等 2 行左右
  const mid = (await sshExec(c, `cat ${bgResult.logFile}`)).trim();
  log(`   中途日志(${mid.split("\n").length} 行): ${mid.replace(/\n/g, " | ")}`);
  await new Promise((r) => setTimeout(r, 2500)); // 等完成(5 行 × 0.5s)
  const full = (await sshExec(c, `cat ${bgResult.logFile}`)).trim();
  const lineCount = full.split("\n").length;
  log(`   完成日志(${lineCount} 行): ${full.replace(/\n/g, " | ")}`);
  if (lineCount !== 5) {
    log(`✗ 日志行数异常: ${lineCount}/5`);
    process.exit(1);
  }
  log("   ✅ 日志完整落盘(5 行),AI 可用 remote_read 读取");

  // ── 场景4:前台超时转后台,进程不杀 + 输出继续落盘 ──
  log("[6/6] 场景4: 前台超时(2s)转后台,进程不杀...");
  const tm = await rpcRequest(ws, "bg-2", "execute", {
    command: "echo start; sleep 5; echo done",
    cwd: dir, timeout: 2000, background: false,
  }, 15000);
  const tmResult = tm.result;
  log(`   超时返回: kind=${tmResult.kind}, processId=${tmResult.processId}, logFile=${tmResult.logFile}`);
  if (tmResult.kind !== "backgrounded" || !tmResult.logFile) {
    log("✗ 超时未转后台");
    process.exit(1);
  }
  // 确认进程还在运行 + 日志可追加
  const alive = (await sshExec(c, `pgrep -f "sleep 5" || true`)).trim();
  log(`   进程存活: ${alive || "(无)"}`);
  await new Promise((r) => setTimeout(r, 4500)); // 等 sleep 5 结束
  const tmLog = (await sshExec(c, `cat ${tmResult.logFile}`)).trim();
  log(`   转后台后日志: ${tmLog.replace(/\n/g, " | ")}`);
  if (!tmLog.includes("done")) {
    log("✗ 超时转后台后输出未继续落盘");
    process.exit(1);
  }
  log("   ✅ 超时转后台:进程不杀,输出继续落盘,不阻塞");

  log("\n✅ 全部场景通过:后台输出落盘 + 可读 + 不阻塞后续命令");
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  c.end();
}

main().catch((e) => {
  log(`测试失败: ${e.message}`);
  process.exit(1);
});
