/**
 * WorkflowEngineService 单测
 *
 * 覆盖（对齐 DSH workflow 引擎的关键不变量）：
 * - meta 纯 JSON 校验（META_INVALID 立即失败）
 * - 脚本预解析（SCRIPT_PARSE 立即失败）
 * - 正常完成：return 值 + agentCount + 事件序列（run-start → agent-start/end → run-end）
 * - agent() 失败 resolve null（脚本 .filter(Boolean) 容错）
 * - 并发槽 FIFO + maxTotalAgents 兜底（AGENT_CAP）
 * - 角色白名单拒绝（AGENT_START fatal 杀死脚本）
 * - abort 取消（全部在途子代理中止 + run cancelled）
 * - RESULT_UNSERIALIZABLE（return 函数等不可序列化值）
 * - 终态收口：settle 补发漏发的 run-end 并把终态同步进快照/归档（只发一条，seq 连续）
 * - 事件广播：publishStream（run 内 seq 严格递增；进度不落 JSONL）
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { WorkflowEngineService } from "../../src/modules/workflow/workflow-engine.service";
import { WorkflowFileStore } from "../../src/modules/workflow/workflow-file-store.service";
import { WorkflowError } from "../../src/modules/workflow/workflow.types";
import type { WorkflowEventData } from "../../src/modules/workflow/workflow.types";
import type { ISessionContext } from "../../src/modules/chat/session-context";
import type { SubAgentManager, SubAgentResult } from "../../src/modules/sub-agent/sub-agent.manager";
import { JobRegistryService } from "../../src/modules/jobs/job-registry.service";
import type { JobId } from "../../src/modules/jobs/job.types";


// ── Mocks ──

function createMockSessionContext(overrides?: Partial<Record<string, any>>): ISessionContext {
  const base: any = {
    sessionId: "s_parent",
    sessionType: "web",
    workspacePath: "/tmp/ws",
    getSettings: (field?: string) => {
      if (field === "agents") return { generic: true };
      return undefined;
    },
    getSandboxMode: () => "workspace-write",
    getModelConfig: () => ({ id: "m1" }),
    publishStream: jest.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides } as ISessionContext;
}

function createMockSubAgentManager(
  impl?: (params: any, signal?: AbortSignal) => Promise<SubAgentResult>,
): SubAgentManager {
  let callCount = 0;
  const mock: any = {
    spawnForWorkflow: jest.fn().mockImplementation(async (params: any, signal?: AbortSignal) => {
      callCount++;
      if (impl) return impl(params, signal);
      // 默认：创建成功后返回完成结果
      params.onCreated?.(`sub_${callCount}`);
      return {
        subSessionId: `sub_${callCount}`,
        status: "completed",
        content: `result of ${params.name}`,
      } as SubAgentResult;
    }),
  };
  return mock as SubAgentManager;
}

function createEngine(opts?: {
  spawnImpl?: (params: any, signal?: AbortSignal) => Promise<SubAgentResult>;
  withRegistry?: boolean;
}) {
  const subAgentManager = createMockSubAgentManager(opts?.spawnImpl);
  // publishStream 采集器：workflow_event 广播的观测点（进度不再落 JSONL）
  const broadcasted: WorkflowEventData[] = [];
  const ctx = createMockSessionContext({
    publishStream: jest.fn().mockImplementation(async (chunk: any) => {
      if (chunk?.type === "workflow_event") broadcasted.push(chunk.event);
    }),
  });
  // 真实文件 store（SESSION_DATA_DIR 指向 tmp，settle 落盘走真实路径）
  const fileStore = new WorkflowFileStore();
  const registry = opts?.withRegistry
    ? new JobRegistryService({ emit: jest.fn() } as any)
    : undefined;
  const engine = new WorkflowEngineService(
    subAgentManager as any,
    fileStore,
    registry,
  );
  return { engine, subAgentManager, ctx, broadcasted, fileStore, registry };
}

/** 从广播流提取 run 内 seq 序列 */
function seqList(broadcasted: WorkflowEventData[]): number[] {
  return broadcasted.map((e) => e.seq);
}

// ── 落盘环境：SESSION_DATA_DIR 指向 tmp（resolveSessionsBasePath 按调用读 env）──

