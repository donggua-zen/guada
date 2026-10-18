/**
 * InteractionWaitService：同会话**并发待答**（一个助手消息里的多个工具调用并发执行，
 * 各自都会来挂一次）。回归背景：前端曾是"单槽"，第二个 ask 覆盖第一个，
 * 被覆盖的等待者永远没人应答 → executeBatch 的 Promise.all 永久挂起。
 */
import { InteractionWaitService } from "../../src/common/services/interaction-wait.service";
import { AskService, COMMAND_ALLOW_ONCE } from "../../src/common/services/ask.service";
import type { AskQuestion } from "../../src/common/types/ask.types";

const Q: AskQuestion[] = [{ id: "q1", question: "同意？", options: [{ label: "a" }] }];

describe("InteractionWaitService：同会话并发待答", () => {
  it("两个 requestId 同时挂起，可乱序应答，各自独立返回", async () => {
    const wait = new InteractionWaitService();
    const p1 = wait.waitForAnswers("s1", "r1", Q, { kind: "approval", title: "t1", toolCallId: "c1" });
    const p2 = wait.waitForAnswers("s1", "r2", Q, { kind: "approval", title: "t2", toolCallId: "c2" });

    expect(wait.listPending("s1").map((x) => x.requestId)).toEqual(["r1", "r2"]);

    // 先答第二个
    expect(wait.resolveAnswers("s1", "r2", [{ id: "q1", selected: ["a"] }])).toBe(true);
    await expect(p2).resolves.toEqual([{ id: "q1", selected: ["a"] }]);
    expect(wait.listPending("s1").map((x) => x.requestId)).toEqual(["r1"]);

    // 再答第一个
    expect(wait.resolveAnswers("s1", "r1", [{ id: "q1", selected: ["a"] }])).toBe(true);
    await expect(p1).resolves.toHaveLength(1);
    expect(wait.listPending()).toEqual([]);
  });

  it("listPending 带恢复卡片所需元数据，并按会话过滤", () => {
    const wait = new InteractionWaitService();
    void wait.waitForAnswers("s1", "r1", Q, {
      kind: "approval",
      title: "写入文件",
      toolCallId: "c1",
      toolName: "write",
    });
    void wait.waitForAnswers("s2", "r2", Q, { kind: "ask", title: "选择" });

    const all = wait.listPending();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      sessionId: "s1",
      requestId: "r1",
      kind: "approval",
      title: "写入文件",
      toolCallId: "c1",
      toolName: "write",
    });
    expect(wait.listPending("s2").map((x) => x.requestId)).toEqual(["r2"]);
    expect(wait.listPending("nope")).toEqual([]);
  });

  it("缺省元数据也能列出来（历史调用不带 kind 时兜底为 ask）", () => {
    const wait = new InteractionWaitService();
    void wait.waitForAnswers("s1", "r1", Q);
    expect(wait.listPending("s1")[0]).toMatchObject({ kind: "ask", questions: Q });
  });

  it("cancel 只摘掉指定 requestId", async () => {
    const wait = new InteractionWaitService();
    const p1 = wait.waitForAnswers("s1", "r1", Q);
    void wait.waitForAnswers("s1", "r2", Q);
    wait.cancel("s1", "r1");
    expect(wait.listPending("s1").map((x) => x.requestId)).toEqual(["r2"]);
    // 被 cancel 的等待者不再可达（Promise 由调用方随 abort 弃置）
    expect(wait.resolveAnswers("s1", "r1", [])).toBe(false);
    void p1;
  });

  it("无等待者时 resolveAnswers 返回 false（重启丢表 / 已取消）", () => {
    const wait = new InteractionWaitService();
    expect(wait.resolveAnswers("s1", "missing", [])).toBe(false);
  });
});

