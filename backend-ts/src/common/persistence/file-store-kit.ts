import * as fsp from "fs/promises";
import { randomUUID } from "crypto";

/**
 * 文件存储机制件（file-store primitives）
 *
 * 各域 FileStore 的共性「机制」收敛于此——机制是公共的，store 是策略、
 * 归各域私有。此前 atomicWrite 在 5 个 store + jsonl-backend 各自实现一份
 * （连 tmp 后缀格式都不同）、generateId 有 3 种形态、iso() 容错两处私有，
 * 本文件是它们的单一真相。
 *
 * 纯函数、无 DI：直接 import 使用，不经 Nest 容器。
 */

/**
 * 原子写：tmp + rename，Windows EPERM/EBUSY/EACCES 退避重试。
 *
 * 语义是「整体替换目标文件」：先写 tmp，再 rename 覆盖。不适用于
 * append 语义（JSONL 追加走 jsonl-backend 自己的路径）。
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmpPath, content, "utf8");
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      try {
        await fsp.unlink(filePath);
      } catch {
        /* 目标不存在 */
      }
      await fsp.rename(tmpPath, filePath);
      return;
    } catch (err: any) {
      lastErr = err;
      if (
        err?.code !== "EPERM" &&
        err?.code !== "EBUSY" &&
        err?.code !== "EACCES"
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
  await fsp.unlink(tmpPath).catch(() => undefined);
  throw lastErr;
}

/** 删除文件，ENOENT 视为成功，其余错误短退避重试 3 次（Windows 句柄抖动） */
export async function removeFileWithRetry(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fsp.unlink(filePath);
      return;
    } catch (err: any) {
      if (err?.code === "ENOENT") return;
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

/**
 * 铸造新 id：`<prefix><uuid v4>`。
 *
 * 会话 id 已采用此形态（session-<uuid>，DSH 同款）；bot/mcp 由原
 * `c<base36时间><随机>` 统一到此前缀 + uuid。id 只作目录/文件名使用，
 * 全代码库无格式假设，存量 id 不受影响。
 */
export function mintId(prefix = ""): string {
  return `${prefix}${randomUUID()}`;
}

/**
 * 时间字段的容错归一：接受 Date / 时间戳 / ISO 字符串（js-yaml 会把
 * 未加引号的 ISO 解析成 Date，只认字符串会让该字段静默回落到「当前时间」）。
 * 无法解析返回 null。
 */
export function iso(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
