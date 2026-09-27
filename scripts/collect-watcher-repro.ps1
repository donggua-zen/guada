# 复现证据采集：逐模式跑 @parcel/watcher 崩溃复现，记录 Windows 真实退出码
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect-watcher-repro.ps1
$ErrorActionPreference = 'Continue'
$script:repo = Split-Path -Parent $PSScriptRoot
$watcherPkg = Join-Path $repo 'backend-ts\node_modules\@parcel\watcher\package.json'
Write-Host ("@parcel/watcher = " + (Get-Content $watcherPkg -Raw | ConvertFrom-Json).version)
Write-Host ("node = " + (node --version))
$native = Get-ChildItem (Join-Path $repo 'backend-ts\node_modules\.pnpm') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'watcher.win32*' -or $_.Name -like '*parcel+watcher*' } |
  Select-Object -ExpandProperty Name
Write-Host ("native 包 = " + ($native -join ', '))
Write-Host ''

function Invoke-Mode {
  param([string]$Mode, [string]$Arg, [int]$Times)
  for ($i = 1; $i -le $Times; $i++) {
    $out = & node (Join-Path $repo 'scripts\repro-parcel-watcher-crash.js') $Mode $Arg 2>&1
    $code = $LASTEXITCODE
    $u = [uint32]([int64]$code -band 0xFFFFFFFFL)
    $tail = ($out | Select-Object -Last 1)
    "{0,-11} run{1}  exit=0x{2:X8} ({3})  last: {4}" -f $Mode, $i, $u, $code, $tail
  }
}

Invoke-Mode -Mode 'churn' -Arg '3000' -Times 2
Invoke-Mode -Mode 'writeonly' -Arg '' -Times 2
Invoke-Mode -Mode 'churnwrite' -Arg '3000' -Times 5
