import {
  AskService,
  WRITE_ALLOW_ONCE,
  WRITE_ALLOW_SESSION,
  WRITE_ALLOW_TURN,
  WRITE_DENY,
} from "../../src/common/services/ask.service";
import { InteractionWaitService } from "../../src/common/services/interaction-wait.service";
import { turnApprovalMemory } from "../../src/common/services/turn-approval-memory";
import { AskDeniedError } from "../../src/common/types/ask.types";

/**
 * 文件写入审批卡（工作区外路径）：选项文案 + 答案映射 + 自定义回复=拒绝反馈。
 * 前端按 label 原样渲染（SessionCards 的通用选项列表），所以标签是契约的一部分。
 */
describe("AskService.requestWriteApproval", () => {
  // 本轮放行是进程内单例：用例之间必须清空，否则会串
  beforeEach(() => turnApprovalMemory.clear());
  afterEach(() => turnApprovalMemory.clear());

  function makeSession() {
    const published: any[] = [];
    return {
      sessionId: "sess-write-ask",
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

  it("选项齐备：本次允许 / 本轮内自动放行 / 本会话内始终允许该路径 / 拒绝", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestWriteApproval(session, {
      resolvedPath: "D:\\data\\outside\\config.json",
      operation: "write",
      preview: '{"key": "value"}',
      toolName: "write",
      toolCallId: "call-7",
    });
    const requested = await awaitRequest(wait, session);

    const question = requested.questions[0];
    expect(requested.cardKind).toBe("write-approval");
    expect(question.options.map((o: any) => o.label)).toEqual([
      WRITE_ALLOW_ONCE,
      WRITE_ALLOW_TURN,
      WRITE_ALLOW_SESSION,
      WRITE_DENY,
    ]);
    expect(question.detail).toContain("D:\\data\\outside\\config.json");
    expect(question.detail).toContain("Operation: write");
    expect(question.detail).toContain('{"key": "value"}');
    expect(requested.toolName).toBe("write");
    expect(requested.toolCallId).toBe("call-7");

    answer(wait, session, requested, [WRITE_ALLOW_ONCE]);
    await expect(answerPromise).resolves.toBe("once");
  });

  it("「本会话内始终允许该路径」→ session", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestWriteApproval(session, {
      resolvedPath: "/data/outside/notes.md",
      operation: "edit",
      toolName: "edit",
    });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [WRITE_ALLOW_SESSION]);

    await expect(answerPromise).resolves.toBe("session");
  });

  it("拒绝 → AskDeniedError(rejected)", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestWriteApproval(session, {
      resolvedPath: "/etc/hosts",
      operation: "write",
      toolName: "write",
    });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [WRITE_DENY]);

    await expect(answerPromise).rejects.toBeInstanceOf(AskDeniedError);
  });

  it("自定义回复 = 拒绝 + 文本反馈模型", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const answerPromise = service.requestWriteApproval(session, {
      resolvedPath: "/data/outside/report.md",
      operation: "write",
      toolName: "write",
    });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [], "改成写进工作区的 docs/ 下面");

    await expect(answerPromise).rejects.toMatchObject({
      outcome: "rejected",
      feedback: "改成写进工作区的 docs/ 下面",
    });
  });

  it("「本轮内自动放行」→ once；同会话后续写入审批不再弹卡，新回合恢复", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const first = service.requestWriteApproval(session, {
      resolvedPath: "/data/outside/a.txt",
      operation: "write",
      toolName: "write",
    });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [WRITE_ALLOW_TURN]);
    await expect(first).resolves.toBe("once");
    expect(turnApprovalMemory.isAllowed(session.sessionId)).toBe(true);

    // 同一轮：直接放行，不发布新卡（即使是另一个路径）
    await expect(
      service.requestWriteApproval(session, {
        resolvedPath: "/data/outside/b.txt",
        operation: "edit",
        toolName: "edit",
      }),
    ).resolves.toBe("once");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.published.filter((c: any) => c.type === "ask_requested")).toHaveLength(1);

    // 新回合恢复询问
    turnApprovalMemory.beginTurn(session.sessionId);
    const third = service.requestWriteApproval(session, {
      resolvedPath: "/data/outside/c.txt",
      operation: "write",
      toolName: "write",
    });
    const requests = await awaitRequestCount(wait, session, 2);
    answer(wait, session, requests[1], [WRITE_ALLOW_ONCE]);
    await expect(third).resolves.toBe("once");
  });
});
