/**
 * 附件 MIME 归一与扩展名分类 — 前后端契约的单一真相。
 *
 * 背景（2026-09 附件链路修复）：上传响应曾用 fileType:'image'/'text'（非 MIME），
 * 而 image/file 块判定依赖 mediaType.startsWith('image/')，导致图片被降级为 file 块。
 * 现统一：写入路径一律携带真 MIME（image/jpeg 等），历史数据在读取路径归一。
 *
 * 2026-09 二次修复（附件引用形态统一）：仅靠 `image/` 前缀不足以判定「能否作为视觉
 * 输入内联」——image/svg+xml、image/x-icon、image/vnd.adobe.photoshop 都以 image/ 开头，
 * 但视觉模型不接受，sharp 也无法转码。故块形态判定改用 isVisionImageMediaType()
 * （位图白名单），并用 RASTER_IMAGE_EXTENSIONS 决定是否走上传转码分支。
 *
 * 前端镜像：frontend/src/utils/media-type.ts（含 RASTER_IMAGE_EXTENSIONS 一致性契约测试）。
 */

/** 上传转码分支接受的位图扩展名（sharp 可解码并统一转 JPEG） */
export const RASTER_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
] as const;

/** 可内联给视觉模型的位图 MIME（isVisionImageMediaType 的白名单） */
export const VISION_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
] as const;

const RASTER_IMAGE_EXTENSION_SET = new Set<string>(RASTER_IMAGE_EXTENSIONS);
const VISION_IMAGE_MIME_SET = new Set<string>(VISION_IMAGE_MIME_TYPES);

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
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  // 非位图"图片"：sharp 不可转码、视觉模型不接受 → 归入普通文件块
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  psd: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript',
  eps: 'application/postscript',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  // Office 文档：让模型侧 fileBlockToText 的工具指引能按扩展名分派 doc_parse
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
};

/** 归一化扩展名输入（去点、小写、去空白） */
export function normalizeExtension(ext?: string | null): string {
  return (ext ?? '').replace(/^\./, '').trim().toLowerCase();
}

/** 是否为上传转码分支接受的位图扩展名 */
export function isRasterImageExtension(ext?: string | null): boolean {
  return RASTER_IMAGE_EXTENSION_SET.has(normalizeExtension(ext));
}

/** 从扩展名（不带点）推 MIME；未知扩展回退 application/octet-stream */
export function mimeFromExtension(ext?: string | null): string {
  return EXT_TO_MIME[normalizeExtension(ext)] ?? 'application/octet-stream';
}

/**
 * EXT_TO_MIME 未覆盖的文本/代码类扩展名（键不带点，同风格）。
 *
 * 单列原因：这些类型是「服务端要直出给浏览器」的，判定比附件契约表更细——
 * 例如 .css 必须是 text/css，否则浏览器会拒绝应用 <link> 样式。EXT_TO_MIME
 * 服务的是上传/模型侧的附件判定，不该被服务端细节污染。
 */
const TEXT_CODE_MIME_TYPES: Record<string, string> = {
  css: 'text/css',
  js: 'application/javascript',
  py: 'text/x-python',
  java: 'text/x-java',
  ts: 'application/typescript',
  vue: 'text/html',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  sql: 'application/sql',
};

/**
 * 工作区文件直出的响应 MIME（workspace/raw-file、html-preview 等）。
 *
 * 先查文本/代码覆盖表，其余（位图/音视频/pdf/office）交给前后端契约表
 * EXT_TO_MIME —— 避免再长出第三份会漂移的 MIME 表（此前 raw-file 就因为
 * 私有一张表，把 .mp4/.mp3 发成 application/octet-stream 导致播放器不认）。
 */
export function resolveServingMimeType(ext?: string | null): string {
  const normalized = normalizeExtension(ext);
  return TEXT_CODE_MIME_TYPES[normalized] ?? mimeFromExtension(normalized);
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

/**
 * 是否为「可作为视觉输入内联」的位图 MIME —— image/file 块形态判定的唯一入口。
 *
 * 刻意不提供 `isImageMediaType`（image/ 前缀判定）：它会把 image/svg+xml、
 * image/x-icon、image/vnd.adobe.photoshop 一并算作图片，而那三者 sharp 转不了码、
 * 视觉模型也不接受，必须落 file 块走路径引用。只留一个判定，避免选错。
 */
export function isVisionImageMediaType(mediaType?: string | null): boolean {
  return VISION_IMAGE_MIME_SET.has((mediaType ?? '').trim().toLowerCase());
}
