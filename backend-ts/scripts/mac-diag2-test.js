#!/usr/bin/env node
/** Mac 快速诊断:检查上次测试后 agent 状态(是否又被 SIGTERM) */
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const cfg = require("../.mac-test-config.json");
const LOG = path.join(__dirname, "mac-diag2.log");
fs.writeFileSync(LOG, "");
function log(m) { console.log(m); fs.appendFileSync(LOG, m + "\n"); }
function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e))); }); }
function sshExec(c, cmd, ms = 20000) { return withTimeout(new Promise((res, rej) => { c.exec(cmd, (e, s) => { if (e) return rej(e); let o = ""; s.on("data", (d) => (o += d.toString())); s.stderr.on("data", (d) => (o += d.toString())); s.on("close", () => res(o)); }); }), ms); }

async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) => c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000);
  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  log("=== agent.log 尾部 ===");
  log((await sshExec(c, `tail -15 ${dir}/agent.log`)) || "(空)");
  log("\n=== guada-agent 进程 ===");
  log((await sshExec(c, `ps aux | grep guada-agent | grep -v grep || echo "无 agent 进程"`)) || "(无)");
  log("\n=== sleep 120 / du / ollama 进程 ===");
  log((await sshExec(c, `ps aux | grep -E "sleep 120|du -sh|ollama" | grep -v grep || echo "无相关进程"`)) || "(无)");
  log("\n=== 日志文件(guada-logs)===");
  const tmp = (await sshExec(c, "echo $TMPDIR")).trim();
  log((await sshExec(c, `ls -la ${tmp}guada-logs 2>&1 | tail -8`)) || "(无)");
  c.end();
}
main().catch((e) => log(`诊断失败: ${e.message}`));
