/**
 * 命令策略：会话内审批记忆。
 *
 * 「本次允许 + 本会话内始终允许」中的后者存在这里：内存态、按会话隔离、进程重启即失效。
 * 刻意不做持久化（不做项目级规则），也不做前缀模糊匹配——只记**规范化后的命令全文**，
 * 避免"记住 git push"顺手把 `git push --force` 也放行。
 */

/** 命令规范化：折叠空白、去首尾（引号内容保持不变） */
export function normalizeCommandKey(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/** 单会话最多记住多少条命令（防止异常长的会话把内存撑爆） */
const MAX_ENTRIES_PER_SESSION = 200;

export class CommandApprovalMemory {
  private readonly granted = new Map<string, Set<string>>();

  /** 该命令是否已被本会话记住 */
  has(sessionId: string, command: string): boolean {
    const set = this.granted.get(sessionId);
    if (!set) return false;
    return set.has(normalizeCommandKey(command));
  }

  /** 记住一条命令（会话内有效） */
  remember(sessionId: string, command: string): void {
    let set = this.granted.get(sessionId);
    if (!set) {
      set = new Set();
      this.granted.set(sessionId, set);
    }
    const key = normalizeCommandKey(command);
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
export const commandApprovalMemory = new CommandApprovalMemory();
