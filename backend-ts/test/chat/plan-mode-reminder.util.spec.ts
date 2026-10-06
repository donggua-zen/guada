import { buildPlanModeTurnEntries } from "../../src/modules/chat/plan-mode-reminder.util";
import type { ISessionContext } from "../../src/modules/chat/session-context";

/**
 * 计划模式引导注入：变体选择与一次性退出提醒。
 *
 * 这些条目只存在于请求数组，永不落库——测试要钉住的是"什么时候注入什么"，
 * 以及消息形态（role='user' 给模型权重、kind='model' 让 pickBaselineUserMessage 跳过）。
 */
describe("buildPlanModeTurnEntries", () => {
  function createContext(options: {
    planEnabled?: boolean;
    exitPending?: boolean;
  }) {
    let exitPending = options.exitPending ?? false;
    return {
      getPlanEnabled: () => options.planEnabled === true,
      consumePlanModeExitReminder: () => {
        const pending = exitPending;
        exitPending = false;
        return pending;
      },
    } as unknown as ISessionContext;
  }

  it("非计划态且无退出标记：不注入（门零开销）", () => {
    const entries = buildPlanModeTurnEntries(createContext({}), 1);
    expect(entries).toHaveLength(0);
  });

  it("计划态首迭代：注入完整工作流", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true }),
      1,
    );
    expect(entries).toHaveLength(1);
    const text = (entries[0].content[0] as any).text as string;
    expect(text).toContain("Plan mode is active");
    expect(text).toContain("Phase 1");
    expect(text).toContain("ExitPlanMode");
  });

  it("计划态后续迭代：退化为稀疏提醒（控制 token 成本）", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true }),
      2,
    );
    const text = (entries[0].content[0] as any).text as string;
    expect(text).toContain("Plan mode still active");
    expect(text).not.toContain("Phase 1");
  });

  it("注入形态：role='user' 拿模型权重，kind='model' 不污染模式切换基准", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true }),
      1,
    );
    const entry = entries[0];
    expect(entry.role).toBe("user");
    expect(entry.kind).toBe("model");
    expect(entry.metadata?.hidden).toBe(true);
    expect((entry.source as any).plugin).toBe("plan-mode");
  });

  it("退出标记：注入一次退出提醒，随即清除（不重复）", () => {
    const ctx = createContext({ exitPending: true });

    const first = buildPlanModeTurnEntries(ctx, 1);
    expect(first).toHaveLength(1);
    expect((first[0].content[0] as any).text).toContain("Exited Plan Mode");

    const second = buildPlanModeTurnEntries(ctx, 1);
    expect(second).toHaveLength(0);
  });

  it("退出提醒在计划态引导之前（先告知状态已变，再给新约束）", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true, exitPending: true }),
      1,
    );
    expect(entries).toHaveLength(2);
    expect((entries[0].content[0] as any).text).toContain("Exited Plan Mode");
    expect((entries[1].content[0] as any).text).toContain("Plan mode is active");
  });
});