describe("InteractionWaitService：本轮自动放行批量应答", () => {
  const Q1: AskQuestion[] = [
    { id: "q1", question: "同意？", options: [{ label: "本次允许" }] },
  ];

  it("只解带 autoAllowLabel 的单问题条目，其它会话/条目保持挂起", async () => {
    const wait = new InteractionWaitService();
    const p1 = wait.waitForAnswers("s1", "r1", Q1, {
      kind: "approval",
      cardKind: "command-approval",
      autoAllowLabel: "本次允许",
    });
    const p2 = wait.waitForAnswers("s1", "r2", Q1, { kind: "approval" }); // 无 cardKind / 无 label
    const p3 = wait.waitForAnswers("s1", "r3", Q1, {
      kind: "approval",
      cardKind: "sensitive-path",
      autoAllowLabel: "本轮内自动放行",
    });
    const p4 = wait.waitForAnswers("s2", "r4", Q1, {
      kind: "approval",
      cardKind: "write-approval",
      autoAllowLabel: "本次允许",
    });

    expect(wait.resolveAutoAllowable("s1")).toBe(2);
    await expect(p1).resolves.toEqual([{ id: "q1", selected: ["本次允许"] }]);
    await expect(p3).resolves.toEqual([{ id: "q1", selected: ["本轮内自动放行"] }]);
    expect(wait.listPending("s1").map((x) => x.requestId)).toEqual(["r2"]);
    // 其它会话不受影响
    expect(wait.listPending("s2").map((x) => x.requestId)).toEqual(["r4"]);

    wait.resolveAnswers("s1", "r2", [{ id: "q1", selected: ["本次允许"] }]);
    await p2;
    wait.resolveAnswers("s2", "r4", [{ id: "q1", selected: ["本次允许"] }]);
    await p4;
  });

  it("多问题条目不参与（不能用单个 label 代替逐题作答）", () => {
    const wait = new InteractionWaitService();
    const multi: AskQuestion[] = [
      { id: "a", question: "A?", options: [{ label: "yes" }] },
      { id: "b", question: "B?", options: [{ label: "yes" }] },
    ];
    void wait.waitForAnswers("s1", "r1", multi, {
      kind: "ask",
      cardKind: "question",
      autoAllowLabel: "yes",
    });

    expect(wait.resolveAutoAllowable("s1")).toBe(0);
    expect(wait.listPending("s1")).toHaveLength(1);
    wait.cancel("s1", "r1");
  });

  it("卡片类型白名单：question / plan-approval 即使带 label 也不自动放行", () => {
    const wait = new InteractionWaitService();
    void wait.waitForAnswers("s1", "r1", Q1, {
      kind: "ask",
      cardKind: "question",
      autoAllowLabel: "本次允许",
    });
    void wait.waitForAnswers("s1", "r2", Q1, {
      kind: "approval",
      cardKind: "plan-approval",
      autoAllowLabel: "本次允许",
    });

    expect(wait.resolveAutoAllowable("s1")).toBe(0);
    expect(wait.listPending("s1")).toHaveLength(2);
    wait.cancel("s1", "r1");
    wait.cancel("s1", "r2");
  });

  it("没有可放行条目时返回 0", () => {
    const wait = new InteractionWaitService();
    expect(wait.resolveAutoAllowable("s1")).toBe(0);
  });

  it("listPending 带 cardKind，但不泄露 autoAllowLabel（内部元数据不外泄）", () => {
    const wait = new InteractionWaitService();
    void wait.waitForAnswers("s1", "r1", Q1, {
      kind: "approval",
      cardKind: "command-approval",
      autoAllowLabel: "本次允许",
    });
    const view = wait.listPending("s1")[0];
    expect(view.cardKind).toBe("command-approval");
    expect(view).not.toHaveProperty("autoAllowLabel");
    wait.cancel("s1", "r1");
  });
});

describe("AskService：并发审批两路并行，互不阻塞", () => {
  function makeSession(sessionId: string) {
    const published: any[] = [];
    return {
      sessionId,
      published,
      appendAskAsked: jest.fn().mockResolvedValue(undefined),
      appendAskAnswered: jest.fn().mockResolvedValue(undefined),
      publishStream: jest.fn(async (chunk: any) => {
        published.push(chunk);
      }),
    } as any;
  }

  async function waitForRequest(session: any, index = 0) {
    for (let i = 0; i < 200; i++) {
      const requests = session.published.filter((c: any) => c.type === "ask_requested");
      if (requests.length > index) return requests[index];
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("ask_requested was not published in time");
  }

  it("同一会话两个并发审批：都登记在等待表，答完一个另一个仍在等", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession("sess-concurrent");

    const first = service.requestCommandApproval(session, { command: "cmd-a" });
    const second = service.requestCommandApproval(session, { command: "cmd-b" });

    const reqA = await waitForRequest(session, 0);
    const reqB = await waitForRequest(session, 1);
    expect(reqA.requestId).not.toBe(reqB.requestId);
    expect(wait.listPending("sess-concurrent")).toHaveLength(2);

    // 只答第二个
    wait.resolveAnswers(session.sessionId, reqB.requestId, [
      { id: reqB.questions[0].id, selected: [COMMAND_ALLOW_ONCE] },
    ]);
    await expect(second).resolves.toBe("once");
    expect(wait.listPending("sess-concurrent").map((x) => x.requestId)).toEqual([reqA.requestId]);

    // 再答第一个 → 两路都结束
    wait.resolveAnswers(session.sessionId, reqA.requestId, [
      { id: reqA.questions[0].id, selected: [COMMAND_ALLOW_ONCE] },
    ]);
    await expect(first).resolves.toBe("once");
    expect(wait.listPending("sess-concurrent")).toEqual([]);
  });
});
