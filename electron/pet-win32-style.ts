/**
 * Windows 专用：给窗口打 `WS_EX_NOACTIVATE` 扩展样式。
 *
 * 为什么需要它：
 *   桌宠窗口必须 `focusable: true`，否则 Electron 会同时关掉 Chromium 的
 *   可激活标志，导致两个致命后果（实测）：
 *     ① `setIgnoreMouseEvents(true, { forward: true })` 的 mousemove 转发
 *        完全失效（渲染层收到 0 个 mousemove）—— 命中心跳通道死掉，
 *        光标进入宠物时无法自动放开穿透，只能靠主进程算 bbox，
 *        一旦有偏差就永久穿透、拖不动。
 *     ② Windows 在 WM_MOUSEACTIVATE 返回 MA_NOACTIVATEANDEAT 吃掉 mousedown。
 *
 *   但 `focusable: true` 又会让点击抢走前台窗口（用户打字时被抢焦点），
 *   所以用 `WS_EX_NOACTIVATE`：系统层不激活窗口，但 Chromium 层保持可激活。
 *   这是 dsh-pet PR #142 验证过的组合。
 *
 * 实现：把 Add-Type 定义缓存成一次性 PowerShell 脚本，只在建窗时调用一次。
 * 失败不致命（退化为可抢焦点，但至少拖动可用）。
 */
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";

const GWL_EXSTYLE = -20;
const WS_EX_NOACTIVATE = 0x0800_0000;

/** 已生成过的脚本路径（一次性编译，之后复用） */
let scriptPath: string | null = null;

function ensureScript(): string | null {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const file = path.join(os.tmpdir(), "guada-pet-noactivate.ps1");
  // 纯 ASCII：Windows PowerShell 5.1 读取无 BOM 的 UTF-8 时中文会乱码，
  // 导致 ParserError。这里只写英文注释，彻底规避编码问题。
  const src = `# GuaDa pet: apply WS_EX_NOACTIVATE to the pet window (win32 only)
if (-not ('GuadaNoActivate.Native' -as [type])) {
  $code = @"
using System;
using System.Runtime.InteropServices;
namespace GuadaNoActivate {
  public class Native {
    [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int idx);
    [DllImport("user32.dll")] public static extern int SetWindowLongW(IntPtr h, int idx, int val);
  }
}
"@
  Add-Type -TypeDefinition $code
}
$hwnd = [IntPtr]::new([Int64]$env:GUADA_PET_HWND)
$ex = [GuadaNoActivate.Native]::GetWindowLongW($hwnd, ${GWL_EXSTYLE})
if ($ex -eq 0) { Write-Output "read_fail"; exit 0 }
[void][GuadaNoActivate.Native]::SetWindowLongW($hwnd, ${GWL_EXSTYLE}, ($ex -bor ${WS_EX_NOACTIVATE}))
$check = [GuadaNoActivate.Native]::GetWindowLongW($hwnd, ${GWL_EXSTYLE})
if (($check -band ${WS_EX_NOACTIVATE}) -ne 0) { Write-Output "ok" } else { Write-Output "set_fail" }
`;
  try {
    fs.writeFileSync(file, src, "utf8");
    scriptPath = file;
    return file;
  } catch (error) {
    log.warn("[pet] 生成 no-activate 脚本失败:", error);
    return null;
  }
}

/**
 * 给指定窗口应用 WS_EX_NOACTIVATE（仅 win32 生效）。
 *
 * @param nativeHandle `win.getNativeWindowHandle()` 的返回值
 */
export function applyNoActivate(nativeHandle: Buffer | null | undefined): void {
  if (process.platform !== "win32") return;
  if (!nativeHandle || nativeHandle.length < 4) return;

  const hwnd =
    nativeHandle.length >= 8
      ? nativeHandle.readBigUInt64LE(0).toString()
      : String(nativeHandle.readUInt32LE(0));

  const script = ensureScript();
  if (!script) return;

  // 异步执行：不阻塞建窗，失败也只是退化为「可抢焦点」
  execFile(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      env: { ...process.env, GUADA_PET_HWND: hwnd },
      timeout: 20_000,
      windowsHide: true,
    },
    (error, stdout) => {
      if (error) {
        log.warn("[pet] WS_EX_NOACTIVATE 设置失败（不影响拖动）:", error.message);
        return;
      }
      const out = String(stdout).trim();
      if (out === "ok") log.info("[pet] 已应用 WS_EX_NOACTIVATE（点击不抢焦点）");
      else log.warn(`[pet] WS_EX_NOACTIVATE 未生效: ${out}`);
    },
  );
}
