#!/usr/bin/env node
/**
 * Mac 验证修复:上传 dist(darwin,含 writeTimeout)后执行用户命令,
 * 测量 execute 响应滞留时间(修复前 ~22s;修复后应显著降低/消除)
 * 凭据 ../.mac-test-config.json。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-verify.log");
fs.writeFileSync(LOG, "");
function log(m) { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); }
function withTimeout(p, ms, label) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`超时:${label}`)), ms); p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e))); }); }
function sshExec(c, cmd, ms = 20000) { return withTimeout(new Promise((res, rej) => { c.exec(cmd, (e, s) => { if (e) return rej(e); let o = ""; s.on("data", (d) => (o += d.toString())); s.stderr.on("data", (d) => (o += d.toString())); s.on("close", () => res(o)); }); }), ms); }
function forwardPort(c, rp) { return withTimeout(new Promise((res, rej) => { const srv = net.createServer((sock) => { c.forwardOut("127.0.0.1", 0, "127.0.0.1", rp, (e, chan) => { if (e) return sock.destroy(); chan.pipe(sock); sock.pipe(chan); chan.on("close", () => sock.destroy()); }); }); srv.on("error", rej); srv.listen(0, "127.0.0.1", () => res(srv.address().port)); }), 15000); }
function wsConnect(url, token) { return withTimeout(new Promise((res, rej) => { const ws = new WebSocket(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }); ws.once("open", () => res(ws)); ws.once("error", (e) => rej(e)); }), 15000); }
function rpcRequest(ws, id, method, params, ms = 120000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`超时:${method}`)), ms); const onMsg = (raw) => { try { const msg = JSON.parse(raw.toString()); if (msg.id === id) { clearTimeout(timer); ws.off("message", onMsg); msg.error ? reject(new Error(msg.error)) : resolve(msg); } } catch {} }; ws.on("message", onMsg); ws.send(JSON.stringify({ id, method, params })); }); }

const USER_CMD = 'sleep 120; echo "--- log ---"; tail -2 ~/models/pull_14b.log 2>/dev/null | tr \'\\r\' \'\\n\' | tail -2; echo "--- 已下载 ---"; du -sh ~/.ollama/models 2>/dev/null; ps -ef | grep -c "[o]llama pull"';

async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) => c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000);
  log("[1] SSH OK");
  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;

  // 上传 dist(含 writeTimeout 修复)
  const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-darwin-amd64");
  if (!fs.existsSync(distBin)) { log("✗ dist darwin 缺失"); process.exit(1); }
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  const sftp = await withTimeout(new Promise((res, rej) => c.sftp((e, s) => (e ? rej(e) : res(s)))), 30000, "sftp");
  await withTimeout(new Promise((res, rej) => sftp.fastPut(distBin, remoteBin, (e) => (e ? rej(e) : res()))), 120000, "上传");
  await sshExec(c, `chmod +x ${remoteBin}`);
  log(`[2] 已上传: ${(await sshExec(c, `${remoteBin} --version 2>&1`)).trim()}`);

  const token = `vf-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token-vf && chmod 600 ${dir}/.token-vf`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token-vf --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent-vf.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const sl = await sshExec(c, `cat ${dir}/agent-vf.log`);
  const m = sl.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error("启动失败: " + sl);
  const port = parseInt(m[1], 10);
  log(`[3] agent 启动端口=${port}`);
  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  log("[4] 执行用户命令(timeout=60000),测量响应滞留");
  const t0 = Date.now();
  const r = await rpcRequest(ws, "EX", "execute", { command: USER_CMD, cwd: cfg.workdir, timeout: 60000, background: false }, 120000);
  const rt = Date.now() - t0;
  const delay = rt - (r.result.uptimeMs || 0);
  log(`[5] round-trip=${rt}ms kind=${r.result.kind} uptime=${r.result.uptimeMs}ms → 响应滞留=${delay}ms`);
  log(delay < 15000 ? "    ✅ 滞留显著降低(修复生效)" : `    ❌ 仍有滞留 ${delay}ms`);

  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 120" 2>/dev/null; true`);
  c.end();
}
main().catch((e) => { log(`失败: ${e.message}`); process.exit(1); });
