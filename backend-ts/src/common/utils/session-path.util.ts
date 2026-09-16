/**
 * 会话数据目录（sessions base）的解析与会话 id 校验 —— 单一真相。
 *
 * 背景：会话 JSONL、meta.json、workflows/、以及 2026-09 起新增的会话图片附件
 * （<sessionsBase>/<sessionId>/images|previews/）都落在同一个 base 下。删除会话
 * 是对会话目录的整目录 rm -rf，因此这些内容全部「随会话删除免费」。
 *
 * 本模块被持久层（jsonl-backend / session-file.store / workflow-file-store）与
 * 附件解析层（attachment.util）共同引用；不要再各自实现 env 优先级。
 */

import * as path from "path";

/**
 * 会话数据根目录。
 * 解析优先级：
 *   1. SESSION_DATA_DIR（显式）→ <dir>/sessions
 *   2. USERDATA_DIR（Electron 数据根，如 ~/.guada/）→ <dir>/sessions
 *   3. UPLOAD_ROOT_DIR 的父目录（<dataHome>/file_stores → <dataHome>）→ <dir>/sessions
 *   4. 默认 ./data/sessions
 */
export function resolveSessionsBasePath(): string {
  const explicit = process.env.SESSION_DATA_DIR;
  const userData = process.env.USERDATA_DIR;
  const uploadRoot = process.env.UPLOAD_ROOT_DIR;
  if (explicit) {
    return path.join(explicit, "sessions");
  }
  if (userData) {
    return path.join(userData, "sessions");
  }
  if (uploadRoot) {
    return path.join(path.dirname(uploadRoot), "sessions");
  }
  return path.join(process.cwd(), "data", "sessions");
}

/**
 * 会话 id 合法性校验。
 *
 * id 会直接进 `path.join(sessionsBase, id)`（建目录/整目录删除/取图路径解析），
 * 因此必须挡住路径分隔符与 `..`；`"undefined"`/`"null"` 是历史缺陷产物
 * （曾因 `String(data.id)` 落到 `sessions/undefined/`），一并显式拒绝。
 */
export function assertValidId(id: string): void {
  if (
    !id ||
    /[\\/:*?"<>|]/.test(id) ||
    id.startsWith(".") ||
    id === "undefined" ||
    id === "null"
  ) {
    throw new Error(`Invalid session id: "${id}"`);
  }
}

/** 会话数据目录（绝对路径，不做存在性保证） */
export function getSessionDir(sessionId: string): string {
  assertValidId(sessionId);
  return path.join(resolveSessionsBasePath(), sessionId);
}

/**
 * 解析会话附件路径（取图路由与附件解析共用）。
 *
 * relPath 必须是会话目录内的相对路径（如 images/20260915/x.jpg）；
 * id 非法、relPath 为绝对路径或越出会话目录（`..` 上跳）一律返回 null。
 * 这是「服务任意会话字节」的唯一入口，宁可多拒不可漏放。
 */
export function resolveSessionAttachmentPath(
  sessionId: string,
  relPath: string,
): string | null {
  try {
    // 锚点与目标都必须经 path.resolve：win32 上 join("/data/...") 是驱动器相对路径，
    // 与 resolve 出的带盘符绝对路径做 startsWith 比较会永远失败（误杀全部合法路径）
    const resolvedSession = path.resolve(getSessionDir(sessionId));
    if (!relPath || path.isAbsolute(relPath)) return null;
    const resolved = path.resolve(resolvedSession, relPath);
    if (resolved !== resolvedSession && !resolved.startsWith(resolvedSession + path.sep)) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}
