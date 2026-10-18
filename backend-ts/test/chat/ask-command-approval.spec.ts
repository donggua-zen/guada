import {
  AskService,
  COMMAND_ALLOW_GLOBAL,
  COMMAND_ALLOW_ONCE,
  COMMAND_ALLOW_PROJECT,
  COMMAND_ALLOW_TURN,
  COMMAND_DENY,
} from "../../src/common/services/ask.service";
import { InteractionWaitService } from "../../src/common/services/interaction-wait.service";
import { turnApprovalMemory } from "../../src/common/services/turn-approval-memory";
import { AskDeniedError } from "../../src/common/types/ask.types";

/**
 * 命令审批卡（Windows 命令策略层）：选项文案 + 答案映射 + 自定义回复=拒绝反馈 + 规则推导。
 * 前端按 label 原样渲染（SessionCards 的通用选项列表），所以标签是契约的一部分。
 */
describe("AskService.requestCommandApproval", () => {
  // 本轮放行是进程内单例：用例之间必须清空，否则会串
  beforeEach(() => turnApprovalMemory.clear());
  afterEach(() => turnApprovalMemory.clear());

  function makeSession() {
    const published: any[] = [];
    return {
      sessionId: "sess-ask",
      published,
      appendAskAsked: jest.fn().mockResolvedValue(undefined),
      publishStream: jest.fn(async (chunk: any) => {
        published.push(chunk);
      }),
      appendAskAnswered: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  /** 等到"请求已发出且等待表已登记"再投答案（ask() 是异步链：审计 → 发布 → 登记） */
  async function awaitRequest(wait: InteractionWaitService, session: any) {
    for (let i = 0; i < 200; i++) {
      const requested = session.published.find((c: any) => c.type === "ask_requested");
      if (requested && wait.getPendingQuestions(session.sessionId, requested.requestId)) {
        return requested;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("ask_requested was not registered in time");
  }

  /** 等到第 n 个请求已发出且登记到等待表（前面的可能已被应答） */
  async function awaitRequestCount(
    wait: InteractionWaitService,
    session: any,
    n: number,
  ) {
    for (let i = 0; i < 200; i++) {
      const requests = session.published.filter((c: any) => c.type === "ask_requested");
      if (
        requests.length >= n &&
        wait.getPendingQuestions(session.sessionId, requests[n - 1].requestId)
      ) {
        return requests;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`${n} ask_requested were not registered in time`);
  }

  function answer(
    wait: InteractionWaitService,
    session: any,
    requested: any,
    selected: string[],
    custom?: string,
  ) {
    wait.resolveAnswers(session.sessionId, requested.requestId, [
      { id: requested.questions[0].id, selected, custom },
    ]);
  }

  it("选项齐备：本次允许 / 本轮内自动放行 / 放通此类 / 拒绝，detail 带命令原文", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, {
      command: "npm run build",
      reason: "命令不在只读白名单内（[unknown-command] …）",
      toolCallId: "call-9",
    });
    const requested = await awaitRequest(wait, session);

    const question = requested.questions[0];
    expect(requested.cardKind).toBe("command-approval");
    expect(question.options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
      COMMAND_ALLOW_TURN,
      COMMAND_ALLOW_PROJECT,
      COMMAND_ALLOW_GLOBAL,
      COMMAND_DENY,
    ]);
    // 卡片上直接显示推导出的前缀规则，用户知道"放通"的到底是什么
    const projectOption = question.options.find((o: any) => o.label === COMMAND_ALLOW_PROJECT);
    expect(projectOption.description).toContain("npm run *");
    expect(question.detail).toContain("npm run build");
    expect(question.detail).toContain("不在只读白名单内");
    expect(requested.toolName).toBe("run_command");
    expect(requested.toolCallId).toBe("call-9");

    answer(wait, session, requested, [COMMAND_ALLOW_ONCE]);
    await expect(answerPromise).resolves.toBe("once");
  });

  it("敏感路径卡：cardKind = sensitive-path，detail 带目标与操作", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, {
      command: "read ~/.ssh/id_rsa",
      reason: "命中敏感路径规则（**/.ssh/**）",
      allowRule: "**/.ssh/**",
      allowRuleKind: "path",
      pathDetail: { target: "~/.ssh/id_rsa", op: "read" },
    });
    const requested = await awaitRequest(wait, session);

    expect(requested.cardKind).toBe("sensitive-path");
    expect(requested.title).toBe("敏感文件访问");
    expect(requested.questions[0].detail).toContain("目标：~/.ssh/id_rsa（读取）");
    expect(requested.questions[0].options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
      COMMAND_ALLOW_TURN,
      COMMAND_ALLOW_PROJECT,
      COMMAND_ALLOW_GLOBAL,
      COMMAND_DENY,
    ]);

    answer(wait, session, requested, [COMMAND_ALLOW_ONCE]);
    await expect(answerPromise).resolves.toBe("once");
  });

  it("「放通此类（本项目）」→ { scope: 'project' }", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, { command: "npm run test" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_ALLOW_PROJECT]);

    await expect(answerPromise).resolves.toEqual({ scope: "project" });
  });

  it("「放通此类（全局）」→ { scope: 'global' }", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, { command: "ffmpeg -i a b" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_ALLOW_GLOBAL]);

    await expect(answerPromise).resolves.toEqual({ scope: "global" });
  });

  it("灾难级命令不提供放通选项（本次允许 / 本轮内自动放行 / 拒绝）", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, {
      command: "mkfs.ext4 /dev/sdb1",
    });
    const requested = await awaitRequest(wait, session);
    expect(requested.questions[0].options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
      COMMAND_ALLOW_TURN,
      COMMAND_DENY,
    ]);

    answer(wait, session, requested, [COMMAND_ALLOW_ONCE]);
    await expect(answerPromise).resolves.toBe("once");
  });

  it("多段命令不提供放通选项（前缀放通会顺带放行后续段落）", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, {
      command: "cd /d/AI/x && rm -rf build",
    });
    const requested = await awaitRequest(wait, session);
    expect(requested.questions[0].options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
      COMMAND_ALLOW_TURN,
      COMMAND_DENY,
    ]);

    answer(wait, session, requested, [COMMAND_ALLOW_ONCE]);
    await expect(answerPromise).resolves.toBe("once");
  });

  it("拒绝 → AskDeniedError(rejected)", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, { command: "rm -rf build" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_DENY]);

    await expect(answerPromise).rejects.toBeInstanceOf(AskDeniedError);
  });

  it("自定义回复 = 拒绝 + 文本反馈模型", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, { command: "npm install" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [], "先别装，改用 pnpm");

    await expect(answerPromise).rejects.toMatchObject({
      outcome: "rejected",
      feedback: "先别装，改用 pnpm",
    });
  });

  it("「本轮内自动放行」→ once；同会话后续审批不再弹卡，新回合恢复询问", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const first = service.requestCommandApproval(session, { command: "npm run build" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_ALLOW_TURN]);
    await expect(first).resolves.toBe("once");
    expect(turnApprovalMemory.isAllowed(session.sessionId)).toBe(true);

    // 同一轮：直接放行，不发布新卡
    await expect(
      service.requestCommandApproval(session, { command: "rm -rf build" }),
    ).resolves.toBe("once");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.published.filter((c: any) => c.type === "ask_requested")).toHaveLength(1);

    // 新回合（beginTurn）恢复逐次询问
    turnApprovalMemory.beginTurn(session.sessionId);
    const third = service.requestCommandApproval(session, { command: "rm -rf build" });
    const requests = await awaitRequestCount(wait, session, 2);
    answer(wait, session, requests[1], [COMMAND_ALLOW_ONCE]);
    await expect(third).resolves.toBe("once");
  });

  it("并发排队卡：选择本轮放行后，其余挂起审批一并放行", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const first = service.requestCommandApproval(session, { command: "npm run a" });
    const second = service.requestCommandApproval(session, { command: "npm run b" });
    const requests = await awaitRequestCount(wait, session, 2);

    answer(wait, session, requests[0], [COMMAND_ALLOW_TURN]);

    await expect(first).resolves.toBe("once");
    await expect(second).resolves.toBe("once");
    // 两张卡都收到了终结帧（第二张是自动放行收掉的）
    expect(session.published.filter((c: any) => c.type === "ask_resolved")).toHaveLength(2);
  });

  it("竞态兜底：等待登记之后才置位本轮放行，也会立即返回", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    // 模拟"预检通过 → 登记 → 另一张卡刚被用户选择本轮放行"的时序
    const original = wait.waitForAnswers.bind(wait);
    const spy = jest.spyOn(wait, "waitForAnswers").mockImplementation(((
      ...args: any[]
    ) => {
      const promise = (original as any)(...args);
      turnApprovalMemory.allowForTurn(session.sessionId);
      return promise;
    }) as any);

    await expect(
      service.requestCommandApproval(session, { command: "npm run x" }),
    ).resolves.toBe("once");
    expect(spy).toHaveBeenCalled();
    // 卡片发出过（竞态窗口），但已自动收卡
    expect(session.published.some((c: any) => c.type === "ask_resolved")).toBe(true);
  });

  it("本轮放行不影响 ask_user 提问（question 类型不在自动放行白名单）", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();
    turnApprovalMemory.allowForTurn(session.sessionId);

    const answerPromise = service.ask(session, {
      kind: "ask",
      title: "选择",
      questions: [{ id: "q1", question: "选哪个？", options: [{ label: "A" }] }],
    });
    const requested = await awaitRequest(wait, session);
    expect(requested.kind).toBe("ask");

    answer(wait, session, requested, ["A"]);
    await expect(answerPromise).resolves.toEqual([{ id: "q1", selected: ["A"] }]);
  });
});
