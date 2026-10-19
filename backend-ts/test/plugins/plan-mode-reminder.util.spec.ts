import {
  buildPlanModeTurnInjection,
  findLatestPlanModeMarker,
} from "../../src/modules/plugins/builtins/plan-mode-reminder.util";
import type { ISessionContext } from "../../src/modules/chat/session-context";
import type { Message } from "../../src/common/types/conversation.types";
import type { ResolvedPluginInfo } from "../../src/modules/plugins/types/plugin.types";

/**
 * 计划模式 reminder provider：
 * - 完整提醒按 epoch 落库一份，后续迭代只给稀疏临时提醒；
 * - 压缩遮蔽后重新落库；
 * - 退出后靠历史标记补一条持久化退出说明，不再依赖一次性 flag。
 */
describe("buildPlanModeTurnInjection", () => {
  function createContext(options: {
    planEnabled?: boolean;
    epoch?: string | null;
    pluginEnabled?: boolean;
    sessionType?: string;
    /** 本会话实际解析出的工具名；缺省 = 计划工具包、子代理工具都在册 */
    tools?: string[];
    askUser?: boolean;
    subAgentTool?: boolean;
  }) {
    const tools = options.tools ?? [
      "ExitPlanMode",
      ...(options.askUser === false ? [] : ["ask_user"]),
      ...(options.subAgentTool === false ? [] : ["subagent_spawn"]),
    ];
    return {
      sessionId: "s-plan",
      sessionType: options.sessionType ?? "web",
      getPlanEnabled: () => options.planEnabled === true,
      getPlanModeEpoch: () =>
        options.epoch === undefined ? "epoch-1" : options.epoch,
      getResolvedPlugins: () =>
        [
          {
            enabled: options.pluginEnabled !== false,
            effective: "default",
            plugin: { id: "plan-mode" },
            enabledTools: tools.map((name) => ({ name })),
            allTools: [],
            enabledToolKits: [],
          },
        ] as unknown as ResolvedPluginInfo[],
      generateMessageId: (() => {
        let n = 0;
        return () => `m-${++n}`;
      })(),
    } as unknown as ISessionContext;
  }

  function markerMessage(
    kind: "full" | "exit",
    epoch: string,
    extra: Record<string, any> = {},
  ): Message {
    return {
      id: `m-${kind}-${epoch}`,
      role: "user",
      kind: "model",
      source: { kind: "plugin", plugin: "plan-mode" },
      metadata: {
        planModeReminder: kind,
        planModeEpoch: epoch,
        ...extra,
      },
      content: [{ type: "text", text: "marker" }],
    };
  }

  const textOf = (message: Message): string =>
    ((message.content[0] as { text?: string })?.text ?? "").toString();

  it("非计划态且无历史标记：不注入", () => {
    const result = buildPlanModeTurnInjection(createContext({}), 1, []);
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("计划态首迭代且无完整提醒：落库一条完整工作流", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true }),
      1,
      [],
    );
    expect(result.persist).toHaveLength(1);
    expect(result.transient ?? []).toHaveLength(0);
    const message = result.persist![0];
    expect(textOf(message)).toContain("<system_reminder>");
    expect(textOf(message)).toContain("</system_reminder>");
    expect(textOf(message)).toContain("Plan mode is active");
    expect(textOf(message)).toContain("Phase 1");
    expect(textOf(message)).toContain("ExitPlanMode");
    expect(message.kind).toBe("model");
    expect(message.metadata?.hidden).toBe(true);
    expect(message.metadata?.planModeReminder).toBe("full");
    expect(message.metadata?.planModeEpoch).toBe("epoch-1");
    expect(message.metadata?.transient).toBeUndefined();
  });

  it("当前 epoch 已有完整提醒：首迭代不重复注入", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true }),
      1,
      [markerMessage("full", "epoch-1")],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("当前 epoch 已有完整提醒：后续迭代只给稀疏临时提醒", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true }),
      2,
      [markerMessage("full", "epoch-1")],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient).toHaveLength(1);
    const message = result.transient![0];
    expect(textOf(message)).toContain("<system_reminder>");
    expect(textOf(message)).toContain("</system_reminder>");
    expect(textOf(message)).toContain("Plan mode still active");
    expect(textOf(message)).not.toContain("Phase 1");
    expect(message.metadata?.transient).toBe(true);
    expect(message.metadata?.planModeReminder).toBeUndefined();
  });

  it("完整提醒被压缩遮蔽（历史里找不到）：后续迭代重新落库", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true }),
      2,
      [],
    );
    expect(result.persist).toHaveLength(1);
    expect(result.persist![0].metadata?.planModeReminder).toBe("full");
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("旧 epoch 的完整提醒不算数：重进计划模式会落新的一份", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, epoch: "epoch-2" }),
      1,
      [markerMessage("full", "epoch-1")],
    );
    expect(result.persist).toHaveLength(1);
    expect(result.persist![0].metadata?.planModeEpoch).toBe("epoch-2");
  });

  it("已退出且最近标记是 full：落一条持久化退出说明", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: false }),
      1,
      [markerMessage("full", "epoch-1")],
    );
    expect(result.persist).toHaveLength(1);
    const message = result.persist![0];
    expect(textOf(message)).toContain("<system_reminder>");
    expect(textOf(message)).toContain("</system_reminder>");
    expect(textOf(message)).toContain("Exited Plan Mode");
    expect(textOf(message)).toContain("no longer apply");
    expect(message.metadata?.planModeReminder).toBe("exit");
    expect(message.metadata?.planModeEpoch).toBe("epoch-1");
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("已退出且最近标记是 exit：不重复落退出说明", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: false }),
      1,
      [markerMessage("full", "epoch-1"), markerMessage("exit", "epoch-1")],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("ExitPlanMode 不在册时不引导计划态（提示词与工具面一致）", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, tools: ["ask_user", "subagent_spawn"] }),
      1,
      [],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("plan-mode 插件被禁用：即使计划态开着也不注入", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, pluginEnabled: false }),
      1,
      [],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  it("子代理会话：即使计划模式开着也不注入", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, sessionType: "sub_agent" }),
      1,
      [],
    );
    expect(result.persist ?? []).toHaveLength(0);
    expect(result.transient ?? []).toHaveLength(0);
  });

  // ── 工具面文案分支 ──

  it("ask_user 在册：Phase 1/3/4 引导使用 ask_user，且批准只走 ExitPlanMode", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, askUser: true }),
      1,
      [],
    );
    const text = textOf(result.persist![0]);
    expect(text).toContain("ask with the ask_user tool instead of guessing");
    expect(text).toContain(
      "Use the ask_user tool to clarify any remaining questions with the user before finalizing your plan.",
    );
    expect(text).toContain("Ask for plan approval ONLY via ExitPlanMode");
  });

  it("ask_user 不在册：退回文本提问，且全篇不提 ask_user", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, askUser: false }),
      1,
      [],
    );
    const text = textOf(result.persist![0]);
    expect(text).toContain("end your turn with your question");
    expect(text).not.toContain("ask_user");
  });

  it("subagent_spawn 在册：Phase 1 引导并行派只读子代理", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, subAgentTool: true }),
      1,
      [],
    );
    const text = textOf(result.persist![0]);
    expect(text).toContain(
      "launch up to 3 read-only research sub-agents in parallel",
    );
  });

  it("subagent_spawn 不在册：Phase 1 退回直接调查，不提子代理", () => {
    const result = buildPlanModeTurnInjection(
      createContext({ planEnabled: true, subAgentTool: false }),
      1,
      [],
    );
    const text = textOf(result.persist![0]);
    expect(text).toContain("investigate the repository state");
    expect(text).not.toContain("sub-agent");
    expect(text).not.toContain("subagent_spawn");
  });
});

describe("findLatestPlanModeMarker", () => {
  const marker = (
    kind: "full" | "exit",
    epoch: string,
  ): Message => ({
    id: `${kind}-${epoch}`,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "plan-mode" },
    metadata: { planModeReminder: kind, planModeEpoch: epoch },
    content: [{ type: "text", text: "x" }],
  });

  it("返回最近一条标记", () => {
    expect(
      findLatestPlanModeMarker([
        marker("full", "e1"),
        { id: "u", role: "user", kind: "user", content: [] } as Message,
        marker("exit", "e1"),
      ]),
    ).toEqual({ kind: "exit", epoch: "e1" });
  });

  it("没有标记返回 null", () => {
    expect(findLatestPlanModeMarker([])).toBeNull();
    expect(
      findLatestPlanModeMarker([
        { id: "u", role: "user", kind: "user", content: [] } as Message,
      ]),
    ).toBeNull();
  });
});
