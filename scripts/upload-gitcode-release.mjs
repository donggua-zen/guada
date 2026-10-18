#!/usr/bin/env node
/**
 * 把 GitHub Release 里的安装包上传到 GitCode 的同名 release。
 *
 * 为什么需要它（实测结论）：GitHub 的海外 runner 传到 file.gitcode.com 极慢
 * （约 60KB/s，235MB 的 dmg 传满 60 分钟仍未完成，curl exit 28），所以
 * `.github/workflows/release.yml` 里的 publish-mirrors **只负责建 release 与写说明**，
 * 二进制由国内机器用本脚本补 —— 实测国内上传 ~7.5MB/s，两个安装包不到一分钟。
 *
 * 用法：
 *   node scripts/upload-gitcode-release.mjs v1.0.2                   # 本地没有就从 GitHub 下载
 *   node scripts/upload-gitcode-release.mjs v1.0.2 --dir ./release   # 直接用本地已有的安装包
 *   node scripts/upload-gitcode-release.mjs v1.0.2 --skip x64        # 跳过名字含 x64 的资产
 *   node scripts/upload-gitcode-release.mjs v1.0.2 --dry-run         # 只打印计划
 *
 * token 来源（按顺序）：环境变量 `GITCODE_TOKEN` → `git credential fill`（host=gitcode.com）。
 * 注意：GitCode 的写权限按「账号在该仓库里的成员身份」判定 —— token 必须来自有写权限的账号，
 * 否则会 403（踩过一次：用了另一个账号的 token，读得到、写不了）。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GITCODE_REPO = 'donggua_sherlock/GuaDaAI';
const GITHUB_REPO = 'donggua-zen/guada';
const GITCODE_API = `https://api.gitcode.com/api/v5/repos/${GITCODE_REPO}`;
// .blockmap 是 NSIS 差量更新的元数据，必须和新版安装包放在同一个 release 目录。
const UPLOAD_EXTS = ['.dmg', '.exe', '.yml', '.blockmap'];

const args = process.argv.slice(2);
const tag = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const skipArg = args.includes('--skip') ? args[args.indexOf('--skip') + 1] : null;

if (!tag) {
  console.error(
    '用法: node scripts/upload-gitcode-release.mjs <tag> [--dir <目录>] [--skip <名字片段>] [--dry-run]',
  );
  process.exit(1);
}

function resolveToken() {
  if (process.env.GITCODE_TOKEN?.trim()) return process.env.GITCODE_TOKEN.trim();
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=gitcode.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('password='));
    if (line) return line.slice('password='.length).trim();
  } catch {
    /* 落到下面的报错 */
  }
  console.error('❌ 拿不到 GitCode token：请设 GITCODE_TOKEN，或确保 git 能对 gitcode.com 取到凭据');
  process.exit(1);
}

const token = resolveToken();
const auth = { Authorization: `Bearer ${token}` };

async function api(url, init = {}, attempts = 4) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 非 JSON 原样返回 */
      }
      return { status: res.status, json, text };
    } catch (err) {
      // GitCode 的 API 偶发 "other side closed"（实测），退避重试
      lastError = err;
      if (i < attempts) {
        console.log(`  （GitCode API 第 ${i} 次请求失败：${err.message}，${i * 2}s 后重试）`);
        await new Promise((r) => setTimeout(r, i * 2000));
      }
    }
  }
  throw new Error(`GitCode API 请求失败（重试 ${attempts} 次）：${lastError?.message ?? lastError}`);
}

