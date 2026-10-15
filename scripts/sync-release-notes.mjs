#!/usr/bin/env node
/**
 * 把「与官网 changelog 同源」的更新说明同步到三个平台的发行版正文。
 *
 * 为什么需要它：CI 建发行版时用的是 GitHub Release 正文（= 仓库里的 `docs/releases/<tag>.md`），
 * 三个平台靠 `publish-mirrors` 复制同一份。但事后补写说明、给旧版本补说明、或某个平台正文写歪了，
 * 都得能单独修 —— 这个脚本就是那把扳手（幂等，可重复跑）。
 *
 * 正文来源（按顺序）：
 *   1) 仓库 `docs/releases/v<版本>.md`（与 CI 完全一致）
 *   2) 官网 changelog（`../ai_web/backend/changelog.json`，用 `--changelog` 覆盖）里该版本的条目
 *
 * 各平台正文：
 *   - GitHub：说明本身（附件就在本页）
 *   - GitCode：说明 + GitHub 直链（GitCode 上也挂了二进制，直链方便对照）
 *   - Gitee：说明 + 官网下载页链接（Gitee 不放二进制：单附件上限 100M）
 *
 * 用法：
 *   node scripts/sync-release-notes.mjs <ghPat> <gitcodeToken> <giteeToken> <版本...>
 *   node scripts/sync-release-notes.mjs ... 1.0.4 1.0.3 --changelog D:/AI/ai_web/backend/changelog.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const changelogArg = args.includes('--changelog') ? args[args.indexOf('--changelog') + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--changelog');
const [ghPat, gcToken, giteeToken, ...versions] = positional;

if (!ghPat || !gcToken || !giteeToken || !versions.length) {
  console.error('用法: node scripts/sync-release-notes.mjs <ghPat> <gitcodeToken> <giteeToken> <版本...>');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = changelogArg ?? path.resolve(repoRoot, '..', 'ai_web', 'backend', 'changelog.json');
const GH_REPO = 'donggua-zen/guada';
const GC_REPO = 'donggua_sherlock/GuaDaAI';
const GITEE_REPO = 'zhendongdong/guada_ai';
const WEBSITE = 'https://ai.dingd.cn/download';

const changelog = fs.existsSync(CHANGELOG)
  ? JSON.parse(fs.readFileSync(CHANGELOG, 'utf8'))
  : { versions: [] };
const byVersion = new Map(changelog.versions.map((v) => [v.version, v]));

function notesFor(version) {
  const file = path.join(repoRoot, 'docs', 'releases', `v${version}.md`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trimEnd();
  const entry = byVersion.get(version);
  if (!entry) throw new Error(`既没有 ${file}，官网 changelog（${CHANGELOG}）里也没有 ${version}`);
  const lines = ['## 更新内容', ''];
  for (const s of entry.sections) {
    lines.push(`### ${s.title}`, '');
    for (const it of s.items) lines.push(`- ${it}`);
    lines.push('');
  }
  lines.push('## 下载', '', `- 官网下载页：<${WEBSITE}>`);
  return lines.join('\n');
}

const ghHeaders = {
  Authorization: `Bearer ${ghPat}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'guada-notes',
};
const gcHeaders = { Authorization: `Bearer ${gcToken}`, 'Content-Type': 'application/json' };

// Gitee 的「最新版」标记 = 最近创建的那个发行版，列表也按创建时间倒序 —— 所以补历史版本时
// **必须从旧到新**创建，否则最后建的那个旧版本会被顶成「最新版」（1.0.2/1.0.3/1.0.4 踩过）。
// 这里统一按版本号升序处理，与传参顺序无关。
const ordered = [...versions].sort((a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
});
if (ordered.join(',') !== versions.join(',')) {
  console.log(`（按版本升序处理：${ordered.join(' → ')} —— Gitee 最新版看创建时间）`);
}

for (const version of ordered) {
  const tag = `v${version}`;
  const notes = notesFor(version);
  console.log(`\n===== ${tag} =====`);

  // 1) GitHub：正文 = 说明
  const ghRes = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/tags/${tag}`, {
    headers: ghHeaders,
  });
  const gh = ghRes.ok ? await ghRes.json() : null;
  if (gh) {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/${gh.id}`, {
      method: 'PATCH',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: notes }),
    });
    console.log(`GitHub  PATCH -> ${r.status}${r.ok ? '' : ' ' + (await r.text()).slice(0, 160)}`);
  } else {
    console.log(`GitHub  ${tag} 不存在，跳过`);
  }

  // 2) GitCode：正文 = 说明 + GitHub 直链
  const links = (gh?.assets ?? [])
    .filter((a) => a.name.endsWith('.dmg') || a.name.endsWith('.exe'))
    .map((a) => `- ${a.name}（${Math.floor(a.size / 1048576)} MB）：${a.browser_download_url}`);
  const gcBody = [notes, '', '---', '', '### GitHub 直链', '', ...links].join('\n');
  const gcGet = await fetch(`https://api.gitcode.com/api/v5/repos/${GC_REPO}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${gcToken}` },
  });
  if (gcGet.ok) {
    const r = await fetch(`https://api.gitcode.com/api/v5/repos/${GC_REPO}/releases/${tag}`, {
      method: 'PATCH',
      headers: gcHeaders,
      body: JSON.stringify({ tag_name: tag, name: tag, body: gcBody }),
    });
    console.log(`GitCode PATCH -> ${r.status}${r.ok ? '' : ' ' + (await r.text()).slice(0, 160)}`);
  } else {
    console.log(`GitCode ${tag} 不存在，跳过（${gcGet.status}）`);
  }

  // 3) Gitee：正文 = 说明 + 官网下载页（不附二进制、不列 GitHub 直链）
  const giteeBody = [
    notes,
    '',
    '---',
    '',
    `> 本页不附安装包（Gitee 单附件上限 100M，安装包 200M+ 放不进去）。下载请走官网下载页：<${WEBSITE}>`,
  ].join('\n');
  const listRes = await fetch(
    `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/tags/${tag}?access_token=${giteeToken}`,
  );
  const existing = listRes.ok ? await listRes.json() : null;
  const payload = {
    tag_name: tag,
    name: tag,
    body: giteeBody,
    target_commitish: gh?.target_commitish,
    prerelease: false,
    access_token: giteeToken,
  };
  if (existing?.id) {
    const r = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`Gitee   PATCH -> ${r.status}`);
  } else {
    const r = await fetch(`https://gitee.com/api/v5/repos/${GITEE_REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`Gitee   POST -> ${r.status}${r.ok ? ' 已创建' : ' ' + (await r.text()).slice(0, 200)}`);
  }
}
