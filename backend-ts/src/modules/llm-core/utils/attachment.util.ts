/**
 * 附件读取工具 — 序列化边界的统一字节解析助手（L2 层）。
 *
 * 设计约定（见 docs/message-pipeline-normalization-plan.md §3）：
 * - 存储/传输层只用「引用」（FileRef.url + refType），绝不内嵌大段 base64；
 * - 本文件是唯一的「引用 → 字节 / 引用 → 路径」解析点：attachmentToPart() 返回 provider
 *   中性的 { mimeType, base64 }，resolveModelVisiblePath() 返回工具可读的绝对路径，
 *   各 adapter 只做 3-5 行协议映射（image_url / source / inlineData）；
 * - 引用形态分派见 resolveRefPhysicalPath：store（全局附件目录）/ workspace（会话工作目录）
 *   / local（本机绝对路径）。
 *
 * 缓存：图片上传时已被 sharp 压到 ≤1024px JPEG（体积可控），按物理路径 + mtime
 * 做 LRU 内存缓存，同一附件在进程生命周期内最多读一次盘。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileRefType } from '../../../common/types/conversation.types';
import {
  resolveSessionsBasePath,
  assertValidId,
} from '../../../common/utils/session-path.util';

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
 * 附件引用的解析上下文。
 * `workspaceDir` 只在 refType='workspace' 时需要（会话工作目录）；缺失时该类引用
 * 无法桥接，调用方按「路径不可用」降级。
 * `sessionDir` 仅供显式注入会话目录；'session' 形态的 url 内嵌 sessionId，
 * 通常可直接反推（见 resolveRefPhysicalPath），一般无需此字段。
 */
export interface AttachmentResolveContext {
  workspaceDir?: string | null;
  sessionDir?: string | null;
}

/** 归一 refType：缺省即 'store'（历史 JSONL 无此字段，语义与旧行为一致） */
export function normalizeRefType(refType?: string | null): FileRefType {
  return refType === 'workspace' ||
    refType === 'local' ||
    refType === 'session' ||
    refType === 'store'
    ? refType
    : 'store';
}

/**
 * 从 'session' 形态的 url（sessions/<id>/images/x.jpg）反推会话目录。
 * 返回 null 表示形态非法（缺段 / id 非法 / 越出会话目录）。
 */
