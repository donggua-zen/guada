/**
 * SubAgentManager —— 此前零测试（1180 行的最大覆盖缺口）。
 *
 * 它此前只在 test/workflow/workflow-engine.spec.ts 里被 mock 掉，本体从未被验证。
 * 这里从公开入口（spawn / spawnForWorkflow / sendMessage / waitForComplete /
 * closeSubAgent / getSubAgents）驱动，依赖全部用 fakes.ts 的替身，
 * 不钻私有成员 —— 避免测试随实现细节脆化。
 */
import { Logger } from "@nestjs/common";
import { SubAgentManager } from "../../src/modules/sub-agent/sub-agent.manager";
import { JobRegistryService } from "../../src/modules/jobs/job-registry.service";
import type { JobOutcome } from "../../src/modules/jobs/job.types";
import {
  FakeAgentFileStore,
  FakeChatRunner,
  FakeEventBus,
  FakeMessageStore,
  FakeSessionMetaStore,
  assistantMessage,
  createFakeParentContext,
} from "./helpers/fakes";

let activeRegistry: JobRegistryService | undefined;

function setup(options: { withRegistry?: boolean } = {}) {
  const sessionStore = new FakeSessionMetaStore();
  const chatRunner = new FakeChatRunner();
  const eventBus = new FakeEventBus();
  const agentStore = new FakeAgentFileStore();
  const messageStore = new FakeMessageStore();
  const registry = options.withRegistry
    ? new JobRegistryService(eventBus as any)
    : undefined;
  activeRegistry = registry;
  const manager = new SubAgentManager(
    sessionStore as any,
    chatRunner as any,
    eventBus as any,
    agentStore as any,
    messageStore as any,
    registry,
  );
  return { manager, sessionStore, chatRunner, eventBus, agentStore, messageStore, registry };
}

/** 让流立即正常结束（finishReason 可指定） */
function completesImmediately(chatRunner: FakeChatRunner, finishReason = "stop"): void {
  chatRunner.startStreamImpl = (params, cb) => {
    cb.onEvent?.({ type: "turn_end", finishReason });
    cb.onComplete?.("completed");
    // 真实 ChatRunner 流结束后 hasActiveStream=false；fake 也保持同一语义。
    chatRunner.finishStream(params.sessionId);
  };
}

/** 让流永不结束（模拟长跑子代理） */
function neverCompletes(chatRunner: FakeChatRunner): void {
  chatRunner.startStreamImpl = () => new Promise<void>(() => undefined);
}

/** 可被 cancelStream 结束的长跑流：模拟 ChatRunner 取消时触发 onComplete */
function cancellableStream(chatRunner: FakeChatRunner): void {
  let callbacks: any;
  let resolveStart!: () => void;
  chatRunner.startStreamImpl = (_params, cb) => {
    callbacks = cb;
    return new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
  };
  (chatRunner as any).cancelStream = (sessionId: string) => {
    chatRunner.cancelCalls.push(sessionId);
    chatRunner.activeStreams.delete(sessionId);
    callbacks?.onComplete?.("user_cancel");
    resolveStart?.();
  };
}

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until 超时");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 临时切换 process.platform：spawn 在首个 await 之前就读取了档位 */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", {
      value: original,
      configurable: true,
    });
  }
}

