#!/usr/bin/env node
/**
 * WSL 大文件分块传输实测:
 *   1. 生成本地 64MB 测试文件
 *   2. 分块上传到远端(uploadStart/uploadChunk/uploadEnd)
 *   3. 分块下载回本地(downloadStart/downloadChunk/downloadEnd)
 *   4. 两端 md5 校验一致 → 验证分块传输不崩溃、内容无损
 * 凭据从 ../.wsl-test-config.json 读取(不入库)。
 */
const { Client } = require("ssh2");
const WebSocket = require("ws");
const net = require("net");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const cfg = require("../.wsl-test-config.json");
const LOG = path.join(__dirname, "wsl-chunk.log");
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

function sshExec(c, cmd, ms = 60000) {
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

function rpcRequest(ws, id, method, params, ms = 300000) {
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

const CHUNK = 1024 * 1024; // 1MB,与 agent 端一致

/** 生成大文件(流式写,不整块驻留内存):size MB 重复模式 */
function generateFile(filePath, sizeMB) {
  const chunk = Buffer.alloc(1024 * 1024, 0x61); // 'a'
  const total = sizeMB * 1024 * 1024;
  let written = 0;
  const fd = fs.openSync(filePath, "w");
  while (written < total) {
    const n = Math.min(chunk.length, total - written);
    fs.writeSync(fd, chunk, 0, n);
    written += n;
  }
  fs.closeSync(fd);
}

function md5File(filePath) {
  return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
}

async function chunkUpload(ws, remotePath, localPath) {
  const stat = fs.statSync(localPath);
  const fd = fs.openSync(localPath, "r");
  const start = await rpcRequest(ws, "cu-1", "uploadStart", { remotePath, totalBytes: stat.size });
  const uploadId = start.result.uploadId;
  const buf = Buffer.alloc(CHUNK);
  let pos = 0;
  let seq = 0;
  try {
    while (pos < stat.size) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      await rpcRequest(ws, `cu-${++seq}`, "uploadChunk", {
        uploadId,
        data: buf.subarray(0, n).toString("base64"),
      });
      pos += n;
    }
    const end = await rpcRequest(ws, "cu-end", "uploadEnd", { uploadId });
    return end.result;
  } catch (e) {
    try { await rpcRequest(ws, "cu-abort", "uploadAbort", { uploadId }); } catch {}
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

async function chunkDownload(ws, remotePath, localPath) {
  const start = await rpcRequest(ws, "cd-1", "downloadStart", { remotePath });
  const downloadId = start.result.downloadId;
  const fd = fs.openSync(localPath, "w");
  let offset = 0;
  let received = 0;
  let seq = 0;
  try {
    while (true) {
      const chunk = await rpcRequest(ws, `cd-${++seq}`, "downloadChunk", {
        downloadId,
        offset,
        size: CHUNK,
      });
      const buf = Buffer.from(chunk.result.data, "base64");
      if (buf.length === 0) break;
      fs.writeSync(fd, buf, 0, buf.length);
      received += buf.length;
      offset += buf.length;
      if (chunk.result.isLast === "true") break;
    }
    await rpcRequest(ws, "cd-end", "downloadEnd", { downloadId });
    return { bytes: received };
  } catch (e) {
    try { await rpcRequest(ws, "cd-end", "downloadEnd", { downloadId }); } catch {}
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const SIZE_MB = 64;
  const distBin = path.join(__dirname, "..", "..", "guada-agent", "dist", "guada-agent-linux-amd64");
  if (!fs.existsSync(distBin)) {
    log("✗ dist 二进制缺失,先运行 release.sh 构建");
    process.exit(1);
  }

  // 本地生成 64MB 测试文件
  const localFile = path.join(__dirname, "big_test_64mb.bin");
  log(`[1/6] 生成本地 ${SIZE_MB}MB 测试文件...`);
  generateFile(localFile, SIZE_MB);
  const localMd5 = md5File(localFile);
  log(`   本地 md5: ${localMd5}`);

  const c = new Client();
  await withTimeout(
    new Promise((res, rej) =>
      c.once("ready", res).once("error", rej).connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password }),
    ),
    30000,
    "SSH 连接",
  );
  log("[2/6] SSH 连接成功");

  const home = (await sshExec(c, "echo $HOME")).trim();
  const dir = `${home}/.guada-agent`;
  const remoteBin = `${dir}/guada-agent`;
  await sshExec(c, `mkdir -p ${dir}`);
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  await sftpPut(c, distBin, remoteBin);
  await sshExec(c, `chmod +x ${remoteBin}`);
  const token = `chunk-test-${Date.now()}`;
  await sshExec(c, `echo ${token} > ${dir}/.token && chmod 600 ${dir}/.token`);

  await sshExec(c, `nohup ${remoteBin} --port 0 --token-file ${dir}/.token --root ${dir} --perm unrestricted > ${dir}/agent.log 2>&1 < /dev/null & echo started`);
  await new Promise((r) => setTimeout(r, 1500));
  const startLog = await sshExec(c, `cat ${dir}/agent.log`);
  const m = startLog.match(/listening on \S+:(\d+)/);
  if (!m) throw new Error(`agent 启动失败: ${startLog}`);
  const port = parseInt(m[1], 10);
  log(`[3/6] agent 启动,端口 ${port}`);

  const lp = await forwardPort(c, port);
  const ws = await wsConnect(`ws://127.0.0.1:${lp}/ws`, token);

  // 分块上传
  const remoteUpload = `${dir}/big_upload.bin`;
  log(`[4/6] 分块上传 ${SIZE_MB}MB...`);
  const up = await chunkUpload(ws, remoteUpload, localFile);
  const remoteMd5Up = (await sshExec(c, `md5sum ${remoteUpload} | cut -d' ' -f1`)).trim();
  log(`   上传完成: ${JSON.stringify(up)}`);
  log(`   远端 md5: ${remoteMd5Up}`);
  if (remoteMd5Up !== localMd5) {
    log(`✗ 上传后 md5 不一致: 远端=${remoteMd5Up} 本地=${localMd5}`);
    process.exit(1);
  }
  log("   ✅ 上传 md5 一致");

  // 分块下载
  const localDl = path.join(__dirname, "big_download_64mb.bin");
  log(`[5/6] 分块下载 ${SIZE_MB}MB...`);
  const dl = await chunkDownload(ws, remoteUpload, localDl);
  const dlMd5 = md5File(localDl);
  log(`   下载完成: ${JSON.stringify(dl)}`);
  log(`   下载 md5: ${dlMd5}`);
  if (dlMd5 !== localMd5) {
    log(`✗ 下载后 md5 不一致: 下载=${dlMd5} 本地=${localMd5}`);
    process.exit(1);
  }
  log("   ✅ 下载 md5 一致");

  log(`[6/6] ✅ 大文件分块传输验证通过(${SIZE_MB}MB 往返无损)`);
  ws.close();
  await sshExec(c, `pkill -f "${remoteBin}" 2>/dev/null; true`);
  c.end();
  fs.unlinkSync(localDl);
  fs.unlinkSync(localFile);
}

main().catch((e) => {
  log(`测试失败: ${e.message}`);
  process.exit(1);
});
