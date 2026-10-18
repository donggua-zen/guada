#!/usr/bin/env node
/**
 * 离线估算两个版本之间的差量下载大小。
 *
 * 读取旧版和新版的 .blockmap（app-builder 生成的 gzip JSON），按新版的块校验和
 * 是否在旧版中出现，计算「需要下载的字节数」；不联网、不依赖 electron-updater。
 *
 * 用法：
 *   node scripts/estimate-blockmap-delta.mjs \
 *     --old release/old/GuaDa-Setup-1.0.6.exe.blockmap \
 *     --new release/GuaDa-Setup-1.0.7.exe.blockmap
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }
    args[token.slice(2)] = value;
    i += 1;
  }
  return args;
}

function readBlockmap(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`blockmap 不存在：${filePath}`);
  }
  const raw = fs.readFileSync(filePath);
  let jsonBuffer;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    jsonBuffer = zlib.gunzipSync(raw);
  } else {
    // 兼容未 gzip 的 blockmap（app-builder 的 --compression deflate 变体）。
    jsonBuffer = zlib.inflateRawSync(raw);
  }
  const json = JSON.parse(jsonBuffer.toString("utf8"));
  const file = json?.files?.[0];
  if (!file || !Array.isArray(file.checksums) || !Array.isArray(file.sizes)) {
    throw new Error(`blockmap 格式异常：${filePath}`);
  }
  return file;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.old || !args.new) {
    console.error(
      "用法: node scripts/estimate-blockmap-delta.mjs --old <旧版.blockmap> --new <新版.blockmap>",
    );
    process.exit(1);
  }

  const oldMap = readBlockmap(path.resolve(args.old));
  const newMap = readBlockmap(path.resolve(args.new));

  if (oldMap.checksums.length !== oldMap.sizes.length) {
    throw new Error("旧 blockmap 的 checksums 与 sizes 数量不一致");
  }
  if (newMap.checksums.length !== newMap.sizes.length) {
    throw new Error("新 blockmap 的 checksums 与 sizes 数量不一致");
  }

  const oldChecksums = new Set(oldMap.checksums);
  const fullSize = newMap.sizes.reduce((sum, size) => sum + size, 0);
  let downloadBytes = 0;
  let copyBlocks = 0;
  let downloadBlocks = 0;

  for (let i = 0; i < newMap.checksums.length; i += 1) {
    const size = Number(newMap.sizes[i] || 0);
    if (oldChecksums.has(newMap.checksums[i])) {
      copyBlocks += 1;
    } else {
      downloadBlocks += 1;
      downloadBytes += size;
    }
  }

  const ratio = fullSize > 0 ? (downloadBytes / fullSize) * 100 : 0;
  const oldSize = oldMap.sizes.reduce((sum, size) => sum + size, 0);

  console.log("");
  console.log("Blockmap 差量估算");
  console.log(`  旧版安装包：${formatBytes(oldSize)}（${oldMap.checksums.length} 块）`);
  console.log(`  新版安装包：${formatBytes(fullSize)}（${newMap.checksums.length} 块）`);
  console.log(`  可复用块：  ${copyBlocks}`);
  console.log(`  需下载块：  ${downloadBlocks}`);
  console.log(`  预计下载：  ${formatBytes(downloadBytes)}（${ratio.toFixed(1)}%）`);
  console.log(`  节省：      ${formatBytes(fullSize - downloadBytes)}`);
  console.log("");
  console.log("说明：这是理论下限，不含 blockmap 本身、HTTP 开销与 electron-updater 的");
  console.log("重试/整包回退；实际下载量以客户端日志的 download-progress.total 为准。");
}

try {
  main();
} catch (error) {
  console.error(`[estimate-blockmap-delta] ${error.message || error}`);
  process.exit(1);
}
