/**
 * 文件内容嗅探 —— 后缀不可信（缺失 / 未知）时，用文件头判断「文本还是二进制」及真实格式。
 *
 * 分层策略（编辑器 / `file(1)` 的通用做法）：
 *  1. 后缀已知 → 调用方直接信任，不进入这里（零额外 I/O）；
 *  2. 后缀未知 → 只读头部若干字节：
 *     a. BOM 定编码 —— **必须最先判**：UTF-16/32 文本天然含 NUL 字节，
 *        若先跑 NUL 启发式会把它们误判成二进制；
 *     b. 魔数定真实格式（png/pdf/zip/mp4…），MIME 复用 media-type.util 的扩展名表，
 *        不新长第三张会漂移的 MIME 表；
 *     c. NUL 字节 / 控制字符占比过高 → 二进制；
 *     d. 其余 → 文本。
 *
 * 只读文件头、不读整文件；判定不了时保守地按文本处理（与浏览器/编辑器一致）。
 */

import * as fs from 'fs/promises';
import * as iconv from 'iconv-lite';
import { mimeFromExtension } from './media-type.util';

/** 嗅探读取的头部字节数（与 git.service 的 hasNulByte 同量级） */
export const SNIFF_HEAD_BYTES = 8192;

/** 控制字符占比超过该阈值即视为二进制（GBK/UTF-8 中文属高位字节，不计入） */
const MAX_CONTROL_RATIO = 0.3;

export type SniffReason = 'magic' | 'bom' | 'nul' | 'control' | 'text';

export interface FileSniffResult {
  /** 是否二进制（不应按文本渲染） */
  isBinary: boolean;
  /** 命中魔数时的真实 MIME；未命中为 null（调用方回退扩展名表） */
  mimeType: string | null;
  /** 命中魔数时的扩展名（带点，如 '.png'）；未命中为 '' */
  detectedExtension: string;
  /** 文本编码（iconv-lite 名称） */
  encoding: TextEncoding;
  /** 判定依据，便于日志与测试断言 */
  reason: SniffReason;
}

/** 支持的文本编码。无 BOM 且不是合法 UTF-8 时按 gb18030 处理（中文场景最常见的遗留编码） */
export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be' | 'gb18030';

/** BOM → 编码。长序列在前：UTF-32LE 前两字节与 UTF-16LE 相同，必须先判 4 字节 */
const BOM_TABLE: Array<{ bytes: number[]; encoding: TextEncoding }> = [
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: 'utf-32le' },
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: 'utf-32be' },
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

/**
 * 魔数 → 扩展名（MIME 交给 media-type.util 的扩展名表，故这里只记扩展名）。
 * 刻意不收 2 字节弱签名（'BM'/'MZ'）：文本文件以 "BM…"/"MZ…" 开头会被误判成图片/可执行文件，
 * 而「无后缀文本」正是本功能要救的场景。
 */
const MAGIC_TABLE: Array<{ bytes: number[]; ext: string }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: 'png' },
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], ext: 'gif' }, // GIF87a / GIF89a
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], ext: 'pdf' }, // %PDF-
  { bytes: [0x50, 0x4b, 0x03, 0x04], ext: 'zip' }, // PK\x03\x04
  { bytes: [0x50, 0x4b, 0x05, 0x06], ext: 'zip' }, // 空 zip（仅 EOCD）
  { bytes: [0x1f, 0x8b], ext: 'gz' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], ext: '7z' },
  { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], ext: 'rar' },
  { bytes: [0x4f, 0x67, 0x67, 0x53], ext: 'ogg' }, // OggS
  { bytes: [0x66, 0x4c, 0x61, 0x43], ext: 'flac' },
  { bytes: [0x49, 0x44, 0x33], ext: 'mp3' }, // ID3 标签
  { bytes: [0xff, 0xfb], ext: 'mp3' }, // MPEG 帧同步
  { bytes: [0xff, 0xf3], ext: 'mp3' },
  { bytes: [0xff, 0xf2], ext: 'mp3' },
  { bytes: [0x00, 0x00, 0x01, 0x00], ext: 'ico' },
  { bytes: [0x38, 0x42, 0x50, 0x53], ext: 'psd' }, // 8BPS
  { bytes: [0x49, 0x49, 0x2a, 0x00], ext: 'tiff' },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], ext: 'tiff' },
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], ext: 'webm' }, // EBML（webm/mkv 同容器，取浏览器可播的 webm）
];

