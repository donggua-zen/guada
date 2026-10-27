#!/usr/bin/env node
/**
 * 清理 Windows 沙盒后端留下的授权残留。
 *
 * 背景：Windows 上旧的 sandbox.exe 后端会给每个工作区目录写入一条常驻 ACE
 * （v1.3.0 起是确定性能力 SID `S-1-4-x-y`，更早版本是每次随机的 `S-1-5-10-x-y-z-w`），
 * 并在工作区里留下隐藏目录 `<workspace>\.sandbox\`（内含 acl.lock）。Windows 已停用该后端，
 * 这些残留对用户目录 ACL 审计没有意义，本脚本负责移除。
 *
 * 用法：
 *   node scripts/cleanup-sandbox-grants.mjs --workspace <dir> [--workspace <dir> ...]
 *   node scripts/cleanup-sandbox-grants.mjs --db "%USERPROFILE%\.guada\sessions\_meta.db"
 *   node scripts/cleanup-sandbox-grants.mjs --workspace <dir> --apply
 *
 * 默认 **dry-run**：只报告将删除哪些 ACE / 目录；加 `--apply` 才真正修改。
 * 仅删「非继承」且 SID 前缀为 S-1-4- / S-1-5-10- 的 ACE——不动任何用户/系统授权。
 *
 * 需要 Node ≥ 22.5（用内置 node:sqlite 从会话库发现工作区；未提供 --db 时不需要）。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const workspaces = [];
let dbPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workspace" && args[i + 1]) workspaces.push(args[++i]);
  else if (args[i] === "--db" && args[i + 1]) dbPath = args[++i];
}

if (process.platform !== "win32") {
  console.log("此脚本只处理 Windows 上的沙盒残留，当前平台无需运行。");
  process.exit(0);
}

/** 从会话库中发现工作区目录（可选） */
async function discoverFromDb(dbFile) {
  const found = [];
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile, { readOnly: true });
    // 新布局：sessions/_meta.db 的 sessions 表；旧布局：Prisma 主库的 session 表
    let rows;
    try {
      rows = db.prepare("SELECT DISTINCT workspace_path AS p FROM sessions WHERE workspace_path IS NOT NULL").all();
    } catch {
      rows = db.prepare("SELECT DISTINCT workspace_path AS p FROM session WHERE workspace_path IS NOT NULL").all();
    }
    for (const row of rows) if (row.p) found.push(row.p);
    db.close();
  } catch (error) {
    console.warn(`[warn] 无法从会话库读取工作区（${error.message}），改用 --workspace 显式指定`);
  }
  return found;
}

/** 需要清理的 SID 前缀 */
const SANDBOX_SID_PATTERN = "^S-1-(4-[0-9]+-[0-9]+$|5-10-)";

function cleanWorkspace(workspace) {
  if (!fs.existsSync(workspace)) {
    console.log(`[skip] 不存在: ${workspace}`);
    return;
  }

  // 1) 移除常驻 ACE（只动非继承、且 SID 命中沙盒命名空间的条目）
  // 路径经环境变量传入（-Command 的尾随参数不会绑定到 $args），输出强制 UTF-8 避免中文乱码
  const script = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$path = $env:GUADA_CLEANUP_PATH
$apply = $env:GUADA_CLEANUP_APPLY -eq '1'
$acl = Get-Acl -LiteralPath $path
$removed = @()
foreach ($ace in @($acl.Access)) {
  $sid = $ace.IdentityReference.Value
  if (-not $ace.IsInherited -and $sid -match '${SANDBOX_SID_PATTERN}') {
    $removed += "$sid ($($ace.FileSystemRights))"
    if ($apply) { [void]$acl.RemoveAccessRule($ace) }
  }
}
if ($removed.Count -gt 0 -and $apply) { Set-Acl -LiteralPath $path -AclObject $acl }
if ($removed.Count -gt 0) {
  Write-Output ("ACE: " + ($removed -join '; '))
} else {
  Write-Output "ACE: (none)"
}
$sandboxDir = Join-Path $path '.sandbox'
if (Test-Path -LiteralPath $sandboxDir) {
  $entries = Get-ChildItem -LiteralPath $sandboxDir -Force | ForEach-Object { $_.Name }
  $onlyLocks = ($entries | Where-Object { $_ -ne 'acl.lock' }).Count -eq 0
  if (-not $onlyLocks) {
    Write-Output (".sandbox: 含非锁文件（" + ($entries -join ', ') + "），保留不动")
  } elseif ($apply) {
    Remove-Item -LiteralPath $sandboxDir -Recurse -Force
    Write-Output "已删除 .sandbox 目录"
  } else {
    Write-Output "将删除 .sandbox 目录"
  }
}
`;
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GUADA_CLEANUP_PATH: workspace,
          GUADA_CLEANUP_APPLY: apply ? "1" : "0",
        },
      },
    ).trim();
    console.log(`[${apply ? "apply" : "dry  "}] ${workspace}`);
    for (const line of out.split(/\r?\n/)) console.log(`        ${line}`);
  } catch (error) {
    console.warn(`[warn] ACL 处理失败: ${workspace} — ${String(error.stderr || error.message).trim()}`);
  }
}

const targets = new Set(workspaces.map((p) => path.resolve(p)));
if (dbPath) {
  for (const p of await discoverFromDb(dbPath)) targets.add(path.resolve(p));
}

if (targets.size === 0) {
  console.log("没有目标工作区。用 --workspace <dir> 指定，或用 --db <会话库> 自动发现。");
  process.exit(0);
}

console.log(`${apply ? "执行清理" : "dry-run（加 --apply 才会真正修改）"}，共 ${targets.size} 个工作区`);
for (const workspace of targets) cleanWorkspace(workspace);
