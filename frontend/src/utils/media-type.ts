/**
 * 附件 MIME 归一（与后端 common/utils/media-type.util.ts 同口径的展示侧镜像）
 * 用于从扩展名/类型值兜底推导 MIME（编辑重发、旧数据等非上传响应来源）。
 */

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
}

/** MIME 形态判定：type/subtype */
function looksLikeMime(value?: string | null): boolean {
  return !!value && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value.trim())
}

/**
 * 归一 mediaType：合法 MIME 原样返回；旧语义值（'image'/'text'）或扩展名按映射推导；
 * 未知回退 application/octet-stream。
 */
export function normalizeMediaType(
  mediaType?: string | null,
  fileExtension?: string | null,
): string {
  const value = (mediaType ?? '').trim()
  if (looksLikeMime(value)) return value.toLowerCase()
  const ext = (fileExtension ?? '').replace(/^\./, '').toLowerCase()
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}
