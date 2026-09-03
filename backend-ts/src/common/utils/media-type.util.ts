/**
 * 附件 MIME 归一工具 — 前后端契约的单一真相。
 *
 * 背景（2026-09 附件链路修复）：上传响应曾用 fileType:'image'/'text'（非 MIME），
 * 而 image/file 块判定依赖 mediaType.startsWith('image/')，导致图片被降级为 file 块。
 * 现统一：写入路径一律携带真 MIME（image/jpeg 等），历史数据在读取路径归一。
 */

/** 上传响应的扩展名 → MIME 映射（与 llm-core guessMediaType 对齐并归一 jpg→jpeg） */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
};

/** 从扩展名（不带点）推 MIME；未知扩展回退 application/octet-stream */
export function mimeFromExtension(ext?: string | null): string {
  const key = (ext ?? '').replace(/^\./, '').toLowerCase();
  return EXT_TO_MIME[key] ?? 'application/octet-stream';
}

/** MIME 形态判定：type/subtype（含 + 后缀，如 image/svg+xml） */
function looksLikeMime(value?: string | null): boolean {
  return !!value && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value.trim());
}

/**
 * 归一 mediaType（新契约唯一入口）：
 * - 已是合法 MIME → 原样返回（jpg→jpeg 不涉及，MIME 层只有 image/jpeg）
 * - 旧 fileType 语义值（'image'/'text'/'pdf' 等）或空 → 由扩展名兜底，再退 application/octet-stream
 */
export function normalizeMediaType(
  mediaType?: string | null,
  fileExtension?: string | null,
): string {
  const value = (mediaType ?? '').trim();
  if (looksLikeMime(value)) return value.toLowerCase();
  return mimeFromExtension(fileExtension);
}

/** 是否图片 MIME（image/file 块判定统一入口） */
export function isImageMediaType(mediaType?: string | null): boolean {
  return (mediaType ?? '').toLowerCase().startsWith('image/');
}
