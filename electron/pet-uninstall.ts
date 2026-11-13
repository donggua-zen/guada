/**
 * 桌宠形象卸载。
 *
 * 安全约束（很重要，卸载是递归删除）：
 * - 只允许删 **user 根**（`<userData>/pets`）下的直接子目录；
 *   bundled（安装包内）、petdex、codex 都是别人的目录，只读扫描，绝不能删
 * - 默认形象 `silver-haired`（内置的柒）不可删
 * - id 必须过白名单，且解析后的真实路径必须仍在 user 根内（防 ../ 穿越）
 * - 若当前正在使用这个形象，先切回默认形象再删（由调用方 main.ts 处理）
 */
import * as fs from "fs";
import * as path from "path";

export const PET_AVATAR_DEFAULT_ID = "silver-haired";

export interface PetUninstallResult {
  ok: boolean;
  error?: string;
}

/** id 合法性（与 pet-window.ts 的 isValidAvatarId 保持一致） */
function isValidAvatarId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/**
 * 删除一个已安装的形象。
 *
 * @param roots 与主进程 resolvePetRoots() 同顺序的素材根列表
 * @param id    形象 id
 */
export function uninstallPetAvatar(
  roots: readonly { dir: string; source: string }[],
  id: string,
): PetUninstallResult {
  const clean = (id || "").trim();
  if (!isValidAvatarId(clean)) {
    return { ok: false, error: "非法的形象标识" };
  }
  if (clean === PET_AVATAR_DEFAULT_ID) {
    return { ok: false, error: "内置形象不能卸载" };
  }

  const userRoot = roots.find((r) => r.source === "user");
  if (!userRoot) return { ok: false, error: "找不到用户形象目录" };

  const root = path.resolve(userRoot.dir);
  const target = path.resolve(root, clean);
  // 必须仍是「root 的直接子目录」，不能等于 root，也不能跑出去
  if (path.dirname(target) !== root || target === root) {
    return { ok: false, error: "路径不合法" };
  }

  if (!fs.existsSync(target)) {
    return { ok: false, error: "形象不存在（可能已在别处被删除）" };
  }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { ok: false, error: "目标不是普通目录，拒绝删除" };
  }
  // 只认我们自己装出来的格式，避免误删用户放在这个目录里的其它东西
  const isPet =
    fs.existsSync(path.join(target, "pet.json")) ||
    fs.existsSync(path.join(target, "manifest.json"));
  if (!isPet) {
    return { ok: false, error: "该目录不是桌宠形象，拒绝删除" };
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `删除失败：${(error as Error).message}` };
  }
}
