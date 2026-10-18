#!/usr/bin/env node
/**
 * 下载/校验冒烟测试（不触发安装）。
 *
 * 用本地 HTTP 服务模拟更新包，验证 UpdateManager 的下载、进度、SHA-512 校验与状态落盘。
 *
 * 用法：
 *   npx electron scripts/test-updater-download.js [安装包路径]
 *
 * 默认使用 release/GuaDa-Setup-<当前版本>.exe。测试完成后会清理临时目录。
 */
process.env.GUADA_UPDATE_ALLOW_LOCALHOST = "1";
// 这个夹具专门验证整包下载；差量链路由 scripts/updater-diff-test 覆盖。
process.env.GUADA_DISABLE_DIFFERENTIAL = "1";

const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const installerPath = path.resolve(
  process.argv[2] || path.join(repoRoot, "release", `GuaDa-Setup-${pkg.version}.exe`),
);

const testDataDir = path.join(os.tmpdir(), "guada-updater-smoke");
app.setPath("userData", testDataDir);

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  app.exit(1);
}

function computeSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

async function main() {
  if (!fs.existsSync(installerPath)) {
    fail(`安装包不存在：${installerPath}（先运行 pnpm run build:electron）`);
    return;
  }

  const { size } = fs.statSync(installerPath);
  const sha512 = await computeSha512(installerPath);
  const fileName = path.basename(installerPath);

  let server;
  const serverReady = new Promise((resolve) => {
    server = http.createServer((request, response) => {
      if (request.url === "/installer.exe") {
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": size,
        });
        fs.createReadStream(installerPath).pipe(response);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });

  const port = await serverReady;
  const url = `http://127.0.0.1:${port}/installer.exe`;
  console.log(`[smoke] 安装包：${installerPath}`);
  console.log(`[smoke] 大小：${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`[smoke] 模拟下载地址：${url}`);

  const { UpdateManager } = require(path.join(
    repoRoot,
    "electron",
    "dist",
    "updater.js",
  ));

  const manager = new UpdateManager((event) => {
    if (event.status === "downloading") {
      const { percent, transferred, total } = event.progress;
      if (transferred === 0 || percent % 10 === 0) {
        console.log(
          `[smoke] 下载中 ${percent}% (${transferred}/${total || "?"})`,
        );
      }
      return;
    }

    if (event.status === "downloaded") {
      const ok = fs.existsSync(event.filePath);
      const downloadedSize = ok ? fs.statSync(event.filePath).size : 0;
      if (!ok || downloadedSize !== size) {
        server.close();
        fail(`下载结果异常：exists=${ok} size=${downloadedSize}`);
        return;
      }
      console.log(`[smoke] PASS：已下载并通过 SHA-512 校验（${event.filePath}）`);
      server.close();
      try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        fs.rmSync(path.dirname(event.filePath), { recursive: true, force: true });
      } catch {
        // ignore
      }
      app.exit(0);
      return;
    }

    if (event.status === "error") {
      server.close();
      fail(event.error);
    }
  });

  manager.setAvailableInfo({
    version: `${pkg.version}-smoke`,
    hasUpdate: true,
    downloads: {
      win: { url, fileName, sha512, size },
    },
  });

  console.log("[smoke] 开始下载...");
  manager.download().catch((error) => {
    server.close();
    fail(error?.message || String(error));
  });
}

app.whenReady().then(() => {
  main().catch((error) => fail(error?.message || String(error)));
});
