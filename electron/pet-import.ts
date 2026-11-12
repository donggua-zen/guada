/**
 * 桌宠形象导入（Electron 侧）：弹窗、跑 npx、开目录。
 *
 * 校验与复制的确定性逻辑在 `pet-import-core.ts`（纯 node，可单测）。
 */
import { app, dialog, shell } from "electron";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import {
  importPetDir,
  type PetImportResult,
} from "./pet-import-core";

/** Petdex 安装超时：首次 `npx` 可能要先下载包 */
const PETDEX_TIMEOUT_MS = 120_000;

/** 弹目录选择框并导入 */
export async function importPetFromDialog(destRoot: string): Promise<PetImportResult> {
  const picked = await dialog.showOpenDialog({
    title: "选择桌宠素材目录（含 pet.json 或 manifest.json）",
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false, error: "已取消" };
  }
  const result = importPetDir(picked.filePaths[0], destRoot);
  if (result.ok) log.info(`[pet] 已导入形象 ${result.id} ← ${picked.filePaths[0]}`);
  return result;
}

/** Petdex 下载目录（新旧两版路径都认） */
function petdexCandidates(slug: string): string[] {
  const home = app.getPath("home");
  return [
    path.join(home, ".petdex", "pets", slug),
    path.join(home, ".codex", "pets", slug),
  ];
}

/**
 * 执行 `npx petdex install <slug>`。
 *
 * Windows 坑：Node 20+ 不允许 execFile 直接启动 `.cmd`/`.bat`（会抛 `spawn EINVAL`
 * —— CVE-2024-27980 之后的加固），必须显式经 `cmd.exe /c` 启动。
 * slug 已在上游用白名单校验过（只允许字母数字下划线短横线），拼进命令行无注入风险。
 */
function runPetdexInstall(slug: string): Promise<void> {
  const args = ["--yes", "petdex", "install", slug];
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const file = isWin ? process.env.ComSpec || "cmd.exe" : "npx";
    const finalArgs = isWin ? ["/d", "/s", "/c", "npx", ...args] : args;

    execFile(
      file,
      finalArgs,
      { timeout: PETDEX_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderrText: stderr, stdoutText: stdout }));
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * 把子进程错误翻译成用户能看懂、能行动的一句话。
 *
 * 注意 petdex 的「找不到宠物」这类业务错误是走 **stdout** 的（退出码 1、stderr 只有
 * npm 的 warning），所以两个流都要看，并优先丢掉 npm 的噪音行。
 */
function describeInstallError(error: unknown): string {
  const err = error as NodeJS.ErrnoException & {
    stderrText?: string;
    stdoutText?: string;
    killed?: boolean;
  };
  if (err.code === "ENOENT") {
    return "未找到 npx：需要先安装 Node.js 并确保它在 PATH 中（也可以改用「从文件夹导入」）";
  }
  if (err.killed) {
    return `安装超时（超过 ${Math.round(PETDEX_TIMEOUT_MS / 1000)} 秒），可能是网络较慢`;
  }

  const meaningful = (text?: string): string[] =>
    (text || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim())
      .filter((line) => line && !line.startsWith("npm warn") && !line.startsWith("npm notice"));

  const fromStdout = meaningful(err.stdoutText);
  const fromStderr = meaningful(err.stderrText);
  const picked = (fromStderr.length > 0 ? fromStderr : fromStdout).slice(-3).join(" ");
  return (picked || err.message || "未知错误").slice(0, 300);
}

/**
 * 通过 Petdex 社区安装。
 *
 * 安全约束：`npx petdex install` 会执行第三方脚本，所以**调用方必须先弹确认**；
 * 这里只负责跑命令、限时、回收结果，并把产物复制进用户目录。
 */
export async function installPetFromPetdex(
  slug: string,
  destRoot: string,
): Promise<PetImportResult> {
  const clean = slug.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(clean)) {
    return { ok: false, error: "名称只能包含字母、数字、下划线和短横线" };
  }

  try {
    await runPetdexInstall(clean);
  } catch (error) {
    const detail = describeInstallError(error);
    log.warn("[pet] petdex 安装失败:", detail);
    return { ok: false, error: `petdex 安装失败: ${detail}` };
  }

  const found = petdexCandidates(clean).find((dir) => fs.existsSync(dir));
  if (!found) {
    return {
      ok: false,
      error: "petdex 已执行，但没有找到下载目录（~/.petdex/pets 或 ~/.codex/pets）",
    };
  }
  return importPetDir(found, destRoot);
}

/** 打开用户形象目录（设置页「打开文件夹」按钮） */
export function openPetsFolder(destRoot: string): void {
  fs.mkdirSync(destRoot, { recursive: true });
  void shell.openPath(destRoot);
}
