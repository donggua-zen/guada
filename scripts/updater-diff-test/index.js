#!/usr/bin/env node
/**
 * electron-updater 差量下载测试夹具。
 *
 * 运行方式（注意：必须把 scripts/updater-diff-test 目录作为 Electron app 启动，
 * 这样 app.getVersion() 才会读到这里 package.json 里的基线版本）：
 *
 *   pnpm exec electron scripts/updater-diff-test \
 *     --old-installer "%TEMP%/guada-update-test/legacy-1.0.6/GuaDa-Setup-1.0.6.exe" \
 *     --new-installer release/GuaDa-Setup-1.0.6.exe \
 *     --new-version 1.0.7
 *
 * 它会：
 * 1. 在临时端口起一个支持 Range 的 mock feed（latest.yml + exe + 新旧 blockmap）；
 * 2. 把 old-installer 复制到 %LOCALAPPDATA%/<test-cache>/installer.exe，模拟 NSIS 安装器缓存；
 * 3. 调用生产代码里的 UpdateManager.download()，观察是否走差量、实际下载多少字节；
 * 4. 清理临时目录后退出（不会真正安装）。
 */
process.env.GUADA_UPDATE_ALLOW_LOCALHOST = "1";

const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "..", "..");
const rootPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const testAppPkg = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
);

const currentVersion = testAppPkg.version;
const cacheDirName = `guada-updater-difftest-${process.pid}`;
const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const cacheDir = path.join(localAppData, cacheDirName);
const tempRoot = path.join(os.tmpdir(), `guada-updater-diff-${process.pid}`);
const devConfigPath = path.join(appRoot, "dev-app-update.yml");

app.setPath("userData", path.join(tempRoot, "userData"));

