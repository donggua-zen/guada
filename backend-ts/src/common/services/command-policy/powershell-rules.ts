/**
 * 命令策略：PowerShell 侧只读白名单。
 *
 * 判定顺序：
 *   1. 别名解析（ls → Get-ChildItem、rm → Remove-Item、curl → Invoke-WebRequest…）
 *   2. 只读 cmdlet 表（`allowAnyArgs`，仅拦会挂住会话或写盘的具体参数）
 *   3. 已知写/危险 cmdlet → unsafe
 *   4. 非 cmdlet 名称（git/npm/rg 等外部程序）→ 回落 POSIX 表（PowerShell 只是转交执行）
 *   5. 其余 → unknown
 *
 * 注意：PowerShell 允许参数前缀缩写（-Rec 等价 -Recurse）。本表的放行/拦截都建立在
 * cmdlet 粒度上、只对少数"具体参数"做拦截，因此缩写不会把只读 cmdlet 变成写操作；
 * 真正危险的动作（写盘、起进程、改系统）都由整条 cmdlet 拦截。
 */

import { scanCommand } from "./scan";
import { evaluatePosixArgv } from "./posix-rules";
import type { DialectAnalysis, DialectVerdict } from "./types";

/** PowerShell 默认别名 → 规范 cmdlet 名（只列常用的） */
const PS_ALIASES: Record<string, string> = {
  // 读取
  cat: "Get-Content",
  gc: "Get-Content",
  type: "Get-Content",
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gci: "Get-ChildItem",
  gi: "Get-Item",
  gp: "Get-ItemProperty",
  gpv: "Get-ItemPropertyValue",
  gl: "Get-Location",
  pwd: "Get-Location",
  cd: "Set-Location",
  chdir: "Set-Location",
  sl: "Set-Location",
  echo: "Write-Output",
  write: "Write-Output",
  sls: "Select-String",
  select: "Select-Object",
  where: "Where-Object",
  "?": "Where-Object",
  foreach: "ForEach-Object",
  "%": "ForEach-Object",
  measure: "Measure-Object",
  compare: "Compare-Object",
  diff: "Compare-Object",
  group: "Group-Object",
  sort: "Sort-Object",
  ft: "Format-Table",
  fl: "Format-List",
  fw: "Format-Wide",
  fc: "Format-Custom",
  gu: "Get-Unique",
  gv: "Get-Variable",
  ps: "Get-Process",
  gps: "Get-Process",
  gsv: "Get-Service",
  gal: "Get-Alias",
  gcm: "Get-Command",
  gm: "Get-Member",
  h: "Get-Help",
  man: "Get-Help",
  help: "Get-Help",
  history: "Get-History",
  ghy: "Get-History",
  oh: "Out-Host",
  sleep: "Start-Sleep",
  // 写/危险（别名同样拦截）
  rm: "Remove-Item",
  del: "Remove-Item",
  erase: "Remove-Item",
  rd: "Remove-Item",
  rmdir: "Remove-Item",
  ri: "Remove-Item",
  rp: "Remove-ItemProperty",
  mv: "Move-Item",
  move: "Move-Item",
  mi: "Move-Item",
  mp: "Move-ItemProperty",
  cp: "Copy-Item",
  copy: "Copy-Item",
  cpi: "Copy-Item",
  ren: "Rename-Item",
  rni: "Rename-Item",
  ni: "New-Item",
  md: "New-Item",
  mkdir: "New-Item",
  sc: "Set-Content",
  ac: "Add-Content",
  clc: "Clear-Content",
  si: "Set-Item",
  sp: "Set-ItemProperty",
  sv: "Set-Variable",
  set: "Set-Variable",
  rv: "Remove-Variable",
  clv: "Clear-Variable",
  tee: "Tee-Object",
  kill: "Stop-Process",
  spps: "Stop-Process",
  sajb: "Start-Job",
  start: "Start-Process",
  saps: "Start-Process",
  iex: "Invoke-Expression",
  icm: "Invoke-Command",
  iwr: "Invoke-WebRequest",
  irm: "Invoke-RestMethod",
  curl: "Invoke-WebRequest",
  wget: "Invoke-WebRequest",
  ii: "Invoke-Item",
  rdr: "Remove-PSDrive",
  ndr: "New-PSDrive",
  mount: "New-PSDrive",
};