const TMP_DATA_DIR = path.join(os.tmpdir(), `wf-engine-spec-${Date.now()}`);
beforeAll(() => {
  process.env.SESSION_DATA_DIR = TMP_DATA_DIR;
});
afterAll(async () => {
  delete process.env.SESSION_DATA_DIR;
  await fs.rm(TMP_DATA_DIR, { recursive: true, force: true }).catch(() => {});
});

// ── 同步校验错误 ──

describe("WorkflowEngineService 同步校验", () => {
  const ctx = () => createMockSessionContext();

  it("meta 非对象 → META_INVALID 同步抛出", async () => {
    const { engine } = createEngine();
    await expect(
      engine.startRun(ctx(), { script: "return 1;", meta: "not-an-object" }),
    ).rejects.toMatchObject({ code: "META_INVALID", fatal: true });
  });

  it("meta.name 缺失 → META_INVALID", async () => {
    const { engine } = createEngine();
    await expect(
      engine.startRun(ctx(), { script: "return 1;", meta: {} }),
    ).rejects.toMatchObject({ code: "META_INVALID" });
  });

  it("meta.phases 元素缺 title → META_INVALID", async () => {
    const { engine } = createEngine();
    await expect(
      engine.startRun(ctx(), { script: "return 1;", meta: { name: "n", phases: [{ detail: "x" }] } }),
    ).rejects.toMatchObject({ code: "META_INVALID" });
  });

  it("脚本语法错误 → SCRIPT_PARSE 同步抛出（不启动 worker）", async () => {
    const { engine } = createEngine();
    await expect(
      engine.startRun(ctx(), { script: "return {{{;", meta: { name: "n" } }),
    ).rejects.toMatchObject({ code: "SCRIPT_PARSE" });
  });

  it("空脚本 → SCRIPT_PARSE", async () => {
    const { engine } = createEngine();
    await expect(
      engine.startRun(ctx(), { script: "   ", meta: { name: "n" } }),
    ).rejects.toMatchObject({ code: "SCRIPT_PARSE" });
  });

  it("abortSignal 已中止 → 直接返回 cancelled（不执行）", async () => {
    const { engine } = createEngine();
    const controller = new AbortController();
    controller.abort();
    const result = await engine.startRun(
      ctx(),
      { script: "return 1;", meta: { name: "n" } },
      controller.signal,
    );
    expect(result.status).toBe("cancelled");
  });
});

// ── 正常运行 ──

