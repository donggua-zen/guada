import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createTestSessionStore } from '../chat/test-session-store.helper';
import type { TestSessionStore } from '../chat/test-session-store.helper';
import { SubAgentManager, SubAgentResult } from "./sub-agent.manager";

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