/** 只读 cmdlet：只列"带具体写/阻塞参数需要额外拦截"的；其余按 allowAnyArgs 放行 */
const PS_READONLY_CMDLETS: Record<string, { forbidden?: readonly string[] }> = {
  "Get-ChildItem": {},
  "Get-Content": { forbidden: ["-Wait"] },
  "Get-Item": {},
  "Get-ItemProperty": {},
  "Get-ItemPropertyValue": {},
  "Get-Location": {},
  "Get-Date": {},
  "Get-Command": {},
  "Get-Help": {},
  "Get-Member": {},
  "Get-FileHash": {},
  "Get-Process": {},
  "Get-Service": {},
  "Get-Variable": {},
  "Get-Alias": {},
  "Get-History": {},
  "Get-PSDrive": {},
  "Get-Unique": {},
  "Get-CimInstance": {},
  "Get-WmiObject": {},
  "Get-EventLog": {},
  "Get-WinEvent": {},
  "Get-Acl": {},
  "Get-AuthenticodeSignature": {},
  "Get-ComputerInfo": {},
  "Get-Host": {},
  "Get-Culture": {},
  "Get-TimeZone": {},
  "Test-Path": {},
  "Resolve-Path": {},
  "Convert-Path": {},
  "Split-Path": {},
  "Join-Path": {},
  "Select-String": {},
  "Select-Object": {},
  "Sort-Object": {},
  "Measure-Object": {},
  "Compare-Object": {},
  "Group-Object": {},
  "Format-Table": {},
  "Format-List": {},
  "Format-Wide": {},
  "Format-Custom": {},
  "Out-String": {},
  "Out-Host": {},
  "Write-Output": {},
  "Write-Host": {},
  "Write-Verbose": {},
  "Write-Warning": {},
  "Write-Information": {},
  "ConvertTo-Json": {},
  "ConvertFrom-Json": {},
  "ConvertTo-Csv": {},
  "ConvertFrom-Csv": {},
  "ConvertTo-Html": {},
  "Start-Sleep": {},
  "Set-Location": {},
  "Test-Connection": {},
  "Where-Object": {},
  "ForEach-Object": {},
};

/** 已知写/危险 cmdlet：命中即 unsafe */
const PS_UNSAFE_CMDLETS: ReadonlySet<string> = new Set([
  "Remove-Item",
  "Remove-ItemProperty",
  "Remove-Variable",
  "Remove-Module",
  "Remove-PSDrive",
  "Remove-Job",
  "Clear-Content",
  "Clear-Item",
  "Clear-ItemProperty",
  "Clear-Variable",
  "Set-Content",
  "Add-Content",
  "Set-Item",
  "Set-ItemProperty",
  "Set-Variable",
  "Set-Acl",
  "Set-AuthenticodeSignature",
  "Set-ExecutionPolicy",
  "Set-Service",
  "Set-Date",
  "Set-TimeZone",
  "Set-Culture",
  "Set-History",
  "Add-History",
  "New-Item",
  "New-ItemProperty",
  "New-PSDrive",
  "New-Service",
  "New-ScheduledTask",
  "New-LocalUser",
  "New-SmbShare",
  "New-Variable",
  "New-Alias",
  "Set-Alias",
  "Move-Item",
  "Move-ItemProperty",
  "Copy-Item",
  "Copy-ItemProperty",
  "Rename-Item",
  "Rename-ItemProperty",
  "Out-File",
  "Out-Printer",
  "Out-GridView",
  "Tee-Object",
  "Export-Csv",
  "Export-Clixml",
  "Export-Alias",
  "Export-PSSession",
  "Import-Module",
  "Import-Csv",
  "Import-Clixml",
  "Start-Process",
  "Start-Job",
  "Start-Service",
  "Stop-Process",
  "Stop-Job",
  "Stop-Service",
  "Restart-Service",
  "Restart-Computer",
  "Stop-Computer",
  "Suspend-Job",
  "Resume-Job",
  "Invoke-Command",
  "Invoke-Expression",
  "Invoke-Item",
  "Invoke-WebRequest",
  "Invoke-RestMethod",
  "Invoke-WmiMethod",
  "Register-ScheduledTask",
  "Unregister-ScheduledTask",
  "Register-ObjectEvent",
  "Register-EngineEvent",
  "Mount-DiskImage",
  "Dismount-DiskImage",
  "Format-Volume",
  "Write-EventLog",
  "Clear-EventLog",
  "Remove-EventLog",
  "Add-LocalGroupMember",
  "Remove-LocalGroupMember",
  "Add-Computer",
  "Remove-Computer",
  "Set-WmiInstance",
  "Remove-WmiObject",
  "Enable-PSRemoting",
  "Disable-PSRemoting",
  "Enter-PSSession",
  "Exit-PSSession",
  "New-PSSession",
  "Remove-PSSession",
  "Import-PSSession",
  "Get-Credential",
]);

