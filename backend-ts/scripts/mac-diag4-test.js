const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-diag4.log");
fs.writeFileSync(LOG, "");
function log(m) { console.log(m); fs.appendFileSync(LOG, m + "\n"); }
function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e))); }); }
function sshExec(c, cmd, ms = 20000) { return withTimeout(new Promise((res, rej) => { c.exec(cmd, (e, s) => { if (e) return rej(e); let o = ""; s.on("data", (d) => (o += d.toString())); s.stderr.on("data", (d) => (o += d.toString())); s.on("close", () => res(o)); }); }), ms); }
async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) => c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000);
  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  log("=== agent-vf.log 全部(EXEC 阶段日志)===");
  log((await sshExec(c, `cat ${dir}/agent-vf.log`)) || "(空)");
  log("\n=== 相关进程 ===");
  log((await sshExec(c, `ps aux | grep -E "guada-agent|sleep 120|du -sh" | grep -v grep || echo 无`)) || "(无)");
  c.end();
}
main().catch((e) => log(`诊断失败: ${e.message}`));
