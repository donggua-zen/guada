/**
 * 桌宠形象导入的**纯逻辑**（不 import electron，可被 node 直接单测）。
 *
 * 与 `pet-import.ts` 的分工：那个负责弹窗、跑 npx、开目录等需要 Electron 的动作；
 * 这里只做「校验 + 复制」这类确定性的文件操作。
 */
import * as fs from "fs";
import * as path from "path";
import { readImageSize } from "./image-size";
import { deriveAtlasCell } from "./atlas-geometry";

/** Codex 官方图集尺寸（参考值；兼容 ChatGPT 导出的 1536×2288） */
export const ATLAS_W = 1536;
export const ATLAS_H = 1872;

export interface PetImportResult {
  ok: boolean;
  /** 成功时的形象 id（目录名） */
  id?: string;
  error?: string;
}

/** 目录名 → 合法形象 id（只允许字母数字、下划线、短横线） */
export function sanitizeAvatarId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || "pet";
}

/** 目标目录：重名时自动加 -2、-3…，不覆盖已有形象 */
export function resolveImportTarget(destRoot: string, id: string): string {
  let candidate = path.join(destRoot, id);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destRoot, `${id}-${n}`);
    n += 1;
  }
  return candidate;
}

/**
 * 识别目录里的素材格式并做基础校验。
 *
 * 只做「拦得住常见错误」的那一层（清单存在、图集尺寸对、路径不穿越）；
 * 逐格透明等完整契约校验在 `scripts/validate-pet-atlas.mjs`，
 * 那是开发期工具——运行时扫 1536×1872 的像素会让设置页卡好几秒。
 */
export function inspectPetDir(
  dir: string,
): { format: "frames" | "atlas"; name: string } | string {
  const atlasPath = path.join(dir, "pet.json");
  const framesPath = path.join(dir, "manifest.json");

  if (fs.existsSync(atlasPath)) {
    let config: { displayName?: unknown; spritesheetPath?: unknown };
    try {
      config = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
    } catch {
      return "pet.json 无法解析";
    }
    const sheetName =
      typeof config.spritesheetPath === "string" && config.spritesheetPath.trim()
        ? config.spritesheetPath.trim()
        : "spritesheet.webp";
    if (sheetName.includes("..") || sheetName.includes("/") || sheetName.includes("\\")) {
      return "pet.json 的 spritesheetPath 只能是同目录文件名";
    }
    const sheetPath = path.join(dir, sheetName);
    if (!fs.existsSync(sheetPath)) return `缺少图集文件 ${sheetName}`;

    const size = readImageSize(sheetPath);
    if (!size) return `无法识别图集尺寸（需要 WebP 或 PNG）：${sheetName}`;
    // 只校验「能不能按 8×9 切开」，不锁死 1536×1872：
    // ChatGPT 桌面端导出的是 1536×2288（单格 192×254.2），同样合法。
    const cell = deriveAtlasCell(size.width, size.height);
    if (!cell) {
      return `图集尺寸不合法：${size.width}×${size.height}（需要 8 列×9 行、单格至少 128×128）`;
    }
    const name =
      typeof config.displayName === "string" && config.displayName.trim()
        ? config.displayName.trim()
        : path.basename(dir);
    return { format: "atlas", name };
  }

  if (fs.existsSync(framesPath)) {
    let config: { name?: unknown; animations?: unknown };
    try {
      config = JSON.parse(fs.readFileSync(framesPath, "utf8"));
    } catch {
      return "manifest.json 无法解析";
    }
    if (!config.animations || typeof config.animations !== "object") {
      return "manifest.json 缺少 animations";
    }
    const name =
      typeof config.name === "string" && config.name.trim()
        ? config.name.trim()
        : path.basename(dir);
    return { format: "frames", name };
  }

  return "目录里既没有 pet.json（Codex 图集）也没有 manifest.json（逐帧素材）";
}

/** 把校验通过的素材目录复制进用户形象目录 */
export function importPetDir(srcDir: string, destRoot: string): PetImportResult {
  const inspected = inspectPetDir(srcDir);
  if (typeof inspected === "string") return { ok: false, error: inspected };

  const id = sanitizeAvatarId(path.basename(srcDir));
  const target = resolveImportTarget(destRoot, id);
  try {
    fs.mkdirSync(destRoot, { recursive: true });
    fs.cpSync(srcDir, target, { recursive: true });
  } catch (error) {
    return { ok: false, error: `复制失败: ${(error as Error).message}` };
  }

  return { ok: true, id: path.basename(target) };
}