describe("SubAgentManager", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    activeRegistry?.onModuleDestroy();
    activeRegistry = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("spawn：准入与配置继承", () => {
    it("spawn 不再做独立子代理数预检（配额统一由 Registry 在后台注册时执行）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);
      sessionStore.setParentCount("parent-1", 10);

      // 前台 spawn 是阻塞调用，模型自然串行，不占 job 配额；预检已删除
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });
      expect(sessionStore.createCalls).toHaveLength(1);
    });

    it("恰好 9 个时仍可创建", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      sessionStore.setParentCount("parent-1", 9);
      completesImmediately(chatRunner);

      await expect(
        manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }),
      ).resolves.toBeTruthy();
    });

    it("创建子会话时带上 parentId / sessionType=sub_agent / workspacePath", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "调研任务", task: "t" });

      expect(sessionStore.createCalls[0]).toMatchObject({
        parentId: "parent-1",
        title: "调研任务",
        sessionType: "sub_agent",
        workspacePath: "D:/ws",
      });
    });

    it("继承父会话的 sandboxMode / thinkingEffort / 插件与技能（防权限逃逸）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);
      const parentContext = createFakeParentContext({
        getSettings: (k: string) =>
          ({ thinkingEffort: "high", plugins: ["p1"], skills: { s: 1 } } as any)[k],
        getSandboxMode: () => "read-only",
      });

      await withPlatform("linux", () =>
        manager.spawn({ parentContext, name: "x", task: "t" }),
      );

      expect(sessionStore.createCalls[0].settings).toMatchObject({
        thinkingEffort: "high",
        sandboxMode: "read-only",
        plugins: ["p1"],
        skills: { s: 1 },
      });
    });

    it("Windows 上继承的 read-only 归一化为 workspace-write（旧会话迁移）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);
      const parentContext = createFakeParentContext({
        getSandboxMode: () => "read-only",
      });

      await withPlatform("win32", () =>
        manager.spawn({ parentContext, name: "x", task: "t" }),
      );

      expect(sessionStore.createCalls[0].settings.sandboxMode).toBe(
        "workspace-write",
      );
    });

    it("通用子代理使用默认系统提示词", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      const settings = sessionStore.createCalls[0].settings;
      expect(typeof settings.systemPrompt).toBe("string");
      expect(settings.systemPrompt).toContain("Sub Agent");
    });

    it("指定不存在的 agentId 时抛错且不创建会话", async () => {
      const { manager, sessionStore } = setup();

      await expect(
        manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t", agentId: "ghost" }),
      ).rejects.toThrow(/Agent "ghost" does not exist/);
      expect(sessionStore.createCalls).toHaveLength(0);
    });

    it("指定存在的 agentId 时采用该智能体的 modelId，且不再注入默认系统提示词", async () => {
      const { manager, sessionStore, chatRunner, agentStore } = setup();
      completesImmediately(chatRunner);
      agentStore.agents.set("coder", { id: "coder", name: "Coder", modelId: "m-coder", avatarUrl: "a.png" });

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t", agentId: "coder" });

      const input = sessionStore.createCalls[0];
      expect(input).toMatchObject({ agentId: "coder", modelId: "m-coder", avatarUrl: "a.png" });
      expect(input.settings.systemPrompt).toBeUndefined();
    });

    it("agentId 为 generic 时走通用分支（agentId 落库为 null）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t", agentId: "generic" });

      expect(sessionStore.createCalls[0].agentId).toBeNull();
      expect(sessionStore.createCalls[0].settings.systemPrompt).toBeTruthy();
    });

    it("spawn 不再接受 lifecycle 参数（生命周期唯一，模型面无此概念）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(sessionStore.createCalls[0].settings.lifecycle).toBeUndefined();
    });

    it("创建成功后广播 subagent.created", async () => {
      const { manager, chatRunner, eventBus } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "分析", task: "t" });

      expect(eventBus.of("subagent.created")[0]).toMatchObject({
        sessionId: "parent-1",
        payload: { subSessionId: "sub-1", name: "分析", mode: "foreground" },
      });
    });

    it("传 toolCallId 时立刻发布 subagent_link 流事件（供刷新后重建关联）", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);
      const published: any[] = [];
      const parentContext = createFakeParentContext({
        publishStream: async (e: any) => {
          published.push(e);
        },
      });

      await manager.spawn({ parentContext, name: "分析", task: "t", toolCallId: "tc-1" });

      expect(published[0]).toMatchObject({
        type: "subagent_link",
        toolCallId: "tc-1",
        subSessionId: "sub-1",
        name: "分析",
      });
    });

    it("未传 toolCallId 时不发布 subagent_link", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);
      const published: any[] = [];
      const parentContext = createFakeParentContext({
        publishStream: async (e: any) => {
          published.push(e);
        },
      });

      await manager.spawn({ parentContext, name: "x", task: "t" });

      expect(published).toHaveLength(0);
    });
  });

  describe("spawn：结果结算与内容来源", () => {
    it("前台正常完成 → status=completed / stopReason=completed", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result).toMatchObject({ subSessionId: "sub-1", status: "completed", stopReason: "completed" });
    });

    it("内容以子会话日志重放为准（而非流累积文本）", async () => {
      const { manager, chatRunner, messageStore } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onEvent?.({ type: "text_delta", text: "流里的草稿" });
        cb.onEvent?.({ type: "turn_end", finishReason: "stop" });
        cb.onComplete?.("completed");
      };
      messageStore.messages.set("sub-1", [assistantMessage("日志里的最终答案", "推理摘要")]);

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result.content).toBe("日志里的最终答案");
      expect(result.reasoningContent).toBe("推理摘要");
    });

    it("日志重放失败时降级到流累积文本", async () => {
      const { manager, chatRunner, messageStore } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onEvent?.({ type: "text_delta", text: "流里的草稿" });
        cb.onEvent?.({ type: "turn_end", finishReason: "stop" });
        cb.onComplete?.("completed");
      };
      messageStore.loadShouldThrow = true;

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result.content).toBe("流里的草稿");
    });

    it("只看最后一条非空 assistant 消息（跳过空转的中间消息）", async () => {
      const { manager, chatRunner, messageStore } = setup();
      completesImmediately(chatRunner);
      messageStore.messages.set("sub-1", [
        assistantMessage("旧结论"),
        assistantMessage(""), // 末条为空 → 应回退到上一条非空
      ]);

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result.content).toBe("旧结论");
    });

    it("turn_end 带 error → status=error 且透传错误信息", async () => {
      const { manager, chatRunner } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onEvent?.({ type: "turn_end", finishReason: "stop", error: "模型炸了" });
        cb.onComplete?.("completed");
      };

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result).toMatchObject({ status: "error", stopReason: "error", error: "模型炸了" });
    });

    it("turn_end finishReason=length → stopReason=max_tokens（经 mapFinishReason）", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner, "length");

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result.stopReason).toBe("max_tokens");
      expect(result.finishReason).toBe("length");
    });

    it("onComplete(user_cancel) → status=error / stopReason=aborted", async () => {
      const { manager, chatRunner } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onComplete?.("user_cancel");
      };

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result).toMatchObject({ status: "error", stopReason: "aborted", error: "User cancelled" });
    });

    it("onError → status=error 且带上异常消息", async () => {
      const { manager, chatRunner } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onError?.(new Error("连接断开"));
      };

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result).toMatchObject({ status: "error", stopReason: "error", error: "连接断开" });
    });

    it("startStream 本体失败 → 编码为 error 结果而非抛出", async () => {
      const { manager, chatRunner } = setup();
      chatRunner.startStreamImpl = () => Promise.reject(new Error("会话不存在"));

      const result = await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });

      expect(result).toMatchObject({ status: "error", stopReason: "error" });
      expect(result.error).toMatch(/Failed to start sub-agent stream: 会话不存在/);
    });

    it("abortSignal 已中止 → 直接返回 aborted，且根本不启动流", async () => {
      const { manager, chatRunner } = setup();
      const controller = new AbortController();
      controller.abort();

      const result = await manager.spawn(
        { parentContext: createFakeParentContext(), name: "x", task: "t" },
        "foreground",
        controller.signal,
      );

      expect(result).toMatchObject({ status: "error", stopReason: "aborted", content: "" });
      expect(chatRunner.startStreamCalls).toHaveLength(0);
    });

    it("后台模式立即返回 status=running，不阻塞", async () => {
      const { manager, chatRunner } = setup();
      neverCompletes(chatRunner);

      const result = await manager.spawn(
        { parentContext: createFakeParentContext(), name: "x", task: "t" },
        "background",
      );

      expect(result).toMatchObject({ subSessionId: "sub-1", status: "running", content: "" });
    });

    it("前台超时 20 分钟 → 转后台并返回 running + 说明文案", async () => {
      const { manager, chatRunner } = setup();
      neverCompletes(chatRunner);
      jest.useFakeTimers();

      const pending = manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });
      await jest.advanceTimersByTimeAsync(20 * 60 * 1000 + 100);
      const result = await pending;

      expect(result).toMatchObject({ subSessionId: "sub-1", status: "running" });
      expect(result.error).toMatch(/20-minute foreground timeout/);
    });
  });

  describe("生命周期清理", () => {
    it("one_shot：前台结果交付后自动冻结子会话并广播 subagent.closed", async () => {
      const { manager, sessionStore, chatRunner, eventBus } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });
      await until(() => sessionStore.updateCalls.length > 0);

      expect(sessionStore.updateCalls[0]).toMatchObject({ id: "sub-1" });
      expect(sessionStore.updateCalls[0].patch.closedAt).toBeInstanceOf(Date);
      expect(eventBus.of("subagent.closed")[0]).toMatchObject({
        sessionId: "parent-1",
        payload: { subSessionId: "sub-1", stopReason: "completed" },
      });
    });

    it("前台结果交付后一律自动冻结（生命周期唯一）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });
      await until(() => sessionStore.updateCalls.length > 0);

      expect(sessionStore.updateCalls[0]).toMatchObject({ id: "sub-1" });
    });

    it("冻结携带失败原因：error 结果 → stopReason=error", async () => {
      const { manager, sessionStore, chatRunner, eventBus } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onError?.(new Error("boom"));
      };

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" });
      await until(() => sessionStore.updateCalls.length > 0);

      expect(eventBus.of("subagent.closed")[0].payload.stopReason).toBe("error");
    });
  });

  describe("sendMessage 校验", () => {
    function seedSub(sessionStore: FakeSessionMetaStore, overrides: Record<string, any> = {}) {
      return sessionStore.seed({
        id: "sub-9",
        parentId: "parent-1",
        title: "既有子代理",
        closedAt: null,
        ...overrides,
      });
    }

    it("子会话不存在 → 抛错", async () => {
      const { manager } = setup();

      await expect(
        manager.sendMessage({ parentSessionId: "parent-1", sessionId: "ghost", message: "hi" }),
      ).rejects.toThrow(/Sub-agent session does not exist/);
    });

    it("子会话不属于该父会话 → 抛错", async () => {
      const { manager, sessionStore } = setup();
      seedSub(sessionStore, { parentId: "other-parent" });

      await expect(
        manager.sendMessage({ parentSessionId: "parent-1", sessionId: "sub-9", message: "hi" }),
      ).rejects.toThrow(/does not belong to this parent session/);
    });

    it("子会话已冻结 → 自动解冻后继续执行", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      seedSub(sessionStore, { closedAt: new Date() });
      completesImmediately(chatRunner);

      const result = await manager.sendMessage({
        parentSessionId: "parent-1",
        sessionId: "sub-9",
        message: "继续",
      });

      expect(result).toMatchObject({ subSessionId: "sub-9", status: "completed" });
      // 解冻已发生（closedAt 被清空）
      const unfreeze = sessionStore.updateCalls.find(
        (u) => u.id === "sub-9" && u.patch.closedAt === null,
      );
      expect(unfreeze).toBeTruthy();
    });

    it("子代理正在运行 → 抛错", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      seedSub(sessionStore);
      chatRunner.activeStreams.add("sub-9");

      await expect(
        manager.sendMessage({ parentSessionId: "parent-1", sessionId: "sub-9", message: "hi" }),
      ).rejects.toThrow(/currently running/);
    });

    it("校验通过 → 复用执行流程并返回结果", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      seedSub(sessionStore);
      completesImmediately(chatRunner);

      const result = await manager.sendMessage({
        parentSessionId: "parent-1",
        sessionId: "sub-9",
        message: "继续",
      });

      expect(result).toMatchObject({ subSessionId: "sub-9", status: "completed" });
      expect(chatRunner.startStreamCalls[0].params).toMatchObject({ sessionId: "sub-9" });
    });

    it("sendMessage 交互结果交付后也自动冻结（生命周期唯一）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      seedSub(sessionStore);
      completesImmediately(chatRunner);

      await manager.sendMessage({ parentSessionId: "parent-1", sessionId: "sub-9", message: "继续" });
      await until(() => sessionStore.updateCalls.length > 0);

      expect(sessionStore.updateCalls[0]).toMatchObject({ id: "sub-9" });
    });
  });

  describe("waitForComplete", () => {
    it("已有完成结果时立即返回并清空队列", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      const items = await manager.waitForComplete("parent-1");

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ subSessionId: "sub-1", name: "x" });
      // 取走后 state 已被回收（running/completed/completers 皆空）→ 再次调用会等到超时，
      // 而不是立即返回空数组（既有行为，见下方「完全没有子代理记录」用例）
      await expect(manager.waitForComplete("parent-1", 30)).rejects.toThrow(
        /Timeout waiting for sub-agent/,
      );
    });

    it("已有等待者且无运行中子代理时，后来的调用方立即拿到空数组（不重复挂起）", async () => {
      const { manager } = setup();

      const first = manager.waitForComplete("parent-1", 60); // 先挂起一个等待者
      await new Promise((r) => setTimeout(r, 10));

      // 第二个调用方看到 state 存在且 running 为空 → 立即返回，不陪着挂起
      await expect(manager.waitForComplete("parent-1", 60)).resolves.toEqual([]);
      await expect(first).rejects.toThrow(/Timeout waiting for sub-agent/);
    });

    it("完全没有子代理记录时不会立即返回空数组，而是等到超时（既有行为）", async () => {
      // 注意：只有 state 存在且 running 为空才短路返回；state 为 undefined 时会一路等到超时。
      // 这是当前实现的既有行为，已记入 docs/technical-debt.md。
      const { manager } = setup();

      await expect(manager.waitForComplete("parent-1", 30)).rejects.toThrow(
        /Timeout waiting for sub-agent/,
      );
    });

    it("传入已中止的 abortSignal → 立即返回空数组", async () => {
      const { manager } = setup();
      const controller = new AbortController();
      controller.abort();

      await expect(manager.waitForComplete("parent-1", 5000, controller.signal)).resolves.toEqual([]);
    });

    it("等待超时 → reject", async () => {
      const { manager, chatRunner } = setup();
      neverCompletes(chatRunner);
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");

      await expect(manager.waitForComplete("parent-1", 20)).rejects.toThrow(
        /Timeout waiting for sub-agent to complete/,
      );
    });

    it("等待过程中 abort → resolve 空数组（不是 reject）", async () => {
      const { manager, chatRunner } = setup();
      neverCompletes(chatRunner);
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      const controller = new AbortController();

      const waiting = manager.waitForComplete("parent-1", 5000, controller.signal);
      setTimeout(() => controller.abort(), 20);

      await expect(waiting).resolves.toEqual([]);
    });

    it("有等待者时子代理完成 → 直接唤醒等待者，不走信箱", async () => {
      const { manager, chatRunner } = setup();
      let callbacks: any;
      chatRunner.startStreamImpl = (_p, cb) => {
        callbacks = cb;
        return new Promise<void>(() => undefined);
      };
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");

      const waiting = manager.waitForComplete("parent-1", 5000);
      await until(() => chatRunner.activeStreams.has("sub-1"));
      callbacks.onComplete("completed");

      const items = await waiting;
      expect(items).toHaveLength(1);
      expect(chatRunner.enqueued).toHaveLength(0); // 有人等 → 不投递信箱
    });
  });

  describe("closeSubAgent", () => {
    async function spawnRunningSub() {
      const ctx = setup();
      let callbacks: any;
      ctx.chatRunner.startStreamImpl = (_p, cb) => {
        callbacks = cb;
        return new Promise<void>(() => undefined);
      };
      await ctx.manager.spawn({ parentContext: createFakeParentContext(), name: "跑着的", task: "t" }, "background");
      await until(() => ctx.chatRunner.activeStreams.has("sub-1"));
      return { ...ctx, callbacks: () => callbacks };
    }

    it("运行中关闭 → 取消流、冻结会话、广播 stopReason=closed", async () => {
      const { manager, sessionStore, chatRunner, eventBus } = await spawnRunningSub();

      await manager.closeSubAgent("sub-1", "parent-1", "D:/ws");

      expect(chatRunner.cancelCalls).toContain("sub-1");
      expect(sessionStore.updateCalls.some((c) => c.id === "sub-1" && c.patch.closeReason === "closed")).toBe(
        true,
      );
      expect(eventBus.of("subagent.closed")[0].payload.stopReason).toBe("closed");
    });

    it("关闭后流才结束 → 不再投递脏消息给主 Agent", async () => {
      const { manager, chatRunner, callbacks } = await spawnRunningSub();

      await manager.closeSubAgent("sub-1", "parent-1", "D:/ws");
      // 流在关闭之后才回调结束
      callbacks().onComplete("completed");
      await new Promise((r) => setTimeout(r, 50));

      expect(chatRunner.enqueued).toHaveLength(0);
    });

    it("关闭会唤醒挂起的等待者，避免其永久挂起", async () => {
      const { manager } = await spawnRunningSub();

      const waiting = manager.waitForComplete("parent-1", 5000);
      await manager.closeSubAgent("sub-1", "parent-1", "D:/ws");

      await expect(waiting).resolves.toEqual([]);
    });

    it("关闭未运行的子代理也能正常冻结", async () => {
      const { manager, sessionStore } = setup();
      sessionStore.seed({ id: "sub-7", parentId: "parent-1", title: "已完成", closedAt: null });

      await manager.closeSubAgent("sub-7", "parent-1", "D:/ws");

      expect(sessionStore.updateCalls.some((c) => c.id === "sub-7")).toBe(true);
    });
  });

  describe("getSubAgents 状态推导", () => {
    it("running 优先于 closed，未冻结未完成者为 completed", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      sessionStore.seed({ id: "s-run", parentId: "parent-1", title: "跑" });
      sessionStore.seed({ id: "s-closed", parentId: "parent-1", title: "冻", closedAt: new Date() });
      sessionStore.seed({ id: "s-plain", parentId: "parent-1", title: "普" });
      chatRunner.activeStreams.add("s-run");

      await expect(manager.getSubAgents("parent-1")).resolves.toEqual([
        { subSessionId: "s-run", name: "跑", status: "running" },
        { subSessionId: "s-closed", name: "冻", status: "closed" },
        { subSessionId: "s-plain", name: "普", status: "completed" },
      ]);
    });

    it("标题为空时回退为 Sub-Agent", async () => {
      const { manager, sessionStore } = setup();
      sessionStore.seed({ id: "s-1", parentId: "parent-1", title: "" });

      const list = await manager.getSubAgents("parent-1");

      expect(list[0].name).toBe("Sub-Agent");
    });

    it("无子会话返回空数组", async () => {
      const { manager } = setup();

      await expect(manager.getSubAgents("parent-1")).resolves.toEqual([]);
    });
  });

  describe("spawnForWorkflow", () => {
    it("跳过每父会话 10 个上限（并发由 workflow 引擎的槽位控制）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      sessionStore.setParentCount("parent-1", 10);
      completesImmediately(chatRunner);

      await expect(
        manager.spawnForWorkflow({
          parentContext: createFakeParentContext(),
          name: "wf",
          task: "t",
          workflow: { runId: "r1" },
        }),
      ).resolves.toBeTruthy();
    });

    it("runId/label/phase 写入 settings.workflow（不再写 lifecycle）", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawnForWorkflow({
        parentContext: createFakeParentContext(),
        name: "wf",
        task: "t",
        workflow: { runId: "r1", label: "爬取", phase: "P1" },
      });

      expect(sessionStore.createCalls[0].settings).toMatchObject({
        workflow: { runId: "r1", label: "爬取", phase: "P1" },
      });
      expect(sessionStore.createCalls[0].settings.lifecycle).toBeUndefined();
    });

    it("省略 label/phase 时不写入这两个字段", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);

      await manager.spawnForWorkflow({
        parentContext: createFakeParentContext(),
        name: "wf",
        task: "t",
        workflow: { runId: "r1" },
      });

      expect(sessionStore.createCalls[0].settings.workflow).toEqual({ runId: "r1" });
    });

    it("创建后回调 onCreated，便于引擎记录 subSessionId", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);
      const onCreated = jest.fn();

      await manager.spawnForWorkflow({
        parentContext: createFakeParentContext(),
        name: "wf",
        task: "t",
        workflow: { runId: "r1" },
        onCreated,
      });

      expect(onCreated).toHaveBeenCalledWith("sub-1");
    });

    it("结果直传引擎（不走信箱），并在返回前冻结子会话以释放名额", async () => {
      const { manager, sessionStore, chatRunner, eventBus } = setup();
      completesImmediately(chatRunner);

      const result = await manager.spawnForWorkflow({
        parentContext: createFakeParentContext(),
        name: "wf",
        task: "t",
        workflow: { runId: "r1" },
      });

      expect(result).toMatchObject({ subSessionId: "sub-1", status: "completed" });
      // workflow 引擎自己就是等待者 → 绝不投递 <system_reminder>
      expect(chatRunner.enqueued).toHaveLength(0);
      // 该路径绕过 executeSubAgentStream / settle，必须自己冻结（commit c11e8155 修复的正是这里）
      expect(sessionStore.updateCalls[0]).toMatchObject({ id: "sub-1" });
      expect(sessionStore.updateCalls[0].patch.closedAt).toBeInstanceOf(Date);
      expect(sessionStore.updateCalls[0].patch.closeReason).toBe("completed");
      expect(eventBus.of("subagent.closed")).toHaveLength(1);
    });

    it("abortSignal 已中止 → 返回 aborted", async () => {
      const { manager } = setup();
      const controller = new AbortController();
      controller.abort();

      const result = await manager.spawnForWorkflow(
        { parentContext: createFakeParentContext(), name: "wf", task: "t", workflow: { runId: "r1" } },
        controller.signal,
      );

      expect(result).toMatchObject({ status: "error", stopReason: "aborted" });
    });

    it("指定的 agentId 不存在 → 抛错", async () => {
      const { manager, sessionStore } = setup();

      await expect(
        manager.spawnForWorkflow({
          parentContext: createFakeParentContext(),
          name: "wf",
          task: "t",
          agentId: "ghost",
          workflow: { runId: "r1" },
        }),
      ).rejects.toThrow(/does not exist/);
      expect(sessionStore.createCalls).toHaveLength(0);
    });
  });

  describe("信箱投递（无等待者的后台完成）", () => {
    it("投递 system_reminder 消息，带结果摘要与结构化 source", async () => {
      const { manager, chatRunner, messageStore } = setup();
      completesImmediately(chatRunner);
      messageStore.messages.set("sub-1", [assistantMessage("最终结论")]);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "分析", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      const msg = chatRunner.enqueued[0];
      expect(msg.sessionId).toBe("parent-1");
      expect(msg.blocks[0].text).toContain("<system_reminder>");
      expect(msg.blocks[0].text).toContain('Sub-agent "分析" (sub-1) completed');
      expect(msg.blocks[0].text).toContain("Result:\n最终结论");
      expect(msg.source).toMatchObject({ kind: "sub_agent", subSessionId: "sub-1", agentName: "分析" });
    });

    it("失败结果 → 文案为 failed 并附 Error", async () => {
      const { manager, chatRunner } = setup();
      chatRunner.startStreamImpl = (_p, cb) => {
        cb.onError?.(new Error("boom"));
      };

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      const text = chatRunner.enqueued[0].blocks[0].text;
      expect(text).toContain("failed");
      expect(text).toContain("Error: boom");
    });

    it("超长结果被截断为 1000 字符", async () => {
      const { manager, chatRunner, messageStore } = setup();
      completesImmediately(chatRunner);
      messageStore.messages.set("sub-1", [assistantMessage("x".repeat(2500))]);

      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      const text = chatRunner.enqueued[0].blocks[0].text;
      expect(text).toContain("...");
      expect(text).toContain("x".repeat(1000));
      expect(text).not.toContain("x".repeat(1001));
    });

    it("isValid 依赖 completed 条目；onConsumed 后失效（防止脏消息投递）", async () => {
      const { manager, chatRunner } = setup();
      completesImmediately(chatRunner);
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      const msg = chatRunner.enqueued[0];
      expect(msg.isValid()).toBe(true);

      msg.onConsumed();

      expect(msg.isValid()).toBe(false);
    });

    it("one_shot：主 Agent 消费结果后才冻结子会话", async () => {
      const { manager, sessionStore, chatRunner } = setup();
      completesImmediately(chatRunner);
      await manager.spawn({ parentContext: createFakeParentContext(), name: "x", task: "t" }, "background");
      await until(() => chatRunner.enqueued.length === 1);

      // 尚未消费 → 不冻结
      expect(sessionStore.updateCalls).toHaveLength(0);

      chatRunner.enqueued[0].onConsumed();
      await until(() => sessionStore.updateCalls.length > 0);

      expect(sessionStore.updateCalls[0].patch.closedAt).toBeInstanceOf(Date);
    });
  });

  describe("Job Registry 集成", () => {
    it("后台 spawn 注册 job，job_output 读最终答案并抑制信箱通知", async () => {
      const { manager, chatRunner, messageStore, registry, sessionStore } = setup({
        withRegistry: true,
      });
      completesImmediately(chatRunner);
      messageStore.messages.set("sub-1", [assistantMessage("最终答案")]);

      const result = await manager.spawn(
        { parentContext: createFakeParentContext(), name: "bg", task: "t" },
        "background",
      );

      expect(result.status).toBe("running");
      const jobId = result.jobId!;
      expect(jobId).toMatch(/^job-/);
      expect(registry!.get(jobId, "parent-1")?.handle).toBe("sub-1");

      const settled = await registry!.wait(jobId, "parent-1", 2000);
      expect(settled).toMatchObject({ status: "completed", handle: "sub-1" });

      const read = await registry!.read(jobId, "parent-1");
      expect(read.output.text).toBe("最终答案");
      expect(read.job.reported).toBe(true);
      // jobId 路径不再写信箱，避免双通知
      expect(chatRunner.enqueued).toHaveLength(0);
      await until(() => sessionStore.updateCalls.length > 0);
      expect(sessionStore.updateCalls[0].patch.closedAt).toBeInstanceOf(Date);
    });

    it("subagent_manager wait 取走结果后 job reported，不再投递信箱", async () => {
      const { manager, chatRunner, messageStore, registry } = setup({
        withRegistry: true,
      });
      completesImmediately(chatRunner);
      messageStore.messages.set("sub-1", [assistantMessage("wait 结果")]);

      const result = await manager.spawn(
        { parentContext: createFakeParentContext(), name: "bg", task: "t" },
        "background",
      );
      const jobId = result.jobId!;
      await until(
        () => registry!.get(jobId, "parent-1")?.status !== "running",
      );

      const items = await manager.waitForComplete("parent-1", 1000);

      expect(items[0].result.content).toBe("wait 结果");
      expect(registry!.get(jobId, "parent-1")?.reported).toBe(true);
      expect(chatRunner.enqueued).toHaveLength(0);
    });

    it("前台超时转后台时注册 job", async () => {
      const { manager, chatRunner, registry } = setup({ withRegistry: true });
      neverCompletes(chatRunner);
      jest.useFakeTimers();

      const pending = manager.spawn({
        parentContext: createFakeParentContext(),
        name: "timeout",
        task: "t",
      });
      await jest.advanceTimersByTimeAsync(20 * 60 * 1000 + 100);
      const result = await pending;

      expect(result.status).toBe("running");
      expect(result.jobId).toMatch(/^job-/);
      expect(registry!.get(result.jobId!, "parent-1")?.status).toBe("running");
    });

    it("job_kill 取消运行中的子 Agent，且不投递脏通知", async () => {
      const { manager, chatRunner, messageStore, registry, sessionStore } = setup({
        withRegistry: true,
      });
      cancellableStream(chatRunner);
      messageStore.messages.set("sub-1", [assistantMessage("部分结果")]);

      const result = await manager.spawn(
        { parentContext: createFakeParentContext(), name: "bg", task: "t" },
        "background",
      );
      const jobId = result.jobId!;

      expect(registry!.kill(jobId, "parent-1", "test")).toBe("requested");
      const settled = await registry!.wait(jobId, "parent-1", 2000);

      expect(settled.status).toBe("killed");
      expect(chatRunner.cancelCalls).toContain("sub-1");
      expect(chatRunner.enqueued).toHaveLength(0);
      await until(() => sessionStore.updateCalls.length > 0);
    });

    it("Registry 配额满时后台 spawn 直接报错（不再回退信箱）", async () => {
      const { manager, chatRunner, registry } = setup({
        withRegistry: true,
      });
      for (let i = 0; i < 10; i++) {
        registry!.start({
          kind: "shell",
          label: `filler-${i}`,
          sessionId: "parent-1",
          read: async () => ({
            text: "",
            offset: 0,
            nextOffset: 0,
            size: 0,
            truncated: false,
          }),
          cancel: () => undefined,
          done: new Promise<JobOutcome>(() => undefined),
        });
      }

      // 快速失败：子 Agent 不注册 job 就不让跑，否则配额被回退路径架空
      await expect(
        manager.spawn(
          { parentContext: createFakeParentContext(), name: "bg", task: "t" },
          "background",
        ),
      ).rejects.toThrow(/background job limit reached/);
      // 没有产生任何后台会话或通知
      expect(chatRunner.enqueued).toHaveLength(0);
      expect(registry!.list("parent-1")).toHaveLength(10);
    });
  });
});
