// 增强诊断:execute(timeout=60000) 发出后,65s/70s 发 ping,观察:
//  1) execute 响应是否到达 2) 连接是否通(响应滞留点)
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");
const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-ping.log");
fs.writeFileSync(LOG, "");
function log(m) { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); }
function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e))); }); }
function sshExec(c, cmd, ms = 20000) { return withTimeout(new Promise((res, rej) => { c.exec(cmd, (e, s) => { if (e) return rej(e); let o = ""; s.on("data", (d) => (o += d.toString())); s.stderr.on("data", (d) => (o += d.toString())); s.on("close", () => res(o)); }); }), ms); }
function forwardPort(c, rp) { return withTimeout(new Promise((res, rej) => { const srv = net.createServer((sock) => { c.forwardOut("127.0.0.1", 0, "127.0.0.1", rp, (e, chan) => { if (e) return sock.destroy(); chan.pipe(sock); sock.pipe(chan); chan.on("close", () => sock.destroy()); }); }); srv.on("error", rej); srv.listen(0, "127.0.0.1", () => res(srv.address().port)); }), 15000); }
function wsConnect(url, token) { return withTimeout(new Promise((res, rej) => { const ws = new WebSocket(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }); ws.once("open", () => res(ws)); ws.once("error", (e) => rej(e)); }), 15000); }
function rpcRequest(ws, id, method, params, ms = 120000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`超时:${method}`)), ms); const onMsg = (raw) => { try { const msg = JSON.parse(raw.toString()); if (msg.id === id) { clearTimeout(timer); ws.off("message", onMsg); msg.error ? reject(new Error(msg.error)) : resolve(msg); } } catch {} }; ws.on("message", onMsg); ws.send(JSON.stringify({ id, method, params })); }); }
const USER_CMD = 'sleep 120; echo "--- log ---"; tail -2 ~/models/pull_14b.log 2>/dev/null | tr \'\r\' \'\n\' | tail -2; echo "--- 已下载 ---"; du -sh ~/.ollama/models 2>/dev/null; ps -ef | grep -c "[o]llama pull"';
async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) => c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000);
  log("[1] SSH OK");
  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  const token = `pg-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token-pg && chmod 600 ${dir}/.token-pg`);
  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token-pg --root "${cfg.workdir}" --perm unrestricted > ${dir}/agent-pg.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 2000));
  const sl = await sshExec(c, `cat ${dir}/agent-pg.log`);
  const m = sl.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error("启动失败: " + sl);
  const port = parseInt(m[1], 10);
  log(`[2] agent 启动端口=${port}`);
  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);
  log("[3] 发 execute(timeout=60000),然后 65s/70s/75s 发 ping 观察连接与响应");
  const t0 = Date.now();
  const execPromise = rpcRequest(ws, "EX", "execute", { command: USER_CMD, cwd: cfg.workdir, timeout: 60000, background: false }, 120000);
  for (const delay of [65000, 70000, 75000]) {
    await new Promise((r) => setTimeout(r, delay - (Date.now() - t0)));
    const tp = Date.now();
    try {
      const p = await rpcRequest(ws, `P${delay}`, "ping", {}, 8000);
      log(`[${Date.now() - t0}ms] ping @${delay}ms: OK ${Date.now() - tp}ms`);
    } catch (e) {
      log(`[${Date.now() - t0}ms] ping @${delay}ms: ❌ ${e.message}`);
    }
  }
  try {
    const r = await withTimeout(execPromise, 15000, "exec");
    log(`[5] execute 响应: ${JSON.stringify(r.result).slice(0, 200)} 总耗时=${Date.now() - t0}ms`);
  } catch (e) {
    log(`[5] execute 响应未到: ${e.message}`);
  }
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true; pkill -f "sleep 120" 2>/dev/null; true`);
  c.end();
}
main().catch((e) => { log(`失败: ${e.message}`); process.exit(1); });
