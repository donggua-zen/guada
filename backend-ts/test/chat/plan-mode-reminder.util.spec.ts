import { buildPlanModeTurnEntries } from "../../src/modules/chat/plan-mode-reminder.util";
import type { ISessionContext } from "../../src/modules/chat/session-context";
import type { ResolvedPluginInfo } from "../../src/modules/plugins/types/plugin.types";

/**
 * 计划模式引导注入：变体选择、一次性退出提醒、以及"提示词与工具面一致"的注入门。
 *
 * 这些条目只存在于请求数组，永不落库——测试要钉住的是"什么时候注入什么"，
 * 以及消息形态（role='user' 给模型权重、kind='model' 让 pickBaselineUserMessage 跳过）。
 */
describe("buildPlanModeTurnEntries", () => {
  function createContext(options: {
    planEnabled?: boolean;
    exitPending?: boolean;
    sessionType?: string;
    /** 本会话实际解析出的工具名；缺省 = 计划工具包在册、子代理工具也在册 */
    tools?: string[];
  }) {
    let exitPending = options.exitPending ?? false;
    const tools = options.tools ?? ["ExitPlanMode", "subagent_spawn"];
    return {
      sessionType: options.sessionType ?? "web",
      getPlanEnabled: () => options.planEnabled === true,
      consumePlanModeExitReminder: () => {
        const pending = exitPending;
        exitPending = false;
        return pending;
      },
      // findTool 只认 enabled 插件下的 enabledTools，桩按同一形状给
      getResolvedPlugins: () =>
        [
          {
            enabled: true,
            enabledTools: tools.map((name) => ({ name })),
            enabledToolKits: [],
          },
        ] as unknown as ResolvedPluginInfo[],
    } as unknown as ISessionContext;
  }

  const textOf = (entry: { content: unknown[] }): string =>
    ((entry.content[0] as { text?: string })?.text ?? "") as string;

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
    const text = textOf(entries[0] as any);
    expect(text).toContain("Plan mode is active");
    expect(text).toContain("Phase 1");
    expect(text).toContain("ExitPlanMode");
  });

  it("计划态后续迭代：退化为稀疏提醒（控制 token 成本）", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true }),
      2,
    );
    const text = textOf(entries[0] as any);
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
    expect(entry.metadata?.transient).toBe(true);
  });

  it("退出标记：注入一次退出提醒，随即清除（不重复）", () => {
    const ctx = createContext({ exitPending: true });

    const first = buildPlanModeTurnEntries(ctx, 1);
    expect(first).toHaveLength(1);
    expect(textOf(first[0] as any)).toContain("Exited Plan Mode");

    const second = buildPlanModeTurnEntries(ctx, 1);
    expect(second).toHaveLength(0);
  });

  it("退出提醒在计划态引导之前（先告知状态已变，再给新约束）", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true, exitPending: true }),
      1,
    );
    expect(entries).toHaveLength(2);
    expect(textOf(entries[0] as any)).toContain("Exited Plan Mode");
    expect(textOf(entries[1] as any)).toContain("Plan mode is active");
  });

  // ── 注入门：提示词与工具面必须一致 ──
  // 工具面按会话类型/配置摘掉的东西，提示词里就不能再引导模型去调，否则模型被指挥去
  // 调用一个它看不见的工具，只会空转。

  it("子代理工具在册：Phase 1 引导并行派子代理调研", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true, tools: ["ExitPlanMode", "subagent_spawn"] }),
      1,
    );
    const text = textOf(entries[0] as any);
    expect(text).toContain("launch up to 3 read-only research sub-agents in parallel");
    expect(text).toContain("do not also run it yourself");
    // 复用优先的原始意图不能被子代理引导挤掉
    expect(text).toContain("avoid proposing new code when suitable implementations already exist");
  });

  it("子代理工具不在册（插件关 / 智能体 deny）：Phase 1 退回直查文案，且不提子代理", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true, tools: ["ExitPlanMode"] }),
      1,
    );
    const text = textOf(entries[0] as any);
    expect(text).toContain("Use them to investigate the repository state");
    expect(text).not.toContain("sub-agent");
    expect(text).not.toContain("subagent_spawn");
  });

  it("子代理会话：即使计划模式开着也不注入（计划模式对子代理不可见）", () => {
    const getResolvedPlugins = jest.fn(() => [] as ResolvedPluginInfo[]);
    const ctx = {
      sessionType: "sub_agent",
      getPlanEnabled: () => true,
      consumePlanModeExitReminder: () => false,
      getResolvedPlugins,
    } as unknown as ISessionContext;

    expect(buildPlanModeTurnEntries(ctx, 1)).toHaveLength(0);
    // 会话类型前置条件应早于任何工具查询，连解析都不必碰
    expect(getResolvedPlugins).not.toHaveBeenCalled();
  });

  it("ExitPlanMode 不在册：不注入，不引导模型调不存在的工具", () => {
    const entries = buildPlanModeTurnEntries(
      createContext({ planEnabled: true, tools: ["subagent_spawn"] }),
      1,
    );
    expect(entries).toHaveLength(0);
  });
});