function argValue(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function bumpPatch(version) {
  const parts = version.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return parts.join(".");
}

const oldInstaller = path.resolve(
  argValue(
    "old-installer",
    path.join(
      os.tmpdir(),
      "guada-update-test",
      `legacy-${currentVersion}`,
      `GuaDa-Setup-${currentVersion}.exe`,
    ),
  ),
);
const newInstaller = path.resolve(
  argValue(
    "new-installer",
    path.join(repoRoot, "release", `GuaDa-Setup-${currentVersion}.exe`),
  ),
);
const oldBlockmap = path.resolve(
  argValue("old-blockmap", `${oldInstaller}.blockmap`),
);
const newBlockmap = path.resolve(
  argValue("new-blockmap", `${newInstaller}.blockmap`),
);
const newVersion = argValue("new-version", bumpPatch(currentVersion));
const oldVersion = currentVersion;
const newFileName = `GuaDa-Setup-${newVersion}.exe`;
const newVersionDir = `/v${newVersion}`;
const oldVersionDir = `/v${oldVersion}`;

let devConfigBackup = null;
let server = null;
let finished = false;
let exeBytesSent = 0;
let exeRequests = [];

function cleanup(code) {
  if (finished) return;
  finished = true;
  try {
    server?.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    if (devConfigBackup == null) {
      fs.rmSync(devConfigPath, { force: true });
    } else {
      fs.writeFileSync(devConfigPath, devConfigBackup, "utf8");
    }
  } catch {
    // ignore
  }
  setTimeout(() => app.exit(code), 50);
}

function fail(message) {
  console.error(`[diff-test] FAIL: ${message}`);
  cleanup(1);
}

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

function sendFile(request, response, filePath, contentType, countInstallerBytes) {
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
  const stream = fs.createReadStream(
    filePath,
    range ? { start: range.start, end: range.end } : undefined,
  );
  if (countInstallerBytes) {
    exeRequests.push(range ? `bytes=${range.start}-${range.end}` : "full");
    stream.on("data", (chunk) => {
      exeBytesSent += chunk.length;
    });
  }
  stream.pipe(response);
}

async function main() {
  for (const [label, file] of [
    ["旧安装包", oldInstaller],
    ["旧 blockmap", oldBlockmap],
    ["新安装包", newInstaller],
    ["新 blockmap", newBlockmap],
  ]) {
    if (!fs.existsSync(file)) {
      fail(`${label}不存在：${file}`);
      return;
    }
  }

  if (currentVersion !== rootPkg.version) {
    console.warn(
      `[diff-test] 注意：测试 app 版本 ${currentVersion} 与仓库版本 ${rootPkg.version} 不一致，` +
        "请同步 scripts/updater-diff-test/package.json",
    );
  }

  const { size } = fs.statSync(newInstaller);
  const sha512 = await sha512Of(newInstaller);
  const latestYml = [
    `version: ${newVersion}`,
    "files:",
    `  - url: ${newFileName}`,
    `    sha512: '${sha512}'`,
    `    size: ${size}`,
    `path: ${newFileName}`,
    `sha512: '${sha512}'`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");

  await new Promise((resolve) => {
    server = http.createServer((request, response) => {
      const url = decodeURIComponent(request.url || "/").split("?")[0];
      if (url === `${newVersionDir}/latest.yml`) {
        response.writeHead(200, { "Content-Type": "text/yaml; charset=utf-8" });
        response.end(latestYml);
        return;
      }
      if (url === `${newVersionDir}/${newFileName}`) {
        sendFile(
          request,
          response,
          newInstaller,
          "application/octet-stream",
          true,
        );
        return;
      }
      if (url === `${newVersionDir}/${newFileName}.blockmap`) {
        sendFile(
          request,
          response,
          newBlockmap,
          "application/octet-stream",
          false,
        );
        return;
      }
      if (url === `${oldVersionDir}/GuaDa-Setup-${oldVersion}.exe.blockmap`) {
        sendFile(
          request,
          response,
          oldBlockmap,
          "application/octet-stream",
          false,
        );
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const feedUrl = `http://127.0.0.1:${port}${newVersionDir}/`;
  const downloadUrl = `${feedUrl}${encodeURIComponent(newFileName)}`;

  // electron-updater 在未打包场景会读 app.getAppPath()/dev-app-update.yml 拿 updaterCacheDirName。
  if (fs.existsSync(devConfigPath)) {
    devConfigBackup = fs.readFileSync(devConfigPath, "utf8");
  }
  fs.writeFileSync(
    devConfigPath,
    [
      "provider: generic",
      `url: ${feedUrl}`,
      `updaterCacheDirName: ${cacheDirName}`,
      "",
    ].join("\n"),
    "utf8",
  );

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.copyFileSync(oldInstaller, path.join(cacheDir, "installer.exe"));

  console.log(`[diff-test] 当前版本：${currentVersion}`);
  console.log(`[diff-test] 模拟新版本：${newVersion}`);
  console.log(`[diff-test] 旧安装包：${oldInstaller}`);
  console.log(`[diff-test] 新安装包：${newInstaller} (${(size / 1048576).toFixed(1)} MB)`);
  console.log(`[diff-test] feed：${feedUrl}`);
  console.log(`[diff-test] 缓存目录：${cacheDir}`);

  const { UpdateManager } = require(path.join(
    repoRoot,
    "electron",
    "dist",
    "updater.js",
  ));

  const manager = new UpdateManager((event) => {
    if (event.status === "downloading") {
      const { percent, transferred, total } = event.progress;
      if (transferred === 0 || percent % 10 === 0 || transferred === total) {
        console.log(
          `[diff-test] 下载中 ${percent}% ${(transferred / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`,
        );
      }
      return;
    }

    if (event.status === "downloaded") {
      const exists = fs.existsSync(event.filePath);
      const downloadedSize = exists ? fs.statSync(event.filePath).size : 0;
      const ratio = size > 0 ? (exeBytesSent / size) * 100 : 0;
      console.log("");
      console.log("[diff-test] 下载完成");
      console.log(`  安装包存在：${exists}（${downloadedSize} 字节）`);
      console.log(`  期望大小：  ${size} 字节`);
      console.log(`  安装包请求：${exeRequests.length} 次`);
      console.log(`  实际下载：  ${(exeBytesSent / 1048576).toFixed(2)} MB（${ratio.toFixed(1)}%）`);
      const sample = exeRequests.slice(0, 8).join(" | ");
      if (sample) console.log(`  Range 样例：${sample}`);
      if (!exists || downloadedSize !== size) {
        fail("下载文件不完整");
        return;
      }
      if (ratio >= 99.9) {
        fail("看起来走了整包下载（差量未生效）");
        return;
      }
      console.log("[diff-test] PASS：走了差量下载");
      cleanup(0);
      return;
    }

    if (event.status === "error") {
      fail(event.error);
    }
  });

  manager.setAvailableInfo({
    version: newVersion,
    hasUpdate: true,
    downloads: {
      win: {
        url: downloadUrl,
        fileName: newFileName,
        sha512,
        size,
      },
    },
  });

  const timeout = setTimeout(() => {
    fail("超时（180s）");
  }, 180_000);
  timeout.unref();

  manager.download().catch((error) => {
    fail(error?.message || String(error));
  });
}

app.whenReady().then(() => {
  main().catch((error) => fail(error?.message || String(error)));
});
