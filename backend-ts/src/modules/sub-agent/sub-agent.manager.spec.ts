import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { SessionMetaStore } from "../chat/session-meta.store";
import { SubAgentManager, SubAgentResult } from "./sub-agent.manager";

/**
 * SubAgentManager 生命周期契约测试
 *
 * 重点覆盖 workflow 路径（spawnForWorkflow）：该路径绕过 executeSubAgentStream
 * 与 settle，是唯一没有自动清理调用点的分支，必须在本轮结束后自行冻结子会话。
 * 否则子会话永不写 closedAt，被 countByParentId 持续计入 spawn() 的每父会话
 * 10 个子代理名额，最终让普通 subagent_spawn 报错。
 */
describe("SubAgentManager workflow 子代理生命周期", () => {
  let tmpRoot: string;
  let gate: MetadataBootstrapGate;
  let store: SessionMetaStore;
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

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sub-agent-manager-spec-"));
    fs.mkdirSync(path.join(tmpRoot, "sessions"), { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
    gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = new SessionMetaStore(gate);
    await store.initialize();
    await store.create({ id: PARENT, title: "parent", sessionType: "web" });

    emitted = [];
    const eventBus = {
      emit: (event: string, evt: any) => {
        emitted.push({ event, evt });
      },
    };
    manager = new SubAgentManager(
      store,
      {} as any, // chatRunnerService：runSubAgentStream 被打桩，不触达
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

  it("本轮结束即冻结子会话、发出 subagent.closed 并释放配额", async () => {
    stubStream(workflowResult());

    const result = await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "member-a",
      task: "do a",
      workflow: { runId: "run-1", label: "member-a" },
    });

    const sub = store.get(result.subSessionId)!;
    expect(sub.closedAt).toBeTruthy();
    expect(sub.closeReason).toBe("completed");
    // 生命周期标记与冻结行为一致（此前写死 persist，导致永不冻结）
    expect((sub.settings as any).lifecycle).toBe("one_shot");

    const closed = emitted.find((e) => e.event === "subagent.closed");
    expect(closed).toBeTruthy();
    expect(closed!.evt.sessionId).toBe(PARENT);
    expect(closed!.evt.payload.subSessionId).toBe(result.subSessionId);

    // 配额已释放：冻结会话被 countByParentId 排除
    expect(store.countByParentId(PARENT)).toBe(0);
  });

  it("连续运行超过 10 个 workflow 子代理也不泄漏名额", async () => {
    stubStream(workflowResult());

    for (let i = 0; i < 12; i++) {
      await manager.spawnForWorkflow({
        parentContext: parentContext(),
        name: `member-${i}`,
        task: `do ${i}`,
        workflow: { runId: "run-1", label: `member-${i}` },
      });
    }

    expect(store.countByParentId(PARENT)).toBe(0);
  });

  it("父会话中止时仍完成冻结（aborted 结算）", async () => {
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

    const sub = store.get(result.subSessionId)!;
    expect(sub.closedAt).toBeTruthy();
    expect(sub.closeReason).toBe("aborted");
    expect(store.countByParentId(PARENT)).toBe(0);
  });

  it("冻结后的子会话拒绝继续发送消息", async () => {
    stubStream(workflowResult());

    const result = await manager.spawnForWorkflow({
      parentContext: parentContext(),
      name: "member-msg",
      task: "do msg",
      workflow: { runId: "run-1" },
    });

    await expect(
      manager.sendMessage({
        parentSessionId: PARENT,
        sessionId: result.subSessionId,
        message: "follow up",
      }),
    ).rejects.toThrow(/closed \(frozen for replay only\)/);
  });
});
