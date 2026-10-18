import { TurnApprovalMemory } from "../../src/common/services/turn-approval-memory";

/**
 * 审批卡的「本轮内自动放行」记忆：按会话、回合内有效、开新回合清空。
 * 与 commandApprovalMemory / writeApprovalMemory 一致：进程内、不落盘。
 */
describe("TurnApprovalMemory", () => {
  let memory: TurnApprovalMemory;

  beforeEach(() => {
    memory = new TurnApprovalMemory();
  });

  it("默认不放行；allowForTurn 后该会话放行，其它会话不受影响", () => {
    expect(memory.isAllowed("s1")).toBe(false);

    memory.allowForTurn("s1");

    expect(memory.isAllowed("s1")).toBe(true);
    expect(memory.isAllowed("s2")).toBe(false);
  });

  it("beginTurn（新回合）清空该会话的放行状态", () => {
    memory.allowForTurn("s1");
    memory.allowForTurn("s2");

    memory.beginTurn("s1");

    expect(memory.isAllowed("s1")).toBe(false);
    expect(memory.isAllowed("s2")).toBe(true);
  });

  it("重复 allowForTurn 幂等（并发卡可能各触发一次）", () => {
    memory.allowForTurn("s1");
    memory.allowForTurn("s1");

    expect(memory.size()).toBe(1);
    expect(memory.isAllowed("s1")).toBe(true);
  });

  it("forgetSession / clear 清理", () => {
    memory.allowForTurn("s1");
    memory.forgetSession("s1");
    expect(memory.isAllowed("s1")).toBe(false);

    memory.allowForTurn("s1");
    memory.allowForTurn("s2");
    memory.clear();
    expect(memory.size()).toBe(0);
    expect(memory.isAllowed("s1")).toBe(false);
  });
});
