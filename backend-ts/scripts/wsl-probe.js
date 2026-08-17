#!/usr/bin/env node
/** WSL 环境分步探活:定位断线测试脚本卡在哪一步 */
const { Client } = require("ssh2");
const os = require("os");
const path = require("path");
const fs = require("fs");

const cfg = require("../.wsl-test-config.json");
const LOG = path.join(__dirname, "wsl-probe.log");
fs.writeFileSync(LOG, "");
function log(m) {
  const line = `[${Date.now()}] ${m}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function withTimeout(p, ms, label) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`超时(${ms}ms): ${label}`)), ms);
    p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e)));
  });
}

function sshExec(c, cmd, ms = 15000) {
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
    `ssh:${cmd.slice(0, 40)}`,
  );
}

function sftpPut(c, local, remote, ms = 60000) {
  return withTimeout(
    new Promise((res, rej) => {
      c.sftp((e, sftp) => {
        if (e) return rej(e);
        sftp.fastPut(local, remote, (e2) => (e2 ? rej(e2) : res()));
      });
    }),
    ms,
    "sftp",
  );
}

async function main() {
  log("开始探活");
  const c = new Client();
  const t0 = Date.now();
  await withTimeout(
    new Promise((res, rej) =>
      c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password }),
    ),
    30000,
    "SSH connect",
  );
  log(`[OK] SSH 连接成功,耗时 ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const home = (await sshExec(c, "echo $HOME && uname -m")).trim();
  log(`[OK] echo $HOME 耗时 ${Date.now() - t1}ms → ${home}`);

  // 本地二进制探测
  const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-linux-amd64");
  const cacheBin = path.join(os.homedir(), ".guada", "agent", "guada-agent-linux-amd64");
  log(`dist 二进制存在: ${fs.existsSync(distBin)} (${distBin})`);
  log(`cache 二进制存在: ${fs.existsSync(cacheBin)} (${cacheBin})`);
  const bin = fs.existsSync(distBin) ? distBin : cacheBin;
  log(`选用二进制: ${bin} (${fs.statSync(bin).size} bytes)`);

  const dir = `${home.split("\n")[0]}/.guada-agent`;
  await sshExec(c, `mkdir -p ${dir}`);
  log("[OK] 远端 mkdir");

  const t2 = Date.now();
  try {
    await sftpPut(c, bin, `${dir}/guada-agent`, 120000);
    log(`[OK] SFTP 上传 ${fs.statSync(bin).size} bytes 耗时 ${Date.now() - t2}ms`);
  } catch (e) {
    log(`[FAIL] SFTP 上传失败: ${e.message}`);
  }

  c.end();
  log("探活完成");
}

main().catch((e) => log(`[FAIL] ${e.message}`));
