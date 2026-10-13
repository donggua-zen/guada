/**
 * 长期记忆目录解析 —— 单一真相。
 *
 * 记忆 = 一个索引（MEMORY.md）+ 按需读取的明细文件，全部落在会话记忆目录下：
 *   主会话  → <workspace>/.guada/memory/
 *   子智能体 → <workspace>/.guada/subagents/<sessionId>/memory/（完全隔离）
 *
 * 本模块被记忆插件（索引注入/旧布局迁移）、记忆同步影子轮次（路径牢笼根，当前休眠）
 * 与文件工具的索引上限守卫（写入时拒绝超限增长）共同引用：
 * 注入的索引路径、牢笼根与守卫目标必须逐字相同，否则 AI 会写出上下文之外，
 * 或出现"守卫放行但注入截断"的口径错位。不要再在别处各自实现这两条分支。
 */

import * as path from "path";

/** 索引文件名（注入上下文的唯一记忆文件） */
export const MEMORY_INDEX_FILE = "MEMORY.md";

/** 索引注入行数上限：超出部分不注入 */
export const MEMORY_INDEX_MAX_LINES = 200;

/** 索引硬上限（字节）：行数与字节取先到者。写入时超出且变长会被文件工具拒绝 */
export const MEMORY_INDEX_MAX_BYTES = 25600; // 25 KB

/** 索引软上限：超过即提示整理，不拒绝（注入侧与写入侧共用） */
export const MEMORY_INDEX_SOFT_LINES = 150;
export const MEMORY_INDEX_SOFT_BYTES = 20480; // 20 KB

/**
 * 索引行数统计 —— 注入截断与写入守卫必须共用同一口径。
 *
 * 忽略末尾的单个换行：否则"正好 200 行 + 文件末尾换行"会被算成 201 行，
 * 注入侧误报超限、写入侧误拒一次合法写入（两端口径不一致还会出现
 * "守卫放行但注入截断"的错位）。
 */
export function countIndexLines(text: string): number {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
}

/** 索引是否超过硬上限（行或字节，先到者算超） */
export function isIndexOverHardCap(
  lines: number,
  bytes: number,
): { over: boolean; detail: string[] } {
  const detail: string[] = [];
  if (lines > MEMORY_INDEX_MAX_LINES) {
    detail.push(`${lines} lines > ${MEMORY_INDEX_MAX_LINES}`);
  }
  if (bytes > MEMORY_INDEX_MAX_BYTES) {
    detail.push(`${bytes} bytes > ${MEMORY_INDEX_MAX_BYTES}`);
  }
  return { over: detail.length > 0, detail };
}

/** 索引是否超过软上限（未超硬时用于提示整理） */
export function isIndexOverSoftCap(lines: number, bytes: number): boolean {
  return lines > MEMORY_INDEX_SOFT_LINES || bytes > MEMORY_INDEX_SOFT_BYTES;
}

/** 会话类型判定所需的会话身份（只读投影，避免依赖完整 session 对象） */
export interface MemoryScopeRef {
  workspacePath: string;
  sessionId: string;
  sessionType?: string | null;
}

/** 记忆相关文件所在的 .guada 基目录（memory/ 与 memos/ 的父目录） */
export function resolveGuadaMemoryBase(ref: MemoryScopeRef): string {
  return ref.sessionType === "sub_agent"
    ? path.join(ref.workspacePath, ".guada", "subagents", ref.sessionId)
    : path.join(ref.workspacePath, ".guada");
}

/** 会话记忆目录（= 记忆维护的路径牢笼根，绝对路径，不做存在性保证） */
export function resolveMemoryDir(ref: MemoryScopeRef): string {
  return path.join(resolveGuadaMemoryBase(ref), "memory");
}

/** 索引文件绝对路径 */
export function resolveMemoryIndexPath(ref: MemoryScopeRef): string {
  return path.join(resolveMemoryDir(ref), MEMORY_INDEX_FILE);
}