/** 读文件头（不读整文件）：open → read → close */
async function readHead(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectBom(head: Buffer): TextEncoding | null {
  for (const { bytes, encoding } of BOM_TABLE) {
    if (head.length < bytes.length) continue;
    let matched = true;
    for (let i = 0; i < bytes.length; i++) {
      if (head[i] !== bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return encoding;
  }
  return null;
}

function startsWithAt(head: Buffer, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/** 魔数命中则返回扩展名（不带点）；否则 null */
function matchMagic(head: Buffer): string | null {
  // RIFF 容器：offset 8 的 form 区分 WAVE / WEBP
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF') {
    const form = head.subarray(8, 12).toString('latin1');
    if (form === 'WAVE') return 'wav';
    if (form === 'WEBP') return 'webp';
    return null;
  }
  // ISO BMFF：offset 4 是 'ftyp'，brand 区分 mp4 / mov
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1');
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  for (const entry of MAGIC_TABLE) {
    if (startsWithAt(head, entry.bytes)) return entry.ext;
  }
  return null;
}

/** C0 控制符（放行 \t \n \v \f \r）与 DEL 的占比 */
function controlRatio(head: Buffer): number {
  if (head.length === 0) return 0;
  let suspicious = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f) suspicious++;
  }
  return suspicious / head.length;
}

/**
 * 无 BOM 文本的编码判定：合法 UTF-8 → utf-8；否则按 gb18030（GBK/GB2312 的超集）。
 *
 * 依赖 Node 解码非法序列时产生的 U+FFFD 作为"非法 UTF-8"信号；末尾最多丢 4 字节，
 * 避免把被 8KB 头部截断的多字节序列误判成非法。
 */
function detectTextEncoding(head: Buffer): TextEncoding {
  const sample = head.length > 4 ? head.subarray(0, head.length - 4) : head;
  return sample.toString('utf-8').includes('\ufffd') ? 'gb18030' : 'utf-8';
}

/**
 * 嗅探文件头，给出「文本/二进制 + 真实格式 + 编码」。
 * 文件不存在或不可读时抛错，由调用方决定兜底。
 */
export async function sniffFileHead(
  filePath: string,
  maxBytes = SNIFF_HEAD_BYTES,
): Promise<FileSniffResult> {
  const head = await readHead(filePath, maxBytes);

  // 1) BOM 最先：UTF-16/32 文本含 NUL 字节，先跑 NUL 启发式会误判成二进制
  const bom = detectBom(head);
  if (bom) {
    return { isBinary: false, mimeType: null, detectedExtension: '', encoding: bom, reason: 'bom' };
  }

  // 2) 魔数：已知二进制格式（png/pdf/zip/mp4…）
  const magicExt = matchMagic(head);
  if (magicExt) {
    return {
      isBinary: true,
      mimeType: mimeFromExtension(magicExt),
      detectedExtension: `.${magicExt}`,
      encoding: 'utf-8',
      reason: 'magic',
    };
  }

  // 3) NUL 字节 → 二进制（与 git.service 的 hasNulByte 同源）
  if (head.includes(0)) {
    return { isBinary: true, mimeType: null, detectedExtension: '', encoding: 'utf-8', reason: 'nul' };
  }

  // 4) 控制字符占比过高 → 二进制
  if (controlRatio(head) > MAX_CONTROL_RATIO) {
    return { isBinary: true, mimeType: null, detectedExtension: '', encoding: 'utf-8', reason: 'control' };
  }

  return {
    isBinary: false,
    mimeType: null,
    detectedExtension: '',
    encoding: detectTextEncoding(head),
    reason: 'text',
  };
}

/**
 * 按嗅探出的编码解码文本，并去掉解码后残留的 BOM 字符（iconv 的 utf-16le/be 不解 BOM，
 * utf-8 的 BOM 也会变成 U+FEFF 显示成乱码方块）。
 */
export function decodeTextWithEncoding(buf: Buffer, encoding: TextEncoding): string {
  const text = encoding === 'utf-8' ? buf.toString('utf-8') : iconv.decode(buf, encoding);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
