import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PlanModePlugin } from "../../src/modules/plugins/builtins/plan-mode.plugin";
import { PlanFileService } from "../../src/common/services/plan-file.service";
import { AskService } from "../../src/common/services/ask.service";
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

  function createSession(overrides: Record<string, any> = {}) {
    let planEnabled = overrides.planEnabled !== false;
    return {
      sessionId: "s-plan-1",
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

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-mode-spec-"));
    planFile = new PlanFileService();

    registered = [];
    kitDef = undefined;
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
    } as unknown as PluginApi;

    const askService = {
      ask: jest.fn(async () => askResult),
    } as unknown as AskService;

    plugin = new PlanModePlugin(askService, planFile);
    await plugin.onLoad(api);
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

  describe("工具包可见性：计划模式对子代理不可见", () => {
    // 整个工具包（连同 ExitPlanMode）都不该进子代理的 enabledTools。与 subagent / workflow
    // 工具包同一手法（handler 返回 loadMode:none）。提示词面由 buildPlanModeTurnEntries 的
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
