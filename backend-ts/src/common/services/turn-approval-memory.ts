/**
 * 审批卡的「本轮内自动放行」状态。
 *
 * 语义：用户在任意一张审批卡上选中「本轮内自动放行」后，**本回合内**后续所有审批
 * （命令 / 敏感路径 / 越界写入）直接按"允许"通过，不再弹卡；本轮已排队的卡一并放行。
 *
 * 为什么按 sessionId 而不是 turnId：同一会话同时最多一个活动回合（chat-runner 的
 * SESSION_BUSY + stream manager 的单流约束），且工具层拿不到 turnId；因此
 * 「按会话记录 + beginTurn 时清空」与"本轮"等价。
 *
 * 与 commandApprovalMemory / writeApprovalMemory 一致：内存态、进程重启即失效、不落盘。
 */

export class TurnApprovalMemory {
  /** 已选择"本轮内自动放行"的会话 */
  private readonly allowed = new Set<string>();

  /** 本轮后续审批直接放行 */
  allowForTurn(sessionId: string): void {
    this.allowed.add(sessionId);
  }

  /** 该会话当前回合是否处于自动放行 */
  isAllowed(sessionId: string): boolean {
    return this.allowed.has(sessionId);
  }

  /** 新回合开始：清空（下一条用户消息恢复逐次询问） */
  beginTurn(sessionId: string): void {
    this.allowed.delete(sessionId);
  }

  /** 会话结束时清理 */
  forgetSession(sessionId: string): void {
    this.allowed.delete(sessionId);
  }

  /** 测试/诊断用 */
  clear(): void {
    this.allowed.clear();
  }

  /** 测试/诊断用 */
  size(): number {
    return this.allowed.size;
  }
}

/** 进程内单例（与"本轮内存态"语义一致） */
export const turnApprovalMemory = new TurnApprovalMemory();
