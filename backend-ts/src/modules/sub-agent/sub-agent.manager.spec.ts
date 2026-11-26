import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createTestSessionStore } from '../chat/test-session-store.helper';
import type { TestSessionStore } from '../chat/test-session-store.helper';
import {
  SubAgentManager,
  SubAgentResult,
  mapFinishReason,
} from "./sub-agent.manager";

/**
 * SubAgentManager 生命周期契约测试
 *
 * 重点覆盖 workflow 路径（spawnForWorkflow）：该路径绕过 executeSubAgentStream
 * 与 settle，是唯一没有收尾调用点的分支，必须在本轮结束后自行记录运行结束时间。
 *
 * 注意语义：子代理会话没有「关闭/冻结」态。closedAt 只是「最近一次运行结束时间」，
 * 写入它不影响会话能否继续交互——sendMessage 无需解冻即可直接开新回合。
 */
describe("SubAgentManager workflow 子代理生命周期", () => {
  let tmpRoot: string;
  let store: TestSessionStore;
  let manager: SubAgentManager;
  let emitted: { event: string; evt: any }[];

  const PARENT = "sess-parent-0001";

  const parentContext = () =>
    ({
      sessionId: PARENT,
      sessionType: "web",
      workspacePath: tmpRoot,
      getSettings: () => undefined,
      getSandboxMode: () => "workspace-write",
      getModelConfig: () => ({ id: "model-x" }),
      publishStream: async () => {},
    }) as any;

  const workflowResult = (over: Partial<SubAgentResult> = {}): SubAgentResult => ({
    subSessionId: "unused",
    status: "completed",
    stopReason: "completed",
    content: "done",
    ...over,
  });

  /** 打桩内部流执行，避免铺开整条 LLM 流管线；子会话 id 由 manager 生成后回填 */
  const stubStream = (result: SubAgentResult) =>
    jest
      .spyOn(manager as any, "runSubAgentStream")
      .mockImplementation(async (...args: unknown[]) => ({
        ...result,
        subSessionId: args[0] as string,
      }));

  /** 该父会话下已记录运行结束的子会话数（替代旧 countByParentId 配额断言） */
  const endedChildCount = async (): Promise<number> => {
    const children = await store.childrenOf(PARENT);
    return children.filter((c) => !!c.closedAt).length;
  };

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sub-agent-manager-spec-"));
    fs.mkdirSync(path.join(tmpRoot, "sessions"), { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
    store = createTestSessionStore();
    await store.initialize();
    await store.create({ id: PARENT, title: "parent", sessionType: "web" });

    emitted = [];
    const eventBus = {
      emit: (event: string, evt: any) => {
        emitted.push({ event, evt });
      },
    };
    manager = new SubAgentManager(
      store as any,
      { hasActiveStream: () => false } as any, // chatRunnerService：runSubAgentStream 被打桩，不触达
      eventBus as any,
      {} as any, // agentStore：generic 子代理不查询
      {} as any, // messageStore：readSubAgentResult 不在本路径上
    );
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("本轮结束即记录运行结束、发出 subagent.run_ended", async () => {
    stubStream(workflowResult());

    const result = await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "member-a",
      task: "do a",
      workflow: { runId: "run-1", label: "member-a" },
    });

    const sub = await store.get(result.subSessionId)!;
    expect(sub.closedAt).toBeTruthy();
    expect(sub.closeReason).toBe("completed");

    const ended = emitted.find((e) => e.event === "subagent.run_ended");
    expect(ended).toBeTruthy();
    expect(ended!.evt.sessionId).toBe(PARENT);
    expect(ended!.evt.payload.subSessionId).toBe(result.subSessionId);
    expect(ended!.evt.payload.stopReason).toBe("completed");
  });

  it("不再广播已废弃的 subagent.closed 事件", async () => {
    stubStream(workflowResult());

    await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "member-legacy",
      task: "do legacy",
      workflow: { runId: "run-1" },
    });

    expect(emitted.find((e) => e.event === "subagent.closed")).toBeUndefined();
  });

  it("连续运行超过 10 个 workflow 子代理：每个都留下结束记录", async () => {
    stubStream(workflowResult());

    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const result = await manager.spawnForWorkflow({
        parentContext: parentContext(),
        name: `member-${i}`,
        task: `do ${i}`,
        workflow: { runId: "run-1", label: `member-${i}` },
      });
      ids.push(result.subSessionId);
    }

    // 没有名额限制后子会话可以无限累积，但每个都必须留下结束时间戳
    expect(await endedChildCount()).toBe(12);
    for (const id of ids) {
      expect((await store.get(id))!.closedAt).toBeTruthy();
    }
  });

  it("父会话中止时仍完成收尾（aborted 结算）", async () => {
    stubStream(
      workflowResult({
        status: "error",
        stopReason: "aborted",
        content: "",
        error: "Parent agent was aborted",
      }),
    );
    const controller = new AbortController();
    controller.abort();

    const result = await manager.spawnForWorkflow(
      {
        parentContext: parentContext(),
        name: "member-abort",
        task: "do abort",
        workflow: { runId: "run-1" },
      },
      controller.signal,
    );

    const sub = await store.get(result.subSessionId)!;
    expect(sub.closedAt).toBeTruthy();
    expect(sub.closeReason).toBe("aborted");
  });

  it("运行结束后的子会话经 sendMessage 直接继续交互（无解冻步骤）", async () => {
    stubStream(workflowResult());

    const result = await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "member-msg",
      task: "do msg",
      workflow: { runId: "run-1" },
    });

    // 第一次运行已结束（closedAt 非空），但这不阻止继续对话
    const before = await store.get(result.subSessionId)!;
    expect(before.closedAt).toBeTruthy();

    stubStream(workflowResult({ content: "follow-up reply" }));
    const second = await manager.sendMessage({
      parentSessionId: PARENT,
      sessionId: result.subSessionId,
      message: "follow up",
    });
    expect(second.content).toBe("follow-up reply");

    // 新一轮结束后时间戳刷新（fire-and-forget：轮询等待落库）
    const deadline = Date.now() + 2_000;
    let after = await store.get(result.subSessionId)!;
    while (after.closedAt === before.closedAt && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      after = await store.get(result.subSessionId)!;
    }
    expect(after.closedAt).toBeTruthy();
    expect(after.closeReason).toBe("completed");
  });

  it("spawn 前台完成时按 toolCallId 即时发 subagent_status（不等整批工具结果）", async () => {
    stubStream(workflowResult());
    const streams: any[] = [];
    const ctx = parentContext();
    ctx.publishStream = async (chunk: any) => {
      streams.push(chunk);
    };

    const result = await manager.spawn(
      {
        parentContext: ctx,
        name: "member-status",
        task: "do status",
        toolCallId: "tc-status-1",
      },
      "foreground",
    );

    expect(result.status).toBe("completed");
    expect(streams.find((s) => s.type === "subagent_link")).toMatchObject({
      toolCallId: "tc-status-1",
      subSessionId: result.subSessionId,
    });
    expect(streams.find((s) => s.type === "subagent_status")).toMatchObject({
      type: "subagent_status",
      toolCallId: "tc-status-1",
      subSessionId: result.subSessionId,
      status: "completed",
    });
  });

  it("spawn 前台失败时即时发 error 状态", async () => {
    stubStream(
      workflowResult({
        status: "error",
        stopReason: "error",
        content: "",
        error: "boom",
      }),
    );
    const streams: any[] = [];
    const ctx = parentContext();
    ctx.publishStream = async (chunk: any) => {
      streams.push(chunk);
    };

    await manager.spawn(
      {
        parentContext: ctx,
        name: "member-status-error",
        task: "do status error",
        toolCallId: "tc-status-2",
      },
      "foreground",
    );

    expect(streams.find((s) => s.type === "subagent_status")).toMatchObject({
      toolCallId: "tc-status-2",
      status: "error",
      stopReason: "error",
      error: "boom",
    });
  });
});

