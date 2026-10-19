import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PlanModePlugin } from "../../src/modules/plugins/builtins/plan-mode.plugin";
import { PlanFileService } from "../../src/common/services/plan-file.service";
import { AskService } from "../../src/common/services/ask.service";
import { AskDeniedError } from "../../src/common/types/ask.types";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";
import { ToolHandlerDef, ToolKitDef } from "../../src/modules/plugins/types/plugin.types";

/**
 * 计划模式插件：审批三条路径的语义 + 工具包可见性。
 *
 * 重点不是"工具能跑通"，而是三条路径各自的状态后果：
 * 批准 → 退出计划态 + 落盘 + 审计 + 流帧；拒绝 → 计划态保持；有反馈 → 反馈作为真实 user 消息。
 */
describe("PlanModePlugin", () => {
  let workspaceDir: string;
  let plugin: PlanModePlugin;
  let registered: ToolHandlerDef[];
  let kitDef: ToolKitDef | undefined;
  let askResult: any[];
  let planFile: PlanFileService;
  /** beforeEach 实例的 ask 替身（断言卡片契约用） */
  let askMock: jest.Mock;
  /** onLoad 注册的每轮提醒 provider */
  let reminderProvider: any;

  function createSession(overrides: Record<string, any> = {}) {
    let planEnabled = overrides.planEnabled !== false;
    return {
      // 允许用例指定会话 id（并发守卫是按会话隔离的）
      sessionId: overrides.sessionId ?? "s-plan-1",
      sessionType: "web",
      workspacePath: workspaceDir,
      getPlanEnabled: jest.fn(() => planEnabled),
      setPlanEnabled: jest.fn(async (v: boolean) => {
        planEnabled = v;
      }),
      getSandboxMode: jest.fn(() => "workspace-write"),
      getWorkspacePath: jest.fn(() => workspaceDir),
      appendSessionModeChanged: jest.fn().mockResolvedValue(undefined),
      publishStream: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  function exitTool(): ToolHandlerDef {
    const found = registered.find((t) => t.name === "ExitPlanMode");
    if (!found) throw new Error("ExitPlanMode not registered");
    return found;
  }

  /**
   * 装配一个插件实例（可注入自定义 ask 实现）。
   * 每个实例自带工具表（`registered` 指向最新实例，外层 exitTool() 因此对 beforeEach 的实例仍有效）。
   */
  async function createPlugin(askImpl?: (...args: any[]) => Promise<any>) {
    registered = [];
    const api = {
      registerToolKit: (def: ToolKitDef) => {
        kitDef = def; // 工具包可见性用例要拿到 handler
        return {
          // 真实 toolkit 会把 def.execute 包装成 handler；mock 复刻这层，否则被测代码拿不到 handler
          registerTool: (def: any) => {
            registered.push({
              ...def,
              handler: (args: any, ctx: any, signal: any) => def.execute(args, ctx, signal),
            } as ToolHandlerDef);
          },
        };
      },
      registerTurnReminderProvider: jest.fn((provider: any) => {
        reminderProvider = provider;
      }),
    } as unknown as PluginApi;

    const askService = {
      ask: jest.fn(askImpl ?? (async () => askResult)),
    } as unknown as AskService & { ask: jest.Mock };

    const created = new PlanModePlugin(askService, planFile);
    await created.onLoad(api);
    return {
      plugin: created,
      askService,
      exitTool: (): ToolHandlerDef => {
        const found = registered.find((t) => t.name === "ExitPlanMode");
        if (!found) throw new Error("ExitPlanMode not registered");
        return found;
      },
    };
  }

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-mode-spec-"));
    planFile = new PlanFileService();
    kitDef = undefined;
    reminderProvider = undefined;
    const built = await createPlugin();
    plugin = built.plugin;
    askMock = built.askService.ask as jest.Mock;
  });

  it("onLoad 注册每轮提醒 provider（引擎不感知计划模式）", () => {
    expect(reminderProvider).toMatchObject({
      id: "plan-mode-reminders",
      order: 100,
    });
    expect(typeof reminderProvider.build).toBe("function");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("注册了 ExitPlanMode，且带逃生舱与需人类应答两个能力声明", () => {
    const tool = exitTool();
    expect(tool.allowedInPlanMode).toBe(true);
    expect(tool.requiresUserInteraction).toBe(true);
    // 不声明 readOnly：它不是只读工具，靠逃生舱在计划态放行
    expect(tool.readOnly).toBeUndefined();
  });

  it("不在计划态：返回错误且不落盘", async () => {
    const session = createSession({ planEnabled: false });

    const result = (await exitTool().handler({ plan: "# 计划" }, { session } as any)) as any;

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Not in plan mode");
    const found = await planFile.readLatestPlan({
      workspacePath: workspaceDir,
      sessionId: session.sessionId,
    });
    expect(found).toBeNull();
  });

  it("批准：落盘 + 退出计划态 + 写审计事件 + 发流帧", async () => {
    askResult = [{ id: "plan", selected: ["批准"] }];
    const session = createSession();

    const result = (await exitTool().handler({ plan: "# 计划\n\n步骤一" }, { session, toolCallId: "tc1" } as any)) as any;

    expect(result.isError).toBeUndefined();

    // 卡片类型显式声明（前端据此走计划专属渲染，不再靠 toolName 反推）
    expect(askMock.mock.calls[0][1].cardKind).toBe("plan-approval");

    // 落盘：路径由 workspace + sessionId + planId(toolCallId) 推导（每份计划一个文件）
    const found = await planFile.readPlan({
      workspacePath: workspaceDir,
      sessionId: session.sessionId,
      planId: "tc1",
    });
    expect(found?.content).toContain("步骤一");
    expect(found?.path).toBe(
      path.join(workspaceDir, ".guada", "plans", session.sessionId, "tc1.md"),
    );

    // 状态翻转 + 持久化调用
    expect(session.setPlanEnabled).toHaveBeenCalledWith(false);

    // 审计事件与流帧（两者都带 toolCallId，便于回溯是哪次调用退出的）
    expect(session.appendSessionModeChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        planEnabled: false,
        previousPlanEnabled: true,
        source: "tool",
        toolCallId: "tc1",
      }),
    );
    expect(session.publishStream).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plan_mode_changed",
        planEnabled: false,
        source: "tool",
      }),
    );

    // 回给模型的正文包含已批准计划全文
    expect(result.content).toContain("User has approved your plan");
    expect(result.content).toContain("步骤一");
  });

  it("拒绝（无反馈）：错误结果 + 计划态保持 + 不追加用户消息", async () => {
    askResult = [{ id: "plan", selected: ["拒绝"] }];
    const session = createSession();

    const result = (await exitTool().handler({ plan: "# 计划" }, { session } as any)) as any;

    expect(result.isError).toBe(true);
    expect(result.followUpUserInput).toBeUndefined();
    expect(result.content).toContain("not approved");
    expect(session.setPlanEnabled).not.toHaveBeenCalled();
    expect(session.publishStream).not.toHaveBeenCalled();
  });

  it("拒绝（有反馈）：反馈转为 followUpUserInput（真实 user 消息），计划态保持", async () => {
    askResult = [{ id: "plan", selected: ["拒绝"], custom: "把第二步拆成两步" }];
    const session = createSession();

    const result = (await exitTool().handler({ plan: "# 计划" }, { session } as any)) as any;

    expect(result.isError).toBe(true);
    expect(result.followUpUserInput).toBe("把第二步拆成两步");
    expect(result.content).toContain("not approved");
    expect(session.setPlanEnabled).not.toHaveBeenCalled();
  });

  it("自定义回复优先于选项：点了批准但带文字说明，仍按拒绝+反馈处理", async () => {
    askResult = [{ id: "plan", selected: ["批准"], custom: "先补测试再实施" }];
    const session = createSession();

    const result = (await exitTool().handler({ plan: "# 计划" }, { session } as any)) as any;

    expect(result.isError).toBe(true);
    expect(result.followUpUserInput).toBe("先补测试再实施");
    expect(session.setPlanEnabled).not.toHaveBeenCalled();
  });

  it("空白计划：落盘失败即中止，状态不翻转", async () => {
    askResult = [{ id: "plan", selected: ["批准"] }];
    const session = createSession();

    await expect(
      exitTool().handler({ plan: "   " }, { session } as any),
    ).rejects.toThrow(/cannot be empty/);

    expect(session.setPlanEnabled).not.toHaveBeenCalled();
    expect(session.publishStream).not.toHaveBeenCalled();
  });

  describe("并发提交守卫：同一会话只允许一份计划在途", () => {
    /** 等到 mock 被调用 n 次（第一路要先过异步写盘才到 ask） */
    async function waitForCalls(mock: jest.Mock, n: number): Promise<void> {
      for (let i = 0; i < 200 && mock.mock.calls.length < n; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(mock.mock.calls.length).toBeGreaterThanOrEqual(n);
    }

    /** 可控闸门：所有 ask 调用返回同一个 promise，release() 后一起放行 */
    function gate() {
      let release!: (answers: any) => void;
      const promise = new Promise<any>((resolve) => {
        release = resolve;
      });
      return { promise, release: (answers: any) => release(answers) };
    }

    it("同会话并发两次：后到的那次立即失败，且不写第二个计划文件", async () => {
      const g = gate();
      const built = await createPlugin(() => g.promise);
      const session = createSession();

      // 第一路：进入守卫后挂在审批上（用户还没答）
      const first = built.exitTool().handler({ plan: "# 计划一" }, { session, toolCallId: "call-1" } as any);
      await waitForCalls(built.askService.ask, 1);

      // 第二路：同一会话 → 立即失败（守卫在写盘/发卡之前就拦下）
      const second = (await built.exitTool().handler(
        { plan: "# 计划二" },
        { session, toolCallId: "call-2" } as any,
      )) as any;
      expect(second.isError).toBe(true);
      expect(second.content).toContain("already waiting for the user's approval");
      // 没有发第二张审批卡
      expect(built.askService.ask).toHaveBeenCalledTimes(1);
      // 也没有留下第二个计划文件（守卫在写盘之前）
      const dir = path.join(workspaceDir, ".guada", "plans", session.sessionId);
      await expect(fs.readdir(dir)).resolves.toHaveLength(1);

      // 收尾：放行第一路
      g.release([{ id: "plan", selected: ["拒绝"] }]);
      await first;
    });

    it("守卫释放：第一路被拒之后，同一会话可以再提交", async () => {
      const g = gate();
      const built = await createPlugin(() => g.promise);
      const session = createSession();

      const first = built.exitTool().handler({ plan: "# 计划一" }, { session, toolCallId: "call-1" } as any);
      g.release([{ id: "plan", selected: ["拒绝"] }]); // 拒绝 → 计划态保持
      const firstResult = (await first) as any;
      expect(firstResult.isError).toBe(true);

      // 守卫已释放 → 再提交能正常进入（第二次 ask）
      const second = (await built.exitTool().handler(
        { plan: "# 计划二" },
        { session, toolCallId: "call-2" } as any,
      )) as any;
      expect(second.content).not.toContain("already waiting");
      expect(built.askService.ask).toHaveBeenCalledTimes(2);
    });

    it("会话隔离：不同会话可以各自有一份计划在途", async () => {
      const g = gate();
      const built = await createPlugin(() => g.promise);
      const sessionA = createSession({ sessionId: "s-a" } as any);
      const sessionB = createSession({ sessionId: "s-b" } as any);

      const first = built.exitTool().handler({ plan: "# A" }, { session: sessionA, toolCallId: "a1" } as any);
      const second = built.exitTool().handler({ plan: "# B" }, { session: sessionB, toolCallId: "b1" } as any);

      // 两路都进入了守卫（各自挂在自己的审批上；不因会话不同而互相拦截）
      await waitForCalls(built.askService.ask, 2);

      g.release([{ id: "plan", selected: ["拒绝"] }]);
      await Promise.all([first, second]);
    });

    it("用户停止（ask 抛 cancelled）后守卫释放，不会把会话锁死", async () => {
      let cancelled = true;
      const built = await createPlugin(async () => {
        if (cancelled) throw new AskDeniedError("用户已停止", "cancelled");
        return [{ id: "plan", selected: ["拒绝"] }];
      });
      const session = createSession();

      await expect(
        built.exitTool().handler({ plan: "# 计划一" }, { session, toolCallId: "call-1" } as any),
      ).rejects.toBeInstanceOf(AskDeniedError);

      // 守卫必须已释放：下一次提交能正常进入
      cancelled = false;
      const retry = (await built.exitTool().handler(
        { plan: "# 计划二" },
        { session, toolCallId: "call-2" } as any,
      )) as any;
      expect(retry.content).not.toContain("already waiting");
      expect(built.askService.ask).toHaveBeenCalledTimes(2);
    });
  });

  describe("工具包可见性：计划模式对子代理不可见", () => {
    // 整个工具包（连同 ExitPlanMode）都不该进子代理的 enabledTools。与 subagent / workflow
    // 工具包同一手法（handler 返回 loadMode:none）。提示词面由 plan-mode-reminder.util 的
    // 会话类型前置条件对应收口——两处必须同时成立，只做一处就会出现"引导模型调一个它看不见的工具"。
    const kitHandler = () => {
      if (!kitDef?.handler) throw new Error("工具包未注册 handler");
      return kitDef.handler;
    };

    it("子代理会话 → loadMode: none", async () => {
      const runtime = await kitHandler()({ session: { sessionType: "sub_agent" } } as any);
      expect(runtime).toEqual({ loadMode: "none" });
    });

    it("主会话 → 不改动 loadMode（沿用声明的默认 eager）", async () => {
      const runtime = await kitHandler()({ session: { sessionType: "web" } } as any);
      expect(runtime).toEqual({});
    });

    it("其它会话类型（bot / scheduler）不受影响", async () => {
      for (const sessionType of ["bot", "scheduler", "web"]) {
        const runtime = await kitHandler()({ session: { sessionType } } as any);
        expect(runtime).toEqual({});
      }
    });
  });

  describe("压缩后重注入", () => {
    it("存在已批准计划：注入隐藏 user 消息（含计划全文与文件路径）", async () => {
      await planFile.writeApprovedPlan({
        workspacePath: workspaceDir,
        sessionId: "s-plan-1",
        planId: "tc-compact-1",
        plan: "# 已批准计划",
      });
      const injectUserPrompt = jest.fn().mockResolvedValue(undefined);
      const sessionContext = {
        sessionId: "s-plan-1",
        getWorkspacePath: () => workspaceDir,
        injectUserPrompt,
      } as any;

      await plugin.handleCompacted({ sessionId: "s-plan-1", sessionContext });

      expect(injectUserPrompt).toHaveBeenCalledTimes(1);
      const [text, source] = injectUserPrompt.mock.calls[0];
      expect(source).toBe("plan-mode");
      expect(text).toContain("<system_reminder>");
      expect(text).toContain("</system_reminder>");
      expect(text).toContain("A plan file exists from plan mode at:");
      expect(text).toContain("已批准计划");
    });

    it("无计划文件：不注入", async () => {
      const injectUserPrompt = jest.fn().mockResolvedValue(undefined);
      const sessionContext = {
        sessionId: "s-plan-1",
        getWorkspacePath: () => workspaceDir,
        injectUserPrompt,
      } as any;

      await plugin.handleCompacted({ sessionId: "s-plan-1", sessionContext });

      expect(injectUserPrompt).not.toHaveBeenCalled();
    });
  });
});
