/**
 * 附件 MIME 归一与扩展名分类（后端 common/utils/media-type.util.ts 的展示侧镜像）
 * 用于从扩展名/类型值兜底推导 MIME（编辑重发、旧数据等非上传响应来源），
 * 以及判定「能否作为图片内联/预览」。
 *
 * ⚠ 本文件与后端是刻意的手工镜像（前后端分属两个构建根，暂无法共享包）。
 * 一致性由 frontend/src/utils/media-type.contract.test.ts 守住：
 * 该测试直接读取后端源文件并逐项比对两张表，任何一侧漂移都会失败。
 */

/** 上传转码分支接受的位图扩展名（与后端 RASTER_IMAGE_EXTENSIONS 逐项一致） */
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
] as const

/** 可内联给视觉模型的位图 MIME（与后端 VISION_IMAGE_MIME_TYPES 逐项一致） */
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
] as const

const RASTER_IMAGE_EXTENSION_SET = new Set<string>(RASTER_IMAGE_EXTENSIONS)
const VISION_IMAGE_MIME_SET = new Set<string>(VISION_IMAGE_MIME_TYPES)

/** 扩展名 → MIME 表（导出仅为契约测试比对，业务代码请用 normalizeMediaType） */
export const EXT_TO_MIME: Record<string, string> = {
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
  // Office 文档
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
}

/** 归一化扩展名输入（去点、小写、去空白） */
export function normalizeExtension(ext?: string | null): string {
  return (ext ?? '').replace(/^\./, '').trim().toLowerCase()
}

/** 是否为上传转码分支接受的位图扩展名 */
export function isRasterImageExtension(ext?: string | null): boolean {
  return RASTER_IMAGE_EXTENSION_SET.has(normalizeExtension(ext))
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
  return EXT_TO_MIME[normalizeExtension(fileExtension)] ?? 'application/octet-stream'
}

/**
 * 是否为「可作为视觉输入内联/可预览」的位图 MIME —— 渲染层图片判定的唯一入口。
 *
 * 刻意不提供 `isImageMediaType`（image/ 前缀判定）：image/svg+xml、image/x-icon、
 * image/vnd.adobe.photoshop 会因此被当图片渲染与送进大图预览，而它们既不能内联给
 * 模型、浏览器也未必渲染。只留一个判定，避免选错。
 */
export function isVisionImageMediaType(mediaType?: string | null): boolean {
  return VISION_IMAGE_MIME_SET.has((mediaType ?? '').trim().toLowerCase())
}
