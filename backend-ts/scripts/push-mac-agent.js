#!/usr/bin/env node
/**
 * 推送修复版 agent(darwin)到 mac,覆盖已安装版本
 * 上传 dist/guada-agent-darwin-amd64 → ~/.guada-agent/guada-agent,chmod +x,验证版本
 * 凭据 ../.mac-test-config.json。
 */
const { Client } = require("ssh2");
const path = require("path");
const fs = require("fs");

const cfg = require("../.mac-test-config.json");
const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-darwin-amd64");
if (!fs.existsSync(distBin)) {
  console.error("✗ dist darwin 缺失:", distBin);
  process.exit(1);
}

function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e))); }); }
function sshExec(c, cmd, ms = 20000) { return withTimeout(new Promise((res, rej) => { c.exec(cmd, (e, s) => { if (e) return rej(e); let o = ""; s.on("data", (d) => (o += d.toString())); s.stderr.on("data", (d) => (o += d.toString())); s.on("close", () => res(o)); }); }), ms); }

async function main() {
  const c = new Client();
  await withTimeout(new Promise((res, rej) => c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password })), 30000);
  console.log("[1] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  const oldVer = (await sshExec(c, `${remoteBin} --version 2>&1 || echo unknown`)).trim();
  console.log(`[2] 推送前版本: ${oldVer}`);

  // 上传前清理旧 agent 进程(二进制覆盖需要;这是部署动作,接受)
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  const sftp = await withTimeout(new Promise((res, rej) => c.sftp((e, s) => (e ? rej(e) : res(s)))), 30000, "sftp");
  await withTimeout(new Promise((res, rej) => sftp.fastPut(distBin, remoteBin, (e) => (e ? rej(e) : res()))), 120000, "上传");
  await sshExec(c, `chmod +x ${remoteBin}`);
  console.log(`[3] 已上传: ${distBin} (${fs.statSync(distBin).size} bytes)`);

  const newVer = (await sshExec(c, `${remoteBin} --version 2>&1`)).trim();
  console.log(`[4] 推送后版本: ${newVer}`);
  console.log(newVer !== oldVer ? "✅ 推送完成(版本已更新)" : "⚠️ 版本未变?");

  c.end();
}
main().catch((e) => { console.error("推送失败:", e.message); process.exit(1); });
