/**
 * 文件写入审批：会话内路径记忆（命令审批记忆在文件工具上的对偶，见 command-policy/approval-memory.ts）。
 *
 * 「本次允许 / 本会话内始终允许该路径」中的后者存在这里：内存态、按会话隔离、进程重启即失效。
 * 刻意不做持久化（不做项目级规则），也不做目录前缀匹配——只记**解析后的绝对路径**，
 * 避免"记住 D:\data\x.json"顺手把同目录其他文件也放行。
 */

import * as path from "path";

/** 路径规范化：resolve 归一（`..`/相对段）；Windows 路径大小写不敏感，统一小写 */
export function normalizePathKey(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 单会话最多记住多少条路径（防止异常长的会话把内存撑爆） */
const MAX_ENTRIES_PER_SESSION = 200;

export class WriteApprovalMemory {
  private readonly granted = new Map<string, Set<string>>();

  /** 该路径是否已被本会话记住 */
  has(sessionId: string, targetPath: string): boolean {
    const set = this.granted.get(sessionId);
    if (!set) return false;
    return set.has(normalizePathKey(targetPath));
  }

  /** 记住一条路径（会话内有效） */
  remember(sessionId: string, targetPath: string): void {
    let set = this.granted.get(sessionId);
    if (!set) {
      set = new Set();
      this.granted.set(sessionId, set);
    }
    const key = normalizePathKey(targetPath);
    if (set.size >= MAX_ENTRIES_PER_SESSION && !set.has(key)) {
      // 简单的容量控制：丢掉最早插入的一条
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    set.add(key);
  }

  /** 会话结束时清理 */
  forgetSession(sessionId: string): void {
    this.granted.delete(sessionId);
  }

  /** 测试/诊断用 */
  clear(): void {
    this.granted.clear();
  }

  /** 测试/诊断用 */
  size(): number {
    return this.granted.size;
  }
}

/** 进程内单例（与"会话内存态"语义一致） */
export const writeApprovalMemory = new WriteApprovalMemory();