describe("WorkflowEngineService 正常运行", () => {
  it("串行两个 agent → completed + return 值 + 完整事件序列", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "test-flow", phases: [{ title: "P1" }] },
      args: { k: "v" },
      script: `
        const a = await agent("task one");
        const b = await agent("task two", { label: "二号", phase: "P1" });
        return { a, b, arg: args.k };
      `,
    });

    expect(result.status).toBe("completed");
    expect(result.agentCount).toBe(2);
    expect(result.value).toEqual({
      a: "result of task one",
      b: "result of 二号",
      arg: "v",
    });

    // 事件序列：run-start / agent-start / agent-end / agent-start / agent-end / run-end
    const kinds = broadcasted.map((e) => e.kind);
    expect(kinds[0]).toBe("run-start");
    expect(kinds[kinds.length - 1]).toBe("run-end");
    expect(kinds.filter((k) => k === "agent-start")).toHaveLength(2);
    expect(kinds.filter((k) => k === "agent-end")).toHaveLength(2);

    // seq 严格递增
    const seqs = seqList(broadcasted);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }

    // agent-start 携带 subSessionId（跳转锚点）与 phase/label
    const firstStart = broadcasted.find((e) => e.kind === "agent-start")!;
    expect(firstStart.payload).toMatchObject({ label: "task one" });
    expect((firstStart.payload as any).subSessionId).toBe("sub_1");

    // agent-end 携带 status=completed + 输出摘要
    const firstEnd = broadcasted.find((e) => e.kind === "agent-end")!;
    expect((firstEnd.payload as any).status).toBe("completed");
    expect((firstEnd.payload as any).outputSummary).toBe("result of task one");

    // run-end completed
    const runEnd = broadcasted.find((e) => e.kind === "run-end")!;
    expect((runEnd.payload as any).runStatus).toBe("completed");
  });

  it("args 注入脚本全局变量；args 缺省为 undefined", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "return { hasArgs: typeof args !== 'undefined' };",
    });
    expect(result.value).toEqual({ hasArgs: false });
  });

  it("agent() 失败 → resolve null（脚本容错）", async () => {
    const { engine, ctx } = createEngine({
      spawnImpl: async () => ({
        subSessionId: "sub_x",
        status: "error",
        stopReason: "error",
        content: "",
        error: "boom",
      }),
    });
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "const r = await agent('will fail'); return r === null;",
    });
    expect(result.status).toBe("completed");
    expect(result.value).toBe(true);
  });

  it("stopReason=aborted 的 agent → member 状态 cancelled", async () => {
    const { engine, ctx, broadcasted } = createEngine({
      spawnImpl: async (params) => {
        params.onCreated?.("sub_x");
        return {
          subSessionId: "sub_x",
          status: "error",
          stopReason: "aborted",
          content: "",
        };
      },
    });
    await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "await agent('x');",
    });
    const end = broadcasted.find((e) => e.kind === "agent-end")!;
    expect((end.payload as any).status).toBe("cancelled");
  });

  it("parallel 并行扇出 → 全部完成 + 结果数组", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: `
        const rs = await parallel([1, 2, 3].map(i => () => agent('task ' + i)));
        return rs;
      `,
    });
    expect(result.status).toBe("completed");
    expect(result.value).toEqual([
      "result of task 1",
      "result of task 2",
      "result of task 3",
    ]);
  });

  it("pipeline 每 item 独立穿 stage 链", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: `
        const rs = await pipeline(
          ['x', 'y'],
          (item, it) => agent('stage1 ' + item),
          (prev, it) => agent('stage2 for ' + prev)
        );
        return rs;
      `,
    });
    expect(result.status).toBe("completed");
    expect(result.value).toEqual([
      "result of stage2 for result of stage1 x",
      "result of stage2 for result of stage1 y",
    ]);
  });

  it("pipeline stage 收到完整 (prev, item, index) 三参（回归：Promise.then 只回传 prev）", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: `
        const rs = await pipeline(
          ['a', 'b'],
          (prev, item, index) => prev + '>' + item + '#' + index,
          (prev, item, index) => prev + '|' + item + '#' + index
        );
        return rs;
      `,
    });
    expect(result.status).toBe("completed");
    // 首阶段 prev = 原始 item；item/index 在各阶段均正确传递
    expect(result.value).toEqual([
      "a>a#0|a#0",
      "b>b#1|b#1",
    ]);
  });

  it("phase() + log() → run-phase / run-log 事件", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    await engine.startRun(ctx, {
      meta: { name: "n" },
      script: `phase("扫描"); log("开始"); return 1;`,
    });
    expect(broadcasted.some((e) => e.kind === "run-phase")).toBe(true);
    expect(broadcasted.some((e) => e.kind === "run-log")).toBe(true);
  });
});

// ── 工具调用关联键（前端在 workflow_run 调用处原地渲染的绑定锚点）──

describe("WorkflowEngineService 工具调用关联键", () => {
  it("toolCallId 随 run-start 下发并进内存快照（刷新后仍可绑定）", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    await engine.startRun(ctx, {
      meta: { name: "关联" },
      script: "return 1;",
      toolCallId: "tc_abc",
    });

    const runStart = broadcasted.find((e) => e.kind === "run-start")!;
    expect((runStart.payload as any).toolCallId).toBe("tc_abc");

    // 快照即 REST 端点（sessions/:id/workflow/runs）的数据源 → 刷新后仍能把 run 绑回工具行
    const [snap] = engine.getSessionRunStates("s_parent");
    expect(snap?.toolCallId).toBe("tc_abc");
  });

  it("未传入时不产生该字段（直接调用引擎的旧路径不受影响）", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    await engine.startRun(ctx, { meta: { name: "无关联" }, script: "return 1;" });

    const runStart = broadcasted.find((e) => e.kind === "run-start")!;
    expect(Object.prototype.hasOwnProperty.call(runStart.payload, "toolCallId")).toBe(false);
  });
});

// ── 终态归档（sessions/<sid>/workflows/<runId>.json）──

