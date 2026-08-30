/**
 * 附件读取工具 — 序列化边界的统一字节解析助手（L2 层）。
 *
 * 设计约定（见 docs/message-pipeline-normalization-plan.md §3）：
 * - 存储/传输层只用「引用」（FileRef.url 相对路径），绝不内嵌大段 base64；
 * - 本文件是唯一的「引用 → 字节」解析点：attachmentToPart() 返回 provider 中性的
 *   { mimeType, base64 }，各 adapter 只做 3-5 行协议映射（image_url / source / inlineData）；
 * - 前端展示只需 url（FilesController 静态访问），不需要 base64。
 *
 * 缓存：图片上传时已被 sharp 压到 ≤1024px JPEG（体积可控），按物理路径 + mtime
 * 做 LRU 内存缓存，同一附件在进程生命周期内最多读一次盘。
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ─── 中性解析结果 ───

/** 本地文件 / data URL → base64 形态 */
export interface Base64ImagePart {
  kind: 'base64';
  mimeType: string;
  base64: string;
}

/** 远程 URL（无法本地解析字节时），由调用方决定透传或跳过 */
export interface UrlImagePart {
  kind: 'url';
  url: string;
}

export type ResolvedImagePart = Base64ImagePart | UrlImagePart;

// ─── 路径解析 ───

/**
 * 将本地存储路径（如 uploads/images/xxx.png）解析为物理绝对路径。
 * 与 UploadPathService.toPhysicalPath 保持同一套环境变量约定。
 */
export function resolvePhysicalPath(storagePath: string): string {
  let actualPath = storagePath;

  // 完整 URL → 取路径部分
  if (/^https?:\/\//.test(storagePath)) {
    try {
      actualPath = new URL(storagePath).pathname.replace(/^\//, '');
    } catch {
      // 解析失败则用原值
    }
  }

  // 去除 uploads/ 前缀
  if (actualPath.startsWith('uploads/')) {
    actualPath = actualPath.slice('uploads/'.length);
  }

  const uploadRoot = process.env.UPLOAD_ROOT_DIR;
  if (uploadRoot) {
    return path.join(path.resolve(uploadRoot), actualPath);
  }
  // 无 UPLOAD_ROOT_DIR 时退回当前工作目录
  return path.join(process.cwd(), 'data', 'uploads', actualPath);
}

// ─── MIME 猜测 ───

/** 按扩展名猜测 MIME（供缺省 mediaType 使用） */
export function guessMediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.xml': 'application/xml',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 解析 data URL 为 { mimeType, base64 }；非 data URL 返回 null */
function parseDataUrl(dataUrl: string): Base64ImagePart | null {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/s);
  if (!match) return null;
  return { kind: 'base64', mimeType: match[1], base64: match[2] };
}

// ─── LRU 缓存 ───

interface CacheEntry {
  part: Base64ImagePart;
  mtimeMs: number;
  byteSize: number;
}

const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string, mtimeMs: number): Base64ImagePart | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.mtimeMs !== mtimeMs) {
    // 文件已被覆盖（重传/清理）→ 失效
    cache.delete(key);
    return null;
  }
  // LRU 触碰：删掉重插到队尾
  cache.delete(key);
  cache.set(key, hit);
  return hit.part;
}

function cachePut(key: string, mtimeMs: number, byteSize: number, part: Base64ImagePart): void {
  cache.set(key, { part, mtimeMs, byteSize });
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  // 淘汰最旧（Map 迭代序 = 插入序）
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

// ─── 核心解析 ───

/**
 * 将附件引用解析为 provider 中性的图片部件。
 *
 * - 本地文件 → 现读现转 base64（带 LRU 缓存，mtime 失效）
 * - data URL → 解析为 { mimeType, base64 }（不缓存）
 * - 远程 http(s) URL → 返回 { kind: 'url' }（字节解析交给调用方协议策略）
 * - 文件不存在/读取失败 → null（调用方决定降级：占位文本 / 跳过 / 报错）
 */
export async function attachmentToPart(
  storagePath: string,
  mediaType?: string,
): Promise<ResolvedImagePart | null> {
  if (!storagePath) return null;

  if (storagePath.startsWith('data:')) {
    return parseDataUrl(storagePath);
  }
  if (/^https?:\/\//.test(storagePath)) {
    return { kind: 'url', url: storagePath };
  }

  const physical = resolvePhysicalPath(storagePath);
  try {
    const stat = await fs.stat(physical);
    const mtimeMs = stat.mtimeMs;
    const cached = cacheGet(physical, mtimeMs);
    if (cached) return cached;

    const buf = await fs.readFile(physical);
    const part: Base64ImagePart = {
      kind: 'base64',
      mimeType: mediaType ?? guessMediaType(physical),
      base64: buf.toString('base64'),
    };
    cachePut(physical, mtimeMs, buf.byteLength, part);
    return part;
  } catch {
    // 文件缺失/不可读 → 返回 null，由调用方决定降级策略
    return null;
  }
}

/**
 * 读取本地附件并转为 base64 data URL（如 data:image/png;base64,...）。
 * @param storagePath 存储引用路径（FileRef.url）
 * @param mediaType  MIME 类型（缺省时按扩展名猜测，兜底 application/octet-stream）
 * @returns data URL 字符串；文件不存在/读取失败时返回 null
 * @deprecated 新代码请用 attachmentToPart()（中性形态，避免各 adapter 再拆 dataUrl）
 */
export async function attachmentToDataUrl(
  storagePath: string,
  mediaType?: string,
): Promise<string | null> {
  const part = await attachmentToPart(storagePath, mediaType);
  if (!part) return null;
  if (part.kind === 'url') return part.url;
  return `data:${part.mimeType};base64,${part.base64}`;
}

// ─── file 块统一投影 ───

/** file 块附件的最小形状（FileRef / MessageFile 均兼容） */
export interface FileLikeAttachment {
  name?: string;
  url?: string;
  attachmentId: string;
}

/**
 * file 块的统一文本投影（原四个 adapter 逐字重复的实现收敛于此）。
 * TODO(文件内联)：小文本文件后续直接内联；当前统一走引用（路径贴给模型）。
 */
export function fileBlockToText(attachment: FileLikeAttachment): string {
  const url = attachment.url ?? attachment.attachmentId;
  return `[文件: ${attachment.name ?? attachment.attachmentId} (${url})]`;
}
