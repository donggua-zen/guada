import {
  AskService,
  COMMAND_ALLOW_GLOBAL,
  COMMAND_ALLOW_ONCE,
  COMMAND_ALLOW_PROJECT,
  COMMAND_DENY,
} from "../../src/common/services/ask.service";
import { InteractionWaitService } from "../../src/common/services/interaction-wait.service";
import { AskDeniedError } from "../../src/common/types/ask.types";

/**
 * 命令审批卡（Windows 命令策略层）：选项文案 + 答案映射 + 自定义回复=拒绝反馈 + 规则推导。
 * 前端按 label 原样渲染（SessionCards 的通用选项列表），所以标签是契约的一部分。
 */
describe("AskService.requestCommandApproval", () => {
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

  it("三选项齐备：本次允许 / 本会话内始终允许 / 拒绝，detail 带命令原文", async () => {
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
    expect(question.options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
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

  it("灾难级命令不提供放通选项（只有本次允许 / 拒绝）", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestCommandApproval(session, {
      command: "mkfs.ext4 /dev/sdb1",
    });
    const requested = await awaitRequest(wait, session);
    expect(requested.questions[0].options.map((o: any) => o.label)).toEqual([
      COMMAND_ALLOW_ONCE,
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
});