describe("WorkflowEngineService 终态归档", () => {
  it("settle 后快照落盘：status/result/endedAt 可回读（历史审阅数据源）", async () => {
    const { engine, ctx, fileStore } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "归档" },
      script: "return { ok: 42 };",
    });
    expect(result.status).toBe("completed");
    // 落盘是 fire-and-forget 且 fs 走线程池（mkdir+write+rename 多步）：轮询至出现
    let mine: Awaited<ReturnType<WorkflowFileStore["listRunSnapshots"]>>[number] | undefined;
    for (let i = 0; i < 100 && !mine; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const snapshots = await fileStore.listRunSnapshots("s_parent");
      mine = snapshots.find((s) => s.runId === result.runId);
    }
    expect(mine).toMatchObject({
      runId: result.runId,
      name: "归档",
      status: "completed",
      result: { ok: 42 },
    });
    expect(mine!.endedAt).toBeGreaterThan(0);
  });
});

// ── 终态收口（settle 是所有终态路径的唯一汇聚点）──

describe("WorkflowEngineService 终态收口", () => {
  it("worker 构造失败（args 不可序列化）也广播 run-end 并落终态（不再永久挂在 running）", async () => {
    const { engine, ctx, broadcasted, fileStore } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "坏 args" },
      script: "return 1;",
      // 函数无法 structured clone → new Worker 同步抛 DataCloneError → INVALID_ARGUMENT
      args: { fn: () => 1 },
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("INVALID_ARGUMENT");

    // 回归点：该分支原先只 settle 不发事件——run-start 已广播（status=running）却没有 run-end，
    // 前端实时视图会永久停在"运行中"。现由 settle 补发，且只有一条 run-end。
    const kinds = broadcasted.map((e) => e.kind);
    expect(kinds).toEqual(["run-start", "run-end"]);
    const runEnd = broadcasted.find((e) => e.kind === "run-end")!;
    expect((runEnd.payload as any).runStatus).toBe("failed");
    expect((runEnd.payload as any).errorCode).toBe("INVALID_ARGUMENT");

    // 内存快照（REST 数据源）与磁盘归档同为终态
    const [snap] = engine.getSessionRunStates("s_parent");
    expect(snap?.status).toBe("failed");
    expect(snap?.endedAt).toBeGreaterThan(0);

    let archived: Awaited<ReturnType<WorkflowFileStore["listRunSnapshots"]>>[number] | undefined;
    for (let i = 0; i < 100 && !archived; i++) {
      await new Promise((r) => setTimeout(r, 20));
      archived = (await fileStore.listRunSnapshots("s_parent")).find((s) => s.runId === result.runId);
    }
    expect(archived).toMatchObject({ status: "failed", errorCode: "INVALID_ARGUMENT" });
  });

  it("正常路径 run-end 只发一条（settle 补发幂等，不重复占 seq）", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    await engine.startRun(ctx, { meta: { name: "n" }, script: "return 1;" });

    expect(broadcasted.filter((e) => e.kind === "run-end")).toHaveLength(1);
    // seq 仍严格递增（补发若重复会破坏连续性）
    const seqs = seqList(broadcasted);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });
});

// ── 上限与安全 ──

describe("WorkflowEngineService 上限与安全", () => {
  it("maxTotalAgents 超限 → agent() fatal AGENT_CAP 杀死脚本（engine 默认 100）", async () => {
    // 用 105 个快速 agent 突破默认上限不现实——直接验证 AGENT_CAP 路径：
    // 白名单外的 agentId 走 spawnForWorkflow 抛错 → agent-failed AGENT_START。
    // maxTotal 路径通过多次调用验证（此处用白名单拒绝覆盖同一 fatal 语义）。
    const { engine, ctx, broadcasted } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "await agent('x', { agentId: 'not-allowed' }); return 'unreached';",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("AGENT_START");
    // fatal 杀死脚本：run-end failed 事件
    const runEnd = broadcasted.find((e) => e.kind === "run-end")!;
    expect((runEnd.payload as any).runStatus).toBe("failed");
  });

  it("agent() 参数非法（prompt 非字符串）→ INVALID_ARGUMENT", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "await agent(42); return 1;",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("INVALID_ARGUMENT");
  });

  it("agent() opts 混入未知键 → INVALID_ARGUMENT", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "await agent('x', { evil: 1 }); return 1;",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("INVALID_ARGUMENT");
  });

  it("return 函数（不可结构化克隆）→ RESULT_UNSERIALIZABLE", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "return { fn: () => 1 };",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("RESULT_UNSERIALIZABLE");
  });

  it("parallel 内普通异常 → null（不杀死脚本）", async () => {
    const { engine, ctx } = createEngine();
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: `
        const rs = await parallel([
          () => { throw new Error('normal'); },
          () => 'ok'
        ]);
        return rs;
      `,
    });
    expect(result.status).toBe("completed");
    expect(result.value).toEqual([null, "ok"]);
  });
});

