/**
 * Windows shell 探测（纯 fs，零子进程）。
 *
 * 优先级（形状对齐 zcode 的 bash-shell-provider，兜底改为 PowerShell）：
 *   0. GUADA_SHELL 显式覆盖（用户手动指定，限定可识别的 shell 名）
 *   1. Git Bash 固定安装路径
 *   2. 由 PATH 中的 git.exe 反推（Git\cmd\git.exe / Git\mingw64\bin\git.exe 两种布局）
 *   3. PowerShell：POWERSHELL env → %SystemRoot%\System32\WindowsPowerShell\v1.0 → PATH
 *   4. cmd.exe
 *
 * 全程只做 fs 存在性检查，不启动任何子进程（避免控制台窗口闪现）。
 * 本模块不依赖 Nest DI：检测逻辑以 (env, exists) 入参形式暴露，便于单测注入。
 */

import * as fsSync from "node:fs";
import { win32 } from "node:path";

export type ShellKind = "powershell" | "cmd" | "gitbash" | "sh";

export interface ShellResolution {
  kind: ShellKind;
  path: string;
  /** 命中的层级（写进日志，便于线上排查"为什么走了这个壳"） */
  source: string;
}

/** Git for Windows 的默认安装位置，顺序即优先级 */
export const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
] as const;

const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

export type ExistsCheck = (candidate: string) => boolean;

function defaultExists(candidate: string): boolean {
  try {
    return fsSync.existsSync(candidate);
  } catch {
    return false;
  }
}

/** 大小写不敏感地读取环境变量（Windows 上 PATH / Path 都可能出现） */
export function envValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const lower = key.toLowerCase();
  const match = Object.keys(env).find((k) => k.toLowerCase() === lower);
  return match ? env[match] : undefined;
}

/**
 * PATH 各目录 × PATHEXT 展开可执行文件候选。
 * 顺序：裸名优先，然后按 PATHEXT 的小写扩展名（与 zcode windowsExecutableCandidates 一致）。
 */
export function pathExecutableCandidates(
  file: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const exts = (envValue(env, "PATHEXT") ?? DEFAULT_PATHEXT.join(";"))
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  const names = win32.extname(file)
    ? [file]
    : [file, ...exts.map((ext) => `${file}${ext.toLowerCase()}`)];
  const dirs = (envValue(env, "PATH") ?? "")
    .split(win32.delimiter)
    .map((dir) => dir.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  return dirs.flatMap((dir) => names.map((name) => win32.join(dir, name)));
}

function findFirst(
  candidates: readonly string[],
  exists: ExistsCheck,
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Git Bash 探测：固定安装路径 → 由 git.exe 反推。
 *
 * Git for Windows 的两种常见布局：
 *   C:\Program Files\Git\cmd\git.exe          → ..\bin\bash.exe
 *   C:\Program Files\Git\mingw64\bin\git.exe  → ..\..\bin\bash.exe
 */
function resolveGitBash(
  env: NodeJS.ProcessEnv,
  exists: ExistsCheck,
): { path: string; source: string } | null {
  const fixed = findFirst(WINDOWS_GIT_BASH_PATHS, exists);
  if (fixed) {
    return { path: fixed, source: "Git Bash (default install path)" };
  }

  const gitExe = findFirst(pathExecutableCandidates("git", env), exists);
  if (!gitExe) return null;

  const gitDir = win32.dirname(gitExe);
  const inferred = [
    win32.normalize(win32.join(gitDir, "..", "bin", "bash.exe")),
    win32.normalize(win32.join(gitDir, "..", "..", "bin", "bash.exe")),
  ];
  const bash = findFirst(inferred, exists);
  return bash
    ? { path: bash, source: `Git Bash (inferred from ${gitExe})` }
    : null;
}

function resolvePowerShell(
  env: NodeJS.ProcessEnv,
  exists: ExistsCheck,
): { path: string; source: string } | null {
  const fromEnv = envValue(env, "POWERSHELL");
  if (fromEnv && exists(fromEnv)) {
    return { path: fromEnv, source: "PowerShell (POWERSHELL env)" };
  }

  const systemPs = win32.join(
    envValue(env, "SystemRoot") || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (exists(systemPs)) {
    return { path: systemPs, source: "PowerShell (system)" };
  }

  const fromPath = findFirst(
    pathExecutableCandidates("powershell.exe", env),
    exists,
  );
  return fromPath ? { path: fromPath, source: "PowerShell (PATH)" } : null;
}

/**
 * GUADA_SHELL 显式覆盖：只接受能识别的 shell 名（bash/zsh/sh、powershell/pwsh、cmd），
 * 其余（含路径不存在）返回 null → 调用方记录告警并按自动探测继续。
 */
export function classifyShellOverride(
  shellPath: string | undefined,
  exists: ExistsCheck,
): ShellResolution | null {
  if (!shellPath || !exists(shellPath)) return null;
  const name = win32.basename(shellPath).toLowerCase();

  if (name.includes("powershell") || name.includes("pwsh")) {
    return { kind: "powershell", path: shellPath, source: "GUADA_SHELL override" };
  }
  if (name.includes("bash") || name.includes("zsh") || name.includes("sh.exe")) {
    return { kind: "gitbash", path: shellPath, source: "GUADA_SHELL override" };
  }
  if (name.includes("cmd")) {
    return { kind: "cmd", path: shellPath, source: "GUADA_SHELL override" };
  }
  return null;
}

/** 解析 Windows 上应使用的 shell（见文件头优先级） */
export function resolveWindowsShell(options: {
  env: NodeJS.ProcessEnv;
  exists?: ExistsCheck;
}): ShellResolution {
  const exists = options.exists ?? defaultExists;

  const override = classifyShellOverride(
    envValue(options.env, "GUADA_SHELL"),
    exists,
  );
  if (override) return override;

  const gitBash = resolveGitBash(options.env, exists);
  if (gitBash) {
    return { kind: "gitbash", path: gitBash.path, source: gitBash.source };
  }

  const powershell = resolvePowerShell(options.env, exists);
  if (powershell) {
    return {
      kind: "powershell",
      path: powershell.path,
      source: powershell.source,
    };
  }

  return { kind: "cmd", path: "", source: "cmd.exe (no PowerShell found)" };
}
