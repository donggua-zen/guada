<#
  Forensic watcher for the GuaDa backend child process.
  Finds the real backend node child (spawned by ts-node-dev / ts-node), samples its
  memory every N seconds, and prints the TERMINATION EXIT CODE when it disappears.

  The exit code is what distinguishes the three competing explanations:
    0xC0000005 access violation  -> native module crash
    0xC0000409 __fastfail         -> heap corruption / CRT abort / V8 OOM CHECK (WER logs nothing!)
    0xC00000FD                    -> stack overflow
    1                            -> our own process.exit(1) (main.ts logFatal)
    0                            -> process.exit(0) OR an external TerminateProcess (taskkill /F)

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-backend-exit.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-backend-exit.ps1 -ProcessId 9224
#>
param(
  [int]$ProcessId = -1,
  [int]$IntervalSec = 2,
  [string]$CsvPath = (Join-Path $env:TEMP ("backend-exit-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".csv"))
)

$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name ProcKillWatch -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern int WaitForSingleObject(IntPtr h, int ms);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern bool GetExitCodeProcess(IntPtr h, out int code);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern bool CloseHandle(IntPtr h);
'@

if ($ProcessId -lt 0) {
  $cand = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      ($_.CommandLine -match 'ts-node-dev\\lib\\wrap\.js') -or
      (($_.CommandLine -match 'backend-ts[/\\](src|dist)[/\\]main\.js') -and
       ($_.CommandLine -notmatch 'lib[/\\]bin\.js') -and ($_.CommandLine -notmatch 'npx-cli'))
    }
  if (-not $cand) { Write-Error "backend child not found"; exit 2 }
  $ProcessId = ($cand | Select-Object -First 1).ProcessId
}

$cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").CommandLine
Write-Host "watching PID=$ProcessId"
if ($cmd) { Write-Host ("  cmd=" + $cmd.Substring(0, [Math]::Min(140, $cmd.Length))) }
Write-Host "  csv=$CsvPath"

# SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
$h = [Win32.ProcKillWatch]::OpenProcess(0x101000, $false, $ProcessId)
if ($h -eq [IntPtr]::Zero) {
  Write-Error ("OpenProcess failed, GetLastError=" + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 3
}

$csvDir = Split-Path -Parent $CsvPath
if ($csvDir -and -not (Test-Path $csvDir)) { New-Item -ItemType Directory -Force -Path $csvDir | Out-Null }
"time,pid,workingsetMB,privateMB,handlecount,threadcount" | Set-Content -Path $CsvPath
$start = Get-Date
$lastPrintedWs = 0.0
$nextMark = 30

while ($true) {
  if ([Win32.ProcKillWatch]::WaitForSingleObject($h, $IntervalSec * 1000) -eq 0) { break }

  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $now = ((Get-Date) - $start).TotalSeconds
  $ws = $p.WorkingSet64 / 1MB
  if ($ws -gt ($lastPrintedWs + 30) -or [int]$now -ge $nextMark) {
    $lastPrintedWs = $ws
    $nextMark = ([int]$now + 30)
    "{0,7:N0}s  ws={1:N0}MB priv={2:N0}MB handles={3} threads={4}" -f `
      $now, $ws, ($p.PrivateMemorySize64 / 1MB), $p.HandleCount, $p.Threads.Count | Write-Host
  }
  "{0},{1},{2},{3},{4},{5}" -f (Get-Date -Format 'HH:mm:ss'), $ProcessId,
    [math]::Round($ws), [math]::Round($p.PrivateMemorySize64 / 1MB),
    $p.HandleCount, $p.Threads.Count | Add-Content -Path $CsvPath
  $p.Dispose()
}

$code = 0
[void][Win32.ProcKillWatch]::GetExitCodeProcess($h, [ref]$code)
[void][Win32.ProcKillWatch]::CloseHandle($h)

# 退出码是有符号 int（如 0xC0000005 报成 -1073741819），转成无符号 32 位再判定
$u = [uint32]([int64]$code -band 0xFFFFFFFFL)
Write-Host ""
Write-Host ("PID {0} EXITED after {1:N0}s   exitCode = {2} (0x{3:X8})" -f `
  $ProcessId, ((Get-Date) - $start).TotalSeconds, $code, $u)
switch ($u) {
  0xC0000005 { Write-Host "  -> ACCESS VIOLATION: native module crash (read the faulting module in a dump)" }
  0xC0000409 { Write-Host "  -> __fastfail: heap corruption / CRT abort / V8 OOM CHECK. Explains: no WER event, no log, no report." }
  0xC00000FD { Write-Host "  -> STACK OVERFLOW (runaway recursion)" }
  0xC000027A { Write-Host "  -> console closed (CTRL_CLOSE_EVENT) - the hosting terminal went away" }
  1          { Write-Host "  -> code 1 is AMBIGUOUS: either main.ts logFatal (check error-*.log for a '进程级' line at this second), or ts-node-dev's hot-reload/shutdown child.kill('SIGTERM') which on Windows is TerminateProcess -> 1" }
  0          { Write-Host "  -> exit code 0: graceful process.exit(0) (bridge shutdown) OR external taskkill /F (TerminateProcess passes 0). Judge by whether 'Bridge socket closed' was logged." }
  default    { Write-Host "  -> other (134 = SIGABRT/OOM abort)" }
}
Write-Host "  csv=$CsvPath"
