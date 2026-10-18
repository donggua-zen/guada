#!/usr/bin/env node
/**
 * 发版后同步官网 check_update 数据。
 *
 * 读取 GitCode release 上的 latest.yml（electron-builder 生成，含文件名 / sha512 / size），
 * 写入 ai_web 的 backend/config.json 的 downloads.win，供客户端就地下载使用。
 *
 * 用法：
 *   node scripts/sync-official-update-config.mjs
 *   node scripts/sync-official-update-config.mjs --version 1.0.6 --config ../ai_web/backend/config.json
 *   node scripts/sync-official-update-config.mjs --file ./release/latest.yml --dry-run
 *
 * 参数：
 *   --version <x.y.z>     默认读取根 package.json
 *   --config <path>       默认 ../ai_web/backend/config.json
 *   --file <path>         改用本地 latest.yml（默认从 GitCode 拉取）
 *   --version-code <n>    手动指定 versionCode（默认按 major*100 + minor*10 + patch 计算）
 *   --date <YYYY-MM-DD>   默认今天
 *   --description <text>  覆盖更新说明（默认保留 config 现有值）
 *   --mandatory           标记为强制更新（默认保留原值）
 *   --dry-run             只打印结果，不写文件
 *   --skip-verify         跳过下载地址可达性检查
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const GITCODE_REPO = "https://gitcode.com/donggua_sherlock/GuaDaAI";
const GITHUB_REPO = "donggua-zen/guada";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "dry-run" || key === "skip-verify" || key === "mandatory") {
      args[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function computeVersionCode(version) {
  const parts = version.split(".").map((part) => parseInt(part, 10) || 0);
  const [major = 0, minor = 0, patch = 0] = parts;
  return major * 100 + minor * 10 + patch;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：HTTP ${response.status}`);
  }
  return response.text();
}

async function verifyDownloadUrl(url) {
  // GitCode 会 302 到预签名 CDN，fetch 会自动跟随。
  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (head.ok) return true;
  } catch {
    // HEAD 不被支持时继续用 Range 探测
  }

  try {
    const probe = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    await probe.body?.cancel().catch(() => undefined);
    return probe.ok || probe.status === 206;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const version = String(args.version || pkg.version).replace(/^v/, "");
  const configPath = path.resolve(
    repoRoot,
    args.config || path.join("..", "ai_web", "backend", "config.json"),
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`官网配置不存在：${configPath}`);
  }

  let ymlContent;
  if (args.file) {
    const ymlPath = path.resolve(repoRoot, args.file);
    if (!fs.existsSync(ymlPath)) {
      throw new Error(`latest.yml 不存在：${ymlPath}`);
    }
    ymlContent = fs.readFileSync(ymlPath, "utf8");
    console.log(`读取本地 latest.yml：${ymlPath}`);
  } else {
    const ymlUrl = `${GITCODE_REPO}/releases/download/v${version}/latest.yml`;
    console.log(`拉取 GitCode latest.yml：${ymlUrl}`);
    ymlContent = await fetchText(ymlUrl);
  }

  const meta = yaml.load(ymlContent);
  const file = Array.isArray(meta?.files) ? meta.files[0] : null;
  if (!file?.url || !file?.sha512) {
    throw new Error("latest.yml 缺少 files[0].url 或 sha512");
  }

  const fileName = path.basename(decodeURIComponent(String(file.url)));
  // GitCode 附件名允许空格并保留原名；encodeURIComponent 保证 URL 可直接请求。
  const downloadUrl = `${GITCODE_REPO}/releases/download/v${version}/${encodeURIComponent(fileName)}`;
  // 差量更新依赖同目录的 .blockmap；electron-updater 也会按此规则推导。
  const blockmapUrl = `${downloadUrl}.blockmap`;
  const size = Number(file.size || 0);

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const next = {
    ...config,
    version,
    versionCode: args["version-code"]
      ? Number(args["version-code"])
      : computeVersionCode(version),
    publishDate: args.date || today(),
    downloads: {
      ...(config.downloads || {}),
      win: {
        url: downloadUrl,
        fileName,
        sha512: String(file.sha512),
        size,
        blockmapUrl,
      },
    },
  };

  if (args.description) next.description = String(args.description);
  if (args.mandatory) next.mandatory = true;

  console.log("");
  console.log("将写入官网配置：");
  console.log(`  文件：${configPath}`);
  console.log(`  版本：${next.version}（versionCode ${next.versionCode}）`);
  console.log(`  安装包：${fileName}（${(size / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`  下载地址：${downloadUrl}`);
  console.log(`  blockmap：${blockmapUrl}`);
  console.log(`  sha512：${String(file.sha512).slice(0, 24)}...`);
  console.log(`  GitHub 备用：https://github.com/${GITHUB_REPO}/releases/download/v${version}/${fileName}`);
  console.log("");

  if (args["dry-run"]) {
    console.log("--dry-run：未写入文件。");
    return;
  }

  if (!args["skip-verify"]) {
    console.log("校验下载地址与 blockmap 可达性...");
    const ok = await verifyDownloadUrl(downloadUrl);
    if (!ok) {
      throw new Error(`下载地址不可达，请先确认 GitCode 附件已上传：${downloadUrl}`);
    }
    const blockmapOk = await verifyDownloadUrl(blockmapUrl);
    if (!blockmapOk) {
      throw new Error(
        `blockmap 不可达，差量更新会退化为整包下载：${blockmapUrl}\n` +
          "请确认 upload-gitcode-release.mjs 已包含 .blockmap 并重新补传。",
      );
    }
    console.log("下载地址与 blockmap 均可达。");
  }

  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`已写入 ${configPath}`);
  console.log("下一步：部署 ai_web 后端使 check_update 返回新数据。");
}

main().catch((error) => {
  console.error(`[sync-update-config] ${error.message || error}`);
  process.exit(1);
});