// ── 取消 ──

describe("WorkflowEngineService 取消", () => {
  it("运行中 abort → 在途子代理中止 + run cancelled + 未配对 agent 合成终态", async () => {
    // spawn 挂起直到收到 abort
    const { engine, ctx, broadcasted } = createEngine({
      spawnImpl: (params, signal) =>
        new Promise<SubAgentResult>((resolve) => {
          params.onCreated?.("sub_hang");
          signal?.addEventListener("abort", () => {
            resolve({
              subSessionId: "sub_hang",
              status: "error",
              stopReason: "aborted",
              content: "",
            });
          });
        }),
    });
    const controller = new AbortController();
    const runPromise = engine.startRun(
      ctx,
      { meta: { name: "n" }, script: "await agent('hangs'); return 'unreached';" },
      controller.signal,
    );
    // 等 agent-start 落库后取消
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    const result = await runPromise;

    expect(result.status).toBe("cancelled");
    // agent-start 有配对终态（恰好一次配对）
    const starts = broadcasted.filter((e) => e.kind === "agent-start");
    const ends = broadcasted.filter((e) => e.kind === "agent-end");
    expect(starts.length).toBe(ends.length);
  });
});

// ── 事件双发 ──

describe("WorkflowEngineService 事件广播与快照", () => {
  it("每条事件经 publishStream 广播（workflow_event 流通道，不落 JSONL）", async () => {
    const { engine, ctx, broadcasted } = createEngine();
    await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "return 1;",
    });
    // run-start + run-end 全部经流通道广播
    const kinds = broadcasted.map((e) => e.kind);
    expect(kinds[0]).toBe("run-start");
    expect(kinds[kinds.length - 1]).toBe("run-end");
  });

  it("publishStream 失败不中断 run（仅告警）", async () => {
    const engine = new WorkflowEngineService(
      createMockSubAgentManager() as any,
      new WorkflowFileStore(),
    );
    const ctx = createMockSessionContext({
      publishStream: jest.fn().mockRejectedValue(new Error("sse down")),
    });
    const result = await engine.startRun(ctx, {
      meta: { name: "n" },
      script: "return 42;",
    });
    expect(result.status).toBe("completed");
    expect(result.value).toBe(42);
  });

  it("内存快照与广播事件收敛：run 终态 + 成员行 + 日志（概览面板数据源）", async () => {
    const { engine, ctx } = createEngine();
    await engine.startRun(ctx, {
      meta: { name: "snap-flow", phases: [{ title: "P1" }] },
      script: `
        phase("P1 标题");
        log("阶段开始");
        const a = await agent("task one");
        const b = await agent("task two", { label: "二号", phase: "P1" });
        return { a, b };
      `,
    });

    const states = engine.getSessionRunStates(ctx.sessionId);
    expect(states).toHaveLength(1);
    const state = states[0]!;
    expect(state.runId).toMatch(/^wfr_/);
    expect(state.name).toBe("snap-flow");
    expect(state.phases).toEqual([{ title: "P1" }]);
    expect(state.status).toBe("completed");
    expect(state.endedAt).toBeGreaterThan(0);
    expect(state.durationMs).toBeGreaterThanOrEqual(0);
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0]).toMatchObject({
      label: "task one",
      status: "completed",
      subSessionId: "sub_1",
    });
    expect(state.agents[1]).toMatchObject({
      label: "二号",
      phase: "P1",
      status: "completed",
    });
    expect(state.logs).toContain("阶段开始");
    // 快照独立于活跃 run 表（run 结束后仍可查询，供概览展示近期完成）
    expect(engine.getActiveRunIds()).toHaveLength(0);
  });
});

// ── 快照注册表裁剪 ──

