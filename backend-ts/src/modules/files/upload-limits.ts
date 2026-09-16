/**
 * 聊天附件上传限额 — multer 拦截与服务层校验的单一来源。
 *
 * 历史值曾是硬编码 1GB + multer memoryStorage，单个大文件即可把整个文件读进内存
 * （还要再经 sharp 处理）。现改为可配置，默认 100MB，并由 multer 在进入 handler
 * 之前就按同一数值拒绝，避免无效请求把内存吃掉。
 */

/** 默认单文件上限（MB） */
export const DEFAULT_CHAT_UPLOAD_MAX_MB = 100;

/** 允许的范围（MB）：防止把上限配成 0（全拒）或大到失去保护意义 */
const MIN_CHAT_UPLOAD_MAX_MB = 1;
const MAX_CHAT_UPLOAD_MAX_MB = 4096;

/** 单文件上限（MB）：env CHAT_UPLOAD_MAX_MB，非法/缺省回退 100，夹在 1..4096 */
export function getChatUploadMaxMb(): number {
  const raw = process.env.CHAT_UPLOAD_MAX_MB;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CHAT_UPLOAD_MAX_MB;
  return Math.min(MAX_CHAT_UPLOAD_MAX_MB, Math.max(MIN_CHAT_UPLOAD_MAX_MB, parsed));
}

/** 单文件上限（字节） */
export function getChatUploadMaxBytes(): number {
  return getChatUploadMaxMb() * 1024 * 1024;
}