function basename(token: string): string {
  const trimmed = token.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return base.toLowerCase().endsWith(".exe") ? base.slice(0, -4) : base;
}

function resolveCommandName(token: string): { canonical: string; fromAlias: boolean } {
  const base = basename(token);
  // 别名大小写不敏感；规范名保留原表写法
  const aliasKey = Object.keys(PS_ALIASES).find(
    (alias) => alias.toLowerCase() === base.toLowerCase(),
  );
  if (aliasKey) return { canonical: PS_ALIASES[aliasKey], fromAlias: true };

  const canonicalKey = [...new Set([...Object.keys(PS_READONLY_CMDLETS), ...PS_UNSAFE_CMDLETS])].find(
    (name) => name.toLowerCase() === base.toLowerCase(),
  );
  return { canonical: canonicalKey ?? base, fromAlias: false };
}

/**
 * 内置只读名单条目（供默认策略物化 / 漂移测试）：只读 cmdlet + 解析到它们的别名。
 * 别名必须列出，否则用户在配置里删/留 `ls` 时行为会与 PowerShell 的实际执行不一致。
 */
export function powershellReadOnlyEntries(): string[] {
  const entries = new Set<string>(Object.keys(PS_READONLY_CMDLETS));
  for (const [alias, canonical] of Object.entries(PS_ALIASES)) {
    if (PS_READONLY_CMDLETS[canonical]) entries.add(alias);
  }
  return [...entries].sort();
}

/**
 * 以 PowerShell 语义判定整条命令。
 */
export function analyzePowerShellCommand(command: string): DialectAnalysis {
  const { segments, problems } = scanCommand(command, "powershell");
  const reasons = problems.map((p) => p.detail);
  const offending = problems.map((p) => p.detail);

  if (problems.some((p) => p.code === "write-redirect")) {
    return { verdict: "unsafe", reasons, offending };
  }
  if (problems.length > 0) {
    return { verdict: "unknown", reasons, offending };
  }
  if (segments.length === 0) {
    // 纯注释 / 纯空白的命令是无副作用的空操作
    return { verdict: "read-only", reasons: ["comments/whitespace only (no-op)"], offending: [] };
  }

  let worst: DialectVerdict = "read-only";
  for (const segment of segments) {
    const argv = segment.tokens.map((t) => t.text);
    const head = argv[0];
    if (!head) {
      reasons.push("empty command segment");
      offending.push(segment.text);
      worst = "unknown";
      continue;
    }

    const { canonical, fromAlias } = resolveCommandName(head);
    const args = argv.slice(1);

    const readonly = Object.keys(PS_READONLY_CMDLETS).find(
      (name) => name.toLowerCase() === canonical.toLowerCase(),
    );
    const unsafe = [...PS_UNSAFE_CMDLETS].find(
      (name) => name.toLowerCase() === canonical.toLowerCase(),
    );

    if (unsafe) {
      reasons.push(`${canonical}: write/dangerous cmdlet`);
      offending.push(segment.text);
      return { verdict: "unsafe", reasons, offending };
    }

    if (readonly) {
      const forbidden = PS_READONLY_CMDLETS[readonly]?.forbidden;
      if (forbidden) {
        const hit = args.find((arg) => forbidden.includes(arg));
        if (hit) {
          reasons.push(`${canonical}: dangerous/blocking parameter ${hit}`);
          offending.push(segment.text);
          return { verdict: "unsafe", reasons, offending };
        }
      }
      continue;
    }

    if (fromAlias) {
      // 别名解析后仍不认识 → 按未知处理（不应发生，保险）
      reasons.push(`${canonical}: unknown alias target`);
      offending.push(segment.text);
      worst = "unknown";
      continue;
    }

    // 非 cmdlet：外部程序，按 POSIX 表判定（PowerShell 只是转交执行）
    const fallback = evaluatePosixArgv(argv);
    if (fallback.verdict === "unsafe") {
      reasons.push(`external command ${basename(head)}: ${fallback.reason || "write/dangerous"}`);
      offending.push(segment.text);
      return { verdict: "unsafe", reasons, offending };
    }
    if (fallback.verdict === "unknown") {
      reasons.push(`external command ${basename(head)}: ${fallback.reason || "not in the read-only allowlist"}`);
      offending.push(segment.text);
      worst = "unknown";
    }
  }

  return { verdict: worst, reasons, offending };
}