/** 下载/上传都交给 curl：流式、能断点续传、Windows 自带 */
function curl(args) {
  const res = spawnSync('curl', args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  return res.status;
}

async function main() {
  console.log(`标签: ${tag}${dryRun ? '（dry-run，不实际上传）' : ''}`);

  // 1) GitCode 上必须已有该 release（CI 建的）；没有就提示先跑发版流程
  const rel = await api(`${GITCODE_API}/releases/tags/${tag}`);
  if (rel.status !== 200 || !rel.json?.tag_name) {
    console.error(`❌ GitCode 上没有 ${tag} 的 release（${rel.status}）：先推送该 tag 让 CI 建好，再跑本脚本`);
    process.exit(1);
  }
  const existing = new Map(
    (rel.json.assets || []).filter((a) => a.type === 'attach').map((a) => [a.name, a.id]),
  );
  console.log(`GitCode release 已存在，现有附件 ${existing.size} 个`);

  // 2) 要传哪些文件：以 GitHub release 的资产清单为准
  const gh = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`, {
    headers: { 'User-Agent': 'guada-upload', Accept: 'application/vnd.github+json' },
  });
  if (!gh.ok) {
    console.error(`❌ 读 GitHub release 失败：HTTP ${gh.status}`);
    process.exit(1);
  }
  const ghAssets = ((await gh.json()).assets || [])
    .filter((a) => UPLOAD_EXTS.some((e) => a.name.endsWith(e)))
    .filter((a) => {
      if (!skipArg) return true;
      const skipped = a.name.toLowerCase().includes(skipArg.toLowerCase());
      if (skipped) console.log(`跳过 ${a.name}（命中 --skip ${skipArg}）`);
      return !skipped;
    });
  if (!ghAssets.length) {
    console.error('❌ GitHub release 里没有可上传的 dmg/exe/blockmap/yml 资产');
    process.exit(1);
  }

  const workDir = dirArg ? path.resolve(dirArg) : path.join(os.tmpdir(), `guada-${tag}`);
  fs.mkdirSync(workDir, { recursive: true });
  console.log(`本地目录: ${workDir}`);

  // GitHub 会把资产名里的空格换成点（GuaDa Setup x.exe → GuaDa.Setup.x.exe），
  // 本地文件通常是带空格的原始名 —— 两种都认，按「去空格去点后同名 + 大小一致」匹配
  const norm = (n) => n.replace(/[.\s]+/g, '').toLowerCase();
  const findLocal = (asset) => {
    const exact = path.join(workDir, asset.name);
    if (fs.existsSync(exact) && fs.statSync(exact).size === asset.size) return exact;
    const hit = fs
      .readdirSync(workDir)
      .find(
        (f) =>
          f !== asset.name &&
          norm(f) === norm(asset.name) &&
          fs.statSync(path.join(workDir, f)).size === asset.size,
      );
    return hit ? path.join(workDir, hit) : null;
  };

  let uploaded = 0;
  const failed = [];
  for (const asset of ghAssets) {
    let local = findLocal(asset);
    if (!local) {
      const target = path.join(workDir, asset.name);
      console.log(`\n↓ 下载 ${asset.name}（${(asset.size / 1048576).toFixed(1)} MB）…`);
      if (dryRun) continue;
      const code = curl(['-L', '-C', '-', '--fail', '--progress-bar', '-o', target, asset.browser_download_url]);
      if (code !== 0) {
        console.error(`❌ 下载失败（curl exit ${code}）：${asset.name}`);
        failed.push(asset.name);
        continue; // 一个文件失败不挡住其余文件
      }
      local = target;
    } else {
      console.log(`\n✓ 本地已有 ${path.basename(local)}（${(fs.statSync(local).size / 1048576).toFixed(1)} MB）`);
    }

    // 以本地文件名为准（GitCode 保留空格，与历史发行版的命名一致）
    const uploadName = path.basename(local);
    const size = fs.statSync(local).size;
    const md5 = createHash('md5').update(fs.readFileSync(local)).digest('hex');
    console.log(`↑ 上传 ${uploadName}（${(size / 1048576).toFixed(1)} MB, md5 ${md5.slice(0, 8)}）…`);
    if (dryRun) continue;

    // 同名旧附件先删掉，重跑不累积重复
    const oldId = existing.get(uploadName);
    if (oldId) {
      const del = await api(`${GITCODE_API}/releases/${tag}/attach_files/${oldId}`, { method: 'DELETE' });
      console.log(`  删除同名旧附件 id=${oldId} → HTTP ${del.status}`);
    }

    const info = await api(
      `${GITCODE_API}/releases/${tag}/upload_url?file_name=${encodeURIComponent(uploadName)}`,
    );
    if (!info.json?.url) {
      console.error(`❌ 取上传地址失败：${info.status} ${info.text.slice(0, 200)}`);
      failed.push(uploadName);
      continue;
    }
    const headerArgs = Object.entries(info.json.headers || {}).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
    const respFile = path.join(os.tmpdir(), 'guada-upload-resp.txt');
    // --fail-with-body：HTTP 4xx/5xx 时退出码非 0，同时把响应体留在文件里便于诊断。
    // 注意 -w 的格式化输出走 stdout（不是 -o 的文件），所以成功与否看退出码，不看文件内容。
    const code = curl([
      '-s',
      '--fail-with-body',
      '-o',
      respFile,
      '-w',
      'HTTP %{http_code} | %{time_total}s | %{speed_upload} B/s',
      '-X',
      'PUT',
      ...headerArgs,
      '--data-binary',
      `@${local}`,
      info.json.url,
    ]);
    const resp = fs.existsSync(respFile) ? fs.readFileSync(respFile, 'utf8').trim() : '';
    if (resp) console.log(`  响应: ${resp.slice(0, 200)}`);
    if (code !== 0) {
      console.error(`❌ 上传失败：${uploadName}（curl exit ${code}）`);
      failed.push(uploadName);
      continue;
    }
    uploaded += 1;
  }

  // 3) 回读确认
  let attached = [];
  try {
    const after = await api(`${GITCODE_API}/releases/tags/${tag}`);
    attached = (after.json?.assets || []).filter((a) => a.type === 'attach');
  } catch (err) {
    console.error(`\n⚠️ 无法回读 GitCode 附件列表：${err.message}`);
    console.error(`   本次已上传 ${uploaded} 个，失败 ${failed.length} 个 —— 稍后到发行版页面确认即可`);
    process.exit(failed.length ? 1 : 0);
  }
  console.log(`\n=== GitCode ${tag} 附件（${attached.length} 个）===`);
  for (const a of attached) console.log(`  📦 ${a.name}`);

  const missing = ghAssets
    .map((a) => a.name)
    .filter((n) => !attached.some((a) => norm(a.name) === norm(n)));
  if (missing.length || failed.length) {
    console.error(`\n❌ 未就位：${[...new Set([...missing, ...failed])].join(', ')}`);
    process.exit(1);
  }
  console.log(`\n✅ 全部就位（本次上传 ${uploaded} 个）`);
}

await main();