describe("mapFinishReason 口径", () => {
  it("handoff（工具边界交接）= 正常收尾，不是失败", () => {
    // 回归锚：漏掉 handoff 会落 default → error，让一次正常让位被记成失败
    expect(mapFinishReason("handoff")).toBe("completed");
  });

  it("正常结束原因仍为 completed", () => {
    expect(mapFinishReason(undefined)).toBe("completed");
    expect(mapFinishReason("stop")).toBe("completed");
    expect(mapFinishReason("tool-calls")).toBe("completed");
  });

  it("真正未知的原因仍保守判 error（不误报成功）", () => {
    expect(mapFinishReason("timeout")).toBe("error");
    expect(mapFinishReason("something_new")).toBe("error");
  });
});

describe("SubAgentManager 以末轮裁决成败", () => {
  let tmpRoot: string;
  let store: TestSessionStore;
  let manager: SubAgentManager;
  let streams: any[];

  const PARENT = "sess-parent-verdict";

  const parentContext = () =>
    ({
      sessionId: PARENT,
      sessionType: "web",
      workspacePath: tmpRoot,
      getSettings: () => undefined,
      getSandboxMode: () => "workspace-write",
      getModelConfig: () => ({ id: "model-x" }),
      publishStream: async (chunk: any) => {
        streams.push(chunk);
      },
    }) as any;

  const workflowResult = (over: Partial<SubAgentResult> = {}): SubAgentResult => ({
    subSessionId: "unused",
    status: "completed",
    stopReason: "completed",
    content: "done",
    ...over,
  });

  /** 打桩首轮执行结果（后续轮次由 chat.turn_finished 事件模拟） */
  const stubStream = (result: SubAgentResult) =>
    jest
      .spyOn(manager as any, "runSubAgentStream")
      .mockImplementation(async (...args: unknown[]) => ({
        ...result,
        subSessionId: args[0] as string,
      }));

  /** 模拟 chat-runner 每轮收尾发出的回合结束事件 */
  const emitTurnFinished = (subSessionId: string, reason?: string) =>
    (manager as any).handleSubAgentTurnFinished({
      sessionId: subSessionId,
      sessionType: "sub_agent",
      reason,
    });

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sub-agent-verdict-spec-"));
    fs.mkdirSync(path.join(tmpRoot, "sessions"), { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
    store = createTestSessionStore();
    await store.initialize();
    await store.create({ id: PARENT, title: "parent", sessionType: "web" });

    streams = [];
    manager = new SubAgentManager(
      store as any,
      { hasActiveStream: () => false } as any,
      { emit: () => {} } as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("末轮 stop 把首轮误判的 error 纠正为完成（handoff 场景）", async () => {
    const subSessionId = "sub-handoff-then-stop";
    emitTurnFinished(subSessionId, "stop");

    const verdict = (manager as any).resolveFinalVerdict(subSessionId, {
      subSessionId,
      status: "error",
      stopReason: "error",
      content: "done",
    });

    expect(verdict.status).toBe("completed");
    expect(verdict.stopReason).toBe("completed");
    expect(verdict.content).toBe("done");
  });

  it("镜面：首轮 completed 而末轮 error 时裁决为失败", async () => {
    const subSessionId = "sub-stop-then-error";
    emitTurnFinished(subSessionId, "error");

    const verdict = (manager as any).resolveFinalVerdict(subSessionId, {
      subSessionId,
      status: "completed",
      stopReason: "completed",
      content: "first",
    });

    expect(verdict.status).toBe("error");
    expect(verdict.stopReason).toBe("error");
  });

  it("末轮原因与快照口径一致时不替换对象（避免抹平首轮已捕获的错误）", async () => {
    const subSessionId = "sub-same-verdict";
    emitTurnFinished(subSessionId, "error");

    const snapshot: SubAgentResult = {
      subSessionId,
      status: "error",
      stopReason: "error",
      content: "",
      error: "provider 500",
    };
    const verdict = (manager as any).resolveFinalVerdict(subSessionId, snapshot);
    expect(verdict).toBe(snapshot);
    expect(verdict.error).toBe("provider 500");
  });

  it("没有末轮记录时原样返回快照", () => {
    const snapshot: SubAgentResult = {
      subSessionId: "sub-none",
      status: "completed",
      stopReason: "completed",
      content: "x",
    };
    expect((manager as any).resolveFinalVerdict("sub-none", snapshot)).toBe(snapshot);
  });

  it("结算时用末轮裁决，并把 subagent_status 发成 completed（不再整行报错）", async () => {
    const subSessionId = "sub-settle-verdict";
    const lifecycle = (manager as any).createLifecycle(subSessionId);
    (manager as any).states.set(PARENT, {
      running: new Set([subSessionId]),
      completed: [],
      completers: [],
    });
    (manager as any).toolLinks.set(subSessionId, {
      parentContext: { publishStream: async (chunk: any) => streams.push(chunk) },
      toolCallId: "tc-verdict",
    });
    // 首轮快照因 handoff 被判 error，末轮正常收尾
    emitTurnFinished(subSessionId, "stop");
    jest
      .spyOn(manager as any, "getSubAgentName")
      .mockResolvedValue("handoff-agent");
    jest
      .spyOn(manager as any, "finalizeSubAgent")
      .mockResolvedValue(undefined);
    jest.spyOn(manager as any, "markRunEnded").mockResolvedValue(undefined);

    await (manager as any).settle(
      subSessionId,
      { subSessionId, status: "error", stopReason: "error", content: "done" },
      PARENT,
      lifecycle,
    );

    const event = streams.find((s) => s.type === "subagent_status");
    expect(event).toMatchObject({
      toolCallId: "tc-verdict",
      status: "completed",
      stopReason: "completed",
    });
    // settle 收口后清理末轮表
    (manager as any).releaseLifecycle(subSessionId, lifecycle);
    expect((manager as any).lastTurnReason.has(subSessionId)).toBe(false);
  });

  it("workflow 路径同样按末轮裁决（closeReason 写修正后的值）", async () => {
    stubStream(
      workflowResult({ status: "error", stopReason: "error", content: "done" }),
    );
    // 模拟首轮 handoff 之后另起一轮正常收尾：workflow 不订阅队列，
    // 但末轮原因仍由 chat.turn_finished 记录
    const originalRun = (manager as any).runSubAgentStream;
    jest
      .spyOn(manager as any, "runSubAgentStream")
      .mockImplementation(async (...args: unknown[]) => {
        const subSessionId = args[0] as string;
        // 首轮 handoff 让位（旧逻辑会判 error），末轮正常 stop
        emitTurnFinished(subSessionId, "stop");
        return {
          ...workflowResult({ status: "error", stopReason: "error" }),
          subSessionId,
        };
      });
    void originalRun;

    const result = await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "wf-handoff",
      task: "do",
      workflow: { runId: "run-1" },
    });

    expect(result.status).toBe("completed");
    const sub = await store.get(result.subSessionId)!;
    expect(sub.closeReason).toBe("completed");
  });
});

describe("SubAgentManager getSubAgents 停止态", () => {
  let tmpRoot: string;
  let store: TestSessionStore;
  let manager: SubAgentManager;

  const PARENT = "sess-parent-status";

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sub-agent-status-spec-"));
    fs.mkdirSync(path.join(tmpRoot, "sessions"), { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
    store = createTestSessionStore();
    await store.initialize();
    await store.create({ id: PARENT, title: "parent", sessionType: "web" });

    manager = new SubAgentManager(
      store as any,
      { hasActiveStream: () => false } as any,
      { emit: () => {} } as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("closeReason=stopped 返回 stopped，不再并入 error", async () => {
    const stopped = await store.create({
      parentId: PARENT,
      title: "被停止的",
      sessionType: "sub_agent",
      closeReason: "stopped",
      closedAt: new Date().toISOString(),
    });
    const failed = await store.create({
      parentId: PARENT,
      title: "真失败的",
      sessionType: "sub_agent",
      closeReason: "error",
      closedAt: new Date().toISOString(),
    });

    const agents = await manager.getSubAgents(PARENT);
    const byId = new Map(agents.map((a) => [a.subSessionId, a.status]));
    expect(byId.get(stopped.id)).toBe("stopped");
    expect(byId.get(failed.id)).toBe("error");
  });
});
