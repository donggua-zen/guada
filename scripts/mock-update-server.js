#!/usr/bin/env node
/**
 * 本地 mock 更新服务（仅用于联调）。
 *
 * 同时提供两类接口：
 * - /api/check_update：官网更新检查的模拟响应；
 * - /v<newVersion>/latest.yml + 安装包 + blockmap：electron-updater 的 generic feed，
 *   用于验证差量下载；/v<oldVersion>/...blockmap 提供旧版本 blockmap。
 *
 * 用法：
 *   node scripts/mock-update-server.js \
 *     --version 1.0.7 \
 *     --file ./release/GuaDa-Setup-1.0.7.exe \
 *     --blockmap ./release/GuaDa-Setup-1.0.7.exe.blockmap \
 *     --old-blockmap ./release/legacy/GuaDa-Setup-1.0.6.exe.blockmap
 *
 * 启动后按提示用环境变量运行已安装的 GuaDa：
 *   GUADA_UPDATE_API_URL=http://127.0.0.1:<port>/api/check_update
 *   GUADA_UPDATE_ALLOW_LOCALHOST=1
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const mockVersion = argValue("version", "1.0.7");
const oldVersion = argValue("old-version", pkg.version);
const port = Number(argValue("port", "18765"));
const installerPath = path.resolve(
  argValue("file", path.join(repoRoot, "release", `GuaDa-Setup-${pkg.version}.exe`)),
);
const newBlockmapPath = path.resolve(
  argValue("blockmap", `${installerPath}.blockmap`),
);
const oldBlockmapArg = argValue("old-blockmap", "");
const oldBlockmapPath = oldBlockmapArg ? path.resolve(oldBlockmapArg) : null;

if (!fs.existsSync(installerPath)) {
  console.error(`安装包不存在：${installerPath}`);
  process.exit(1);
}
if (!fs.existsSync(newBlockmapPath)) {
  console.warn(`⚠️ 新 blockmap 不存在：${newBlockmapPath}（差量会回退整包）`);
}
if (oldBlockmapPath && !fs.existsSync(oldBlockmapPath)) {
  console.warn(`⚠️ 旧 blockmap 不存在：${oldBlockmapPath}（差量会回退整包）`);
}

const newFileName = path.basename(installerPath);
const oldFileName = `GuaDa-Setup-${oldVersion}.exe`;
const newVersionDir = `/v${mockVersion}`;
const oldVersionDir = `/v${oldVersion}`;

function sha512Of(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

function parseRange(header, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header || "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function sendFile(request, response, filePath, contentType) {
  const { size } = fs.statSync(filePath);
  const range = parseRange(request.headers.range, size);
  const length = range ? range.end - range.start + 1 : size;
  const headers = {
    "Content-Type": contentType,
    "Content-Length": length,
    "Accept-Ranges": "bytes",
  };
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(
    filePath,
    range ? { start: range.start, end: range.end } : undefined,
  ).pipe(response);
}

async function main() {
  const { size } = fs.statSync(installerPath);
  const sha512 = await sha512Of(installerPath);
  const downloadUrl = `http://127.0.0.1:${port}${newVersionDir}/${encodeURIComponent(newFileName)}`;
  const blockmapUrl = `${downloadUrl}.blockmap`;

  const latestYml = [
    `version: ${mockVersion}`,
    `files:`,
    `  - url: ${newFileName}`,
    `    sha512: '${sha512}'`,
    `    size: ${size}`,
    `path: ${newFileName}`,
    `sha512: '${sha512}'`,
    `releaseDate: '${new Date().toISOString()}'`,
    ``,
  ].join("\n");

  const payload = {
    hasUpdate: true,
    version: mockVersion,
    versionCode: 0,
    clientVersion: pkg.version,
    downloadUrl: "https://ai.dingd.cn/download",
    releaseNotes: "https://ai.dingd.cn/changelog",
    mandatory: false,
    publishDate: new Date().toISOString().slice(0, 10),
    description: "本地 mock 更新：用于验证下载、差量、校验与静默安装流程。",
    downloads: {
      win: {
        url: downloadUrl,
        fileName: newFileName,
        sha512,
        size,
        blockmapUrl,
      },
    },
  };

  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url || "/").split("?")[0];

    if (url.startsWith("/api/check_update")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }

    // electron-updater generic feed
    if (url === `${newVersionDir}/latest.yml`) {
      response.writeHead(200, { "Content-Type": "text/yaml; charset=utf-8" });
      response.end(latestYml);
      return;
    }
    if (url === `${newVersionDir}/${newFileName}`) {
      console.log(
        `  → GET ${url} range=${request.headers.range || "full"}`,
      );
      sendFile(request, response, installerPath, "application/octet-stream");
      return;
    }
    if (url === `${newVersionDir}/${newFileName}.blockmap`) {
      if (fs.existsSync(newBlockmapPath)) {
        sendFile(request, response, newBlockmapPath, "application/octet-stream");
      } else {
        response.writeHead(404);
        response.end("blockmap not found");
      }
      return;
    }
    if (url === `${oldVersionDir}/${oldFileName}.blockmap`) {
      if (oldBlockmapPath && fs.existsSync(oldBlockmapPath)) {
        sendFile(request, response, oldBlockmapPath, "application/octet-stream");
      } else {
        response.writeHead(404);
        response.end("old blockmap not found");
      }
      return;
    }

    // 兼容旧的整包测试脚本
    if (url === `/${newFileName}` || url === "/installer.exe") {
      sendFile(request, response, installerPath, "application/octet-stream");
      return;
    }

    response.writeHead(404);
    response.end("not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("");
    console.log("Mock 更新服务已启动");
    console.log(`  检查更新：http://127.0.0.1:${port}/api/check_update`);
    console.log(`  feed：    http://127.0.0.1:${port}${newVersionDir}/`);
    console.log(`  安装包：  ${downloadUrl}`);
    console.log(`  新 blockmap：${blockmapUrl}`);
    console.log(
      `  旧 blockmap：${oldBlockmapPath ? `${oldBlockmapPath}` : "(未提供，差量会回退)"}`,
    );
    console.log(`  模拟版本：${mockVersion}（当前 ${pkg.version}）`);
    console.log(`  sha512：  ${sha512.slice(0, 24)}...`);
    console.log("");
    console.log("运行已安装的 GuaDa 时设置：");
    console.log(`  GUADA_UPDATE_API_URL=http://127.0.0.1:${port}/api/check_update`);
    console.log("  GUADA_UPDATE_ALLOW_LOCALHOST=1");
    console.log("");
    console.log("按 Ctrl+C 停止。");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