function resolveSessionPhysicalPath(url: string, ctx?: AttachmentResolveContext): string | null {
  // 形态：sessions/<id>/<剩余路径>（自包含，id 后必须还有内容）
  const match = url.match(/^sessions\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, id, rest] = match;

  let sessionDir: string;
  try {
    // ctx.sessionDir 是显式注入（测试用）；缺省按 env 反推（与 resolvePhysicalPath
    // 读 UPLOAD_ROOT_DIR 同一约定：不 import 持久层，避免 util 反向依赖）。
    sessionDir = ctx?.sessionDir ?? path.join(resolveSessionsBasePath(), id);
    assertValidId(id);
  } catch {
    return null;
  }

  // 锚点与目标都经 path.resolve：win32 上 join("/data/...") 是驱动器相对路径，
  // 与 resolve 出的带盘符绝对路径做 startsWith 比较会永远失败（误杀全部合法路径）
  const resolvedSession = path.resolve(sessionDir);
  if (path.isAbsolute(rest)) return null; // 绝对路径段不算会话内引用
  const resolved = path.resolve(resolvedSession, rest);
  // 越出会话目录（上跳/软链逃逸）一律拒绝
  if (resolved !== resolvedSession && !resolved.startsWith(resolvedSession + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * 将本地存储路径（如 uploads/images/xxx.png）解析为物理绝对路径。
 * 与 UploadPathService.toPhysicalPath 保持同一套环境变量约定（refType='store'）。
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

/** 引用形态的最小形状（FileRef 的结构子集，避免 util ↔ types 循环依赖） */
export interface AttachmentRefLike {
  url?: string | null;
  refType?: string | null;
}

/**
 * 按 refType 把附件引用解析为物理绝对路径（本文件唯一的引用 → 路径入口）。
 *
 * - 'store'     ：UPLOAD_ROOT_DIR 下的存储引用（也兼容 http(s) 绝对 URL 反解）
 * - 'workspace' ：会话工作目录内的相对引用；无 workspaceDir 或越出工作目录 → null
 * - 'session'   ：会话数据目录内的引用（url 自包含 sessions/<id>/...），
 *                 反推会话目录并校验不越界；非法 id / 越界 → null
 * - 'local'     ：宿主本机绝对路径，原样规范化
 *
 * data: 内联图无物理路径 → null。
 */
export function resolveRefPhysicalPath(
  ref: string | AttachmentRefLike,
  ctx?: AttachmentResolveContext,
): string | null {
  const url = typeof ref === 'string' ? ref : ref?.url;
  const refType = typeof ref === 'string' ? 'store' : normalizeRefType(ref?.refType);

  if (!url) return null;
  // 本机上传资源的绝对 URL / data URL 不参与 refType 分派
  if (url.startsWith('data:')) return null;

  if (refType === 'local') {
    // Electron 本机路径：已是绝对路径，直接规范化返回（不校验存在性）
    return path.normalize(url);
  }

  if (refType === 'session') {
    return resolveSessionPhysicalPath(url, ctx);
  }

  if (refType === 'workspace') {
    const workspaceDir = ctx?.workspaceDir;
    if (!workspaceDir) return null;
    const resolvedWorkspace = path.resolve(workspaceDir);
    const resolved = path.isAbsolute(url)
      ? path.normalize(url)
      : path.resolve(resolvedWorkspace, url);
    // 越出工作目录的引用（上跳）不给路径，避免把可疑路径喂给模型与工具
    if (
      resolved !== resolvedWorkspace &&
      !resolved.startsWith(resolvedWorkspace + path.sep)
    ) {
      return null;
    }
    return resolved;
  }

  // 'store'：http(s) 绝对 URL 也按存储路径反解（本机上传资源）
  return resolvePhysicalPath(url);
}

/**
 * 请求时桥接：把持久层的存储引用翻译为模型工具可读的物理路径（DSH 同款架构，见
 * DSH ADR 2026-08-21-model-readable-image-paths：引用不当路径用，路径现算现给）。
 *
 * - 'store' 相对存储引用（uploads/images/xxx.png）→ UPLOAD_ROOT_DIR 下的绝对物理路径
 * - 'workspace' 相对引用 → <workspaceDir>/<相对路径>
 * - 'session' 自包含引用（sessions/<id>/images/...）→ <sessionsBase>/<id>/<相对路径>
 * - 'local' 本机绝对路径 → 原样
 * - data: URL（工具内联图）→ null（无物理路径可给，调用方决定呈现方式）
 * - 'store' 且未配置 UPLOAD_ROOT_DIR → null（宁可不给路径，不给必错的相对引用/猜测路径）
 *
 * 持久层（JSONL 块）始终只存引用；此函数仅在组装模型请求的投影/序列化边界调用。
 */
export function resolveModelVisiblePath(
  ref?: string | AttachmentRefLike | null,
  ctx?: AttachmentResolveContext,
): string | null {
  if (!ref) return null;
  const refType = typeof ref === 'string' ? 'store' : normalizeRefType(ref.refType);
  const url = typeof ref === 'string' ? ref : ref.url;
  if (!url || url.startsWith('data:')) return null;
  // 'store' 依赖 UPLOAD_ROOT_DIR 才能反解；workspace/session/local 不需要
  if (refType === 'store' && !process.env.UPLOAD_ROOT_DIR) return null;
  return resolveRefPhysicalPath(ref, ctx);
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
 * 入参支持两种形态（保持兼容）：
 * - 字符串：按 'store' 语义解析（旧调用点，图片均在 UPLOAD_ROOT_DIR 下）
 * - AttachmentRefLike：按 refType 分派（'session' 图片必须用对象形态，
 *   否则自包含引用无法反推会话目录）
 *
 * - 本地文件 → 现读现转 base64（带 LRU 缓存，mtime 失效）
 * - data URL → 解析为 { mimeType, base64 }（不缓存）
 * - 本机上传资源的 http(s) URL → 反解物理路径读盘转 base64（本地服务地址远端模型无法取回）
 * - 其余远程 http(s) URL → 返回 { kind: 'url' }（字节解析交给调用方协议策略）
 * - 文件不存在/读取失败 → null（调用方决定降级：占位文本 / 跳过 / 报错）
 */
export async function attachmentToPart(
  ref: string | AttachmentRefLike,
  mediaType?: string,
  ctx?: AttachmentResolveContext,
): Promise<ResolvedImagePart | null> {
  const storagePath = typeof ref === 'string' ? ref : ref?.url;
  if (!storagePath) return null;

  if (storagePath.startsWith('data:')) {
    return parseDataUrl(storagePath);
  }
  if (/^https?:\/\//.test(storagePath)) {
    // 本机上传资源的绝对 URL（UPLOAD_URL_PREFIX 前缀）→ 反解物理路径读盘；
    // 反解失败（确为外链/资源缺失）→ 透传 URL 由调用方决定。
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
      return { kind: 'url', url: storagePath };
    }
  }

  // 按 refType 分派得到物理路径（store 兼容旧字符串形态；session 需要对象形态）
  const physical = resolveRefPhysicalPath(ref, ctx);
  if (!physical) return null;
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

/** file 块附件的最小形状（FileRef / MessageFile 均兼容；attachmentId 仅旧数据读取回退） */
export interface FileLikeAttachment {
  name?: string;
  url?: string;
  refType?: string | null;
  fileExtension?: string;
  attachmentId?: string;
}

/** 需要 document.doc_parse 才能读出内容（read 只会读到二进制乱码）的文档类扩展名 */
const DOC_PARSE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

/** 从附件推断扩展名（显式字段优先，其次文件名后缀，最后 url 后缀） */
function inferExtension(attachment: FileLikeAttachment): string {
  if (attachment.fileExtension) return attachment.fileExtension.replace(/^\./, '').toLowerCase();
  const fromName = attachment.name?.match(/\.([^.]+)$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromUrl = attachment.url?.split(/[?#]/)[0]?.match(/\.([^.]+)$/)?.[1];
  return fromUrl ? fromUrl.toLowerCase() : '';
}

/**
 * 按扩展名给出的读取工具指引（模型拿到路径后该用什么工具）。
 * 二进制/媒体类没有可读文本投影，返回空串（只给路径，不误导）。
 */
export function fileToolHint(extension: string): string {
  if (DOC_PARSE_EXTENSIONS.has(extension)) {
    return '。解析内容请调用 document.doc_parse（file_path 传上面的绝对路径）';
  }
  return '。读取内容请调用 read（file_path 传上面的绝对路径）';
}

/**
 * file 块的统一文本投影（原四个 adapter 逐字重复的实现收敛于此）。
 *
 * 引用 → 路径的桥接由 resolveModelVisiblePath 完成，需要 ctx.workspaceDir 的
 * 'workspace' 引用才需要上下文；'store'/'local' 不需要。无法桥接时**只给文件名**，
 * 明确不编造路径、不把存储引用当路径喂给模型（工具按工作目录解析必然报错）。
 *
 * 注：正常链路上 'workspace' 引用会先被 message-transform.pipeline 的
 * file-path-bridge 步骤改写为绝对路径形态，故这里打印的就是真实可读路径；
 * 绕过管线直接调用 adapter 的链路（压缩/摘要/标题）会退化为只有文件名。
 */
export function fileBlockToText(
  attachment: FileLikeAttachment,
  ctx?: AttachmentResolveContext,
): string {
  const name = attachment.name ?? attachment.attachmentId ?? 'attachment';
  const visiblePath = resolveModelVisiblePath(attachment, ctx);
  if (!visiblePath) return `[文件: ${name}]`;
  return `[文件: ${name} (${visiblePath})]${fileToolHint(inferExtension(attachment))}`;
}
