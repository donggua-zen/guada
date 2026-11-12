/**
 * 读 PNG / WebP 的像素尺寸：只解析文件头，不解码像素。
 *
 * 为什么需要它：Electron 的 `nativeImage` **不支持 WebP**
 * （`createFromPath` 返回空图、`getSize()` 是 0×0），而 Codex 图集正是 WebP；
 * 主进程又不该引 sharp（那是后端的原生依赖）。
 *
 * 独立成文件是刻意的：不 import electron，纯 node 就能单测。
 */
import * as fs from "fs";

export interface ImageSize {
  width: number;
  height: number;
}

/** PNG 头 8 字节 + IHDR 宽高（大端） */
function readPng(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** WebP 三种子格式（VP8X 扩展 / VP8 有损 / VP8L 无损） */
function readWebp(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WEBP") return null;

  const fourCC = buf.toString("ascii", 12, 16);
  if (fourCC === "VP8X") {
    // 24..26 宽-1（24 位小端），27..29 高-1
    const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
    const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (fourCC === "VP8 ") {
    // 帧头 3 字节 + 起始码 9D 01 2A，随后 14 位宽、14 位高
    if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return {
        width: (buf[26] | (buf[27] << 8)) & 0x3fff,
        height: (buf[28] | (buf[29] << 8)) & 0x3fff,
      };
    }
    return null;
  }
  if (fourCC === "VP8L") {
    // 签名 0x2F 后 4 字节：bit0-13 宽-1、bit14-27 高-1
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** 解析给定字节头；识别不了返回 null（调用方按「无法识别」处理） */
export function parseImageSize(buf: Buffer): ImageSize | null {
  return readPng(buf) ?? readWebp(buf);
}

/** 读文件头判断尺寸；文件不存在/格式不认识返回 null */
export function readImageSize(filePath: string): ImageSize | null {
  let buf: Buffer;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      buf = Buffer.alloc(32);
      fs.readSync(fd, buf, 0, 32, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return parseImageSize(buf);
}
