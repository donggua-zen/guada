/**
 * 长期记忆目录解析 —— 单一真相。
 *
 * 记忆 = 一个索引（MEMORY.md）+ 按需读取的明细文件，全部落在会话记忆目录下：
 *   主会话  → <workspace>/.guada/memory/
 *   子智能体 → <workspace>/.guada/subagents/<sessionId>/memory/（完全隔离）
 *
 * 本模块被记忆插件（索引注入/旧布局迁移）与记忆同步影子轮次（路径牢笼根）共同引用：
 * 注入的索引路径与牢笼根必须逐字相同，否则 AI 会写出上下文之外。
 * 不要再在别处各自实现这两条分支。
 */

import * as path from "path";

/** 索引文件名（注入上下文的唯一记忆文件） */
export const MEMORY_INDEX_FILE = "MEMORY.md";

/** 索引注入行数上限：超出部分不注入 */
export const MEMORY_INDEX_MAX_LINES = 200;

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