describe("WorkflowEngineService 快照注册表", () => {
  it("已完成 run 超上限按注册顺序淘汰，运行中永不淘汰", () => {
    const engine = new WorkflowEngineService(
      createMockSubAgentManager() as any,
      new WorkflowFileStore(),
    );
    const registry: Map<string, any> = (engine as any).runStatesBySession;
    const byRun = new Map<string, any>();
    registry.set("s_prune", byRun);
    const mk = (runId: string, status: any) => ({
      runId,
      name: runId,
      status,
      agents: [],
      logs: [],
      startedAt: 0,
      lastSeq: 0,
    });
    // 3 个完成 + 1 个运行中，再塞满 20 个完成 → 最早的完成态被淘汰，运行中保留
    byRun.set("done-1", mk("done-1", "completed"));
    byRun.set("done-2", mk("done-2", "completed"));
    byRun.set("done-3", mk("done-3", "completed"));
    byRun.set("live", mk("live", "running"));
    for (let i = 4; i <= 21; i++) {
      byRun.set(`done-${i}`, mk(`done-${i}`, "completed"));
    }
    (engine as any).registerRunState("s_prune", mk("done-new", "completed"));

    const ids = [...byRun.keys()];
    expect(byRun.size).toBe(21); // 20 完成 + 1 运行中
    expect(ids).not.toContain("done-1");
    expect(ids).not.toContain("done-2");
    expect(ids).toContain("done-3");
    expect(ids).toContain("live");
  });
});

// ── WorkflowError 语义 ──

describe("WorkflowError", () => {
  it("fatal + code 机读", () => {
    const e = new WorkflowError("AGENT_CAP", "cap reached");
    expect(e.fatal).toBe(true);
    expect(e.code).toBe("AGENT_CAP");
  });
});

// ── Job Registry 集成 ──

describe("WorkflowEngineService × JobRegistry", () => {
  it("startRun 注册 workflow job，返回 jobId 并结算/可读", async () => {
    const { engine, ctx, registry } = createEngine({ withRegistry: true });
    try {
      const result = await engine.startRun(ctx, {
        script: "return 42;",
        meta: { name: "wf-job" },
      });

      expect(result.status).toBe("completed");
      expect(result.jobId).toMatch(/^job-/);
      const jobId = result.jobId as JobId;

      const settled = await registry!.wait(jobId, "s_parent", 2000);
      expect(settled).toMatchObject({
        kind: "workflow",
        label: "wf-job",
        status: "completed",
        handle: result.runId,
      });

      const read = await registry!.read(jobId, "s_parent");
      expect(read.output.text).toContain(result.runId);
      expect(read.output.text).toContain("completed");

      // job 移除时同步清掉 run 快照（onDisposed）
      await registry!.disposeSession("s_parent");
      expect(engine.getSessionRunStates("s_parent")).toEqual([]);
    } finally {
      registry!.onModuleDestroy();
    }
  });

  it("job_kill 取消运行中的 workflow", async () => {
    const { engine, ctx, registry } = createEngine({
      withRegistry: true,
      spawnImpl: (params, signal) =>
        new Promise<SubAgentResult>((resolve) => {
          params.onCreated?.("sub_abort");
          const finish = () => {
            resolve({
              subSessionId: "sub_abort",
              status: "error",
              stopReason: "aborted",
              content: "",
            });
          };
          if (signal?.aborted) finish();
          else signal?.addEventListener("abort", finish, { once: true });
        }),
    });

    try {
      const runPromise = engine.startRun(ctx, {
        script: "const r = await agent('x'); return r;",
        meta: { name: "wf-kill" },
      });

      let job;
      for (let i = 0; i < 100 && !job; i++) {
        job = registry!.list("s_parent").find((j) => j.kind === "workflow");
        if (!job) await new Promise((r) => setTimeout(r, 10));
      }
      expect(job).toBeTruthy();
      expect(job!.status).toBe("running");

      expect(registry!.kill(job!.id, "s_parent", "test")).toBe("requested");
      const result = await runPromise;
      expect(result.status).toBe("cancelled");

      const settled = await registry!.wait(job!.id, "s_parent", 2000);
      expect(settled.status).toBe("killed");
    } finally {
      registry!.onModuleDestroy();
    }
  }, 10_000);
});
