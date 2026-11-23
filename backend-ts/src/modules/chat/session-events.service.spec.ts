/**
 * SessionEventsService 连接补发（catchup）回归测试
 *
 * 背景 bug：补发（connected + 活跃流 eventBuffer 重放 + running 状态补发）此前经
 * queueMicrotask 往普通 Subject 上 next，而 NestJS 对 @Sse 返回值的订阅发生在
 * Promise.resolve(result).then(...) 及拦截器链的 promise 反应里，严格晚于
 * subscribe() 的同步栈——补发全部打在零订阅者的 Subject 上被静默丢弃
 * （刷新页面后已流出的 chunk 丢失、isStreaming 状态丢失）。
 * 修复：defer + concat 把补发做成返回流自身的前缀，订阅何时发生都能收到。
 *
 * session-meta.store 依赖 better-sqlite3 原生模块，测试中以空类 mock（仅作构造器类型）。
 */
jest.mock("./session-meta.store", () => ({ TestSessionStore: class {} }));

import { SessionEventsService } from "./session-events.service";
import { SessionStreamManager } from "./session-stream.manager";
import type { JobSnapshot } from "../jobs/job.types";

describe("SessionEventsService 连接补发", () => {
  let streamManager: SessionStreamManager;
  let service: SessionEventsService;

  const parse = (e: any) => JSON.parse(e.data);

  beforeEach(() => {
    streamManager = new SessionStreamManager();
    const sessionStore = { getSessionType: jest.fn().mockReturnValue("web") };
    const userInputQueue = {
      epoch: "test-epoch",
      getAllCounts: jest.fn(() => ({})),
    };
    service = new SessionEventsService(
      streamManager,
      sessionStore as any,
      userInputQueue as any,
    );
    service.onModuleInit(); // 注册 SSE 直投 relay（publish → pushStreamEvent）
  });

  afterEach(() => {
    service.onModuleDestroy(); // 清理心跳定时器
  });

  it("订阅晚于 subscribe() 返回（NestJS 真实时序）也能收到完整补发", async () => {
    // 活跃流已有 3 条缓冲事件
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "turn_start",
      turnId: "t1",
      modelName: "m",
    } as any);
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "你",
    } as any);
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "好",
    } as any);

    const { observable } = service.subscribe("client-1");

    // 关键：模拟框架的延迟订阅——若干微任务 + 一个宏任务之后才订阅。
    // 旧实现（queueMicrotask 往 Subject 上 next）在此场景补发全丢；defer+concat 不受影响。
    await new Promise((r) => setTimeout(r, 0));

    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    expect(received[0].type).toBe("connected");
    // 连接补发的用户队列计数快照（侧边栏角标恢复）
    expect(received[1].type).toBe("queues_snapshot");
    expect(received[1].payload).toEqual({
      epoch: "test-epoch",
      counts: {},
    });
    expect(received[2].method).toBe("stream/turn_start");
    expect(received[3].method).toBe("stream/text_delta");
    expect(received[3].payload.text).toBe("你");
    expect(received[4].payload.text).toBe("好");
    expect(received[5].type).toBe("stream_status_changed");
    expect(received[5].payload).toMatchObject({
      status: "running",
      kind: "chat",
      sessionType: "web",
    });
    // 重放事件携带 publish 盖戳（前端入口幂等的游标依据：同 bootId 下的 (prevSeq, chunkSeq)）
    expect(received[3].payload.chunkSeq).toBe(2);
    expect(received[3].payload.prevSeq).toBe(0);
    expect(received[3].payload.streamBootId).toBeTruthy();
  });

  it("context_stats 映射为 stream/context_stats 并随连接补发重放", () => {
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "context_stats",
      turnId: "t1",
      contextStats: {
        usedTokens: 120,
        effectiveContextWindow: 1000,
        messageCount: 3,
        breakdown: { systemPrompt: 50, history: 60, tools: 10 },
      },
    } as any);

    const { observable } = service.subscribe("client-1");
    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    const ctx = received.find((e) => e.method === "stream/context_stats");
    expect(ctx).toBeTruthy();
    expect(ctx.payload.contextStats).toMatchObject({
      usedTokens: 120,
      effectiveContextWindow: 1000,
      messageCount: 3,
    });
  });

  it("补发在前、live 事件在后，顺序无缝衔接", () => {
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "turn_start",
      turnId: "t1",
      modelName: "m",
    } as any);

    const { observable } = service.subscribe("client-1");
    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    // 订阅建立后的 live 事件经 relay 直投
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "x",
    } as any);

    expect(received.map((e) => e.method ?? e.type)).toEqual([
      "connected",
      "queues_snapshot",
      "stream/turn_start",
      "stream_status_changed",
      "stream/text_delta",
    ]);
    expect(received[4].payload.chunkSeq).toBe(2);
  });

  it("connected 帧下发活跃流的补发起点（buffer 首帧位置）", () => {
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", { type: "turn_start", turnId: "t1" } as any);
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "a",
    } as any);

    const { observable } = service.subscribe("client-1");
    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    expect(received[0].type).toBe("connected");
    expect(received[0].payload.streamPositions).toEqual([
      { sessionId: "s1", prevSeq: 0, chunkSeq: 1 },
    ]);
  });

  it("活跃流尚未发布任何帧 → streamPositions 为空", () => {
    streamManager.startStream("s1", new AbortController(), "chat");

    const { observable } = service.subscribe("client-1");
    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    expect(received[0].type).toBe("connected");
    expect(received[0].payload.streamPositions).toEqual([]);
  });

  it("连接窗口内（订阅前）到达的 chunk 经补发快照送达，不丢失", () => {
    streamManager.startStream("s1", new AbortController(), "chat");
    const { observable } = service.subscribe("client-1");

    // HTTP 已连接、框架尚未订阅的窗口内新到 chunk：
    // 直投打在零订阅者 subject 上（丢弃），但已进 buffer → 应由补发快照覆盖
    streamManager.publish("s1", {
      type: "turn_start",
      turnId: "t1",
      modelName: "m",
    } as any);
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "窗",
    } as any);

    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));

    const texts = received
      .filter((e) => e.method === "stream/text_delta")
      .map((e) => e.payload.text);
    expect(texts).toEqual(["窗"]);
  });

  it("同 clientId 两条连接并存（订阅表按 connectionId 键控），旧连接 close 不误删新连接", () => {
    const first = service.subscribe("client-1");
    const second = service.subscribe("client-1"); // 刷新/另一标签页：同 clientId 新连接

    // 两条连接各占一条条目，互不覆盖
    expect(service.getClientCount()).toBe(2);

    // 旧连接的 req close 晚到 → 只删自己那条，新连接注册不受影响
    service.unsubscribe("client-1", first.connectionId);
    expect(service.getClientCount()).toBe(1);

    // 新连接的事件流仍然存活：live 事件可达
    const received: any[] = [];
    second.observable.subscribe((e) => received.push(parse(e)));
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "turn_start",
      turnId: "t1",
      modelName: "m",
    } as any);
    expect(received.some((e) => e.method === "stream/turn_start")).toBe(true);

    // 新连接正常注销
    service.unsubscribe("client-1", second.connectionId);
    expect(service.getClientCount()).toBe(0);
  });

  it("bot.status_changed / bot.changed 转成宿主级 bot_* 事件广播", () => {
    const { observable } = service.subscribe("client-1");
    const received: any[] = [];
    observable.subscribe((e) => received.push(parse(e)));
    received.length = 0; // 丢弃建连补发

    service.handleBotStatusChanged({
      botId: "bot-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      runtimeStatus: "reconnecting",
      status: "disconnected",
      reason: "reconnect",
    });
    service.handleBotChanged({
      botId: "bot-1",
      timestamp: "2026-01-01T00:00:01.000Z",
      action: "updated",
    });

    expect(received.map((e) => e.type)).toEqual([
      "bot_status_changed",
      "bot_changed",
    ]);
    expect(received[0].sessionId).toBe("*");
    expect(received[0].payload).toMatchObject({
      botId: "bot-1",
      runtimeStatus: "reconnecting",
    });
    expect(received[1].payload.action).toBe("updated");
  });

  // === 终态墓碑（P1）：stopStream 删流后仍能在重连补发终态快照 ===

  describe("终态墓碑", () => {
    const TERMINAL_TS = "2026-01-01T00:00:00.000Z";

    function emitTerminal(
      sessionId: string,
      status: "completed" | "user_cancel" | "error" = "completed",
      timestamp = TERMINAL_TS,
    ) {
      service.handleStreamStatusChanged({
        sessionId,
        timestamp,
        source: "client-1",
        payload: { status, reason: status, sessionType: "web" },
      });
    }

    function collectCatchup(clientId: string): any[] {
      const received: any[] = [];
      service
        .subscribe(clientId)
        .observable.subscribe((e) => received.push(parse(e)));
      return received;
    }

    it("终态写入墓碑：重连补发原帧（replayed + terminalId + lastSeq）", () => {
      streamManager.startStream("s1", new AbortController(), "chat");
      streamManager.publish("s1", {
        type: "text_delta",
        messageId: "m1",
        text: "x",
        prevSeq: 7,
      } as any);
      streamManager.stopStream("s1", "completed");

      emitTerminal("s1", "completed");

      const terminal = collectCatchup("client-2").find(
        (e) => e.type === "stream_status_changed",
      );
      expect(terminal).toBeDefined();
      expect(terminal.payload).toMatchObject({
        status: "completed",
        replayed: true,
        lastSeq: 7,
        kind: "chat",
      });
      expect(typeof terminal.payload.terminalId).toBe("string");
      expect(terminal.payload.terminalId).toContain("s1");
    });

    it("running 事件清除墓碑：新回合开始后不再补发旧终态", () => {
      emitTerminal("s1");
      service.handleStreamStatusChanged({
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        payload: { status: "running", sessionType: "web" },
      });

      const replays = collectCatchup("client-2").filter(
        (e) => e.type === "stream_status_changed" && e.payload?.replayed,
      );
      expect(replays).toEqual([]);
    });

    it("同一会话已有活跃流时跳过墓碑（队列续跑不覆盖 running）", () => {
      emitTerminal("s1");
      streamManager.startStream("s1", new AbortController(), "chat");

      const statuses = collectCatchup("client-2").filter(
        (e) => e.type === "stream_status_changed",
      );
      expect(statuses).toHaveLength(1);
      expect(statuses[0].payload.status).toBe("running");
      expect(statuses[0].payload.replayed).toBeUndefined();
    });

    it("TTL 过期后不再补发", () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date(TERMINAL_TS));
        emitTerminal("s1");
        jest.setSystemTime(
          new Date(Date.parse(TERMINAL_TS) + 10 * 60_000 + 1),
        );

        const replays = collectCatchup("client-2").filter(
          (e) => e.type === "stream_status_changed" && e.payload?.replayed,
        );
        expect(replays).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("超过上限淘汰最旧（保留最近结束的 200 条）", () => {
      const total = 205;
      for (let i = 0; i < total; i += 1) {
        emitTerminal(
          `s-${i}`,
          "completed",
          `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
      }

      const replays = collectCatchup("client-2").filter(
        (e) => e.type === "stream_status_changed" && e.payload?.replayed,
      );
      expect(replays).toHaveLength(200);
      expect(replays.some((e) => e.sessionId === "s-0")).toBe(false);
      expect(replays.some((e) => e.sessionId === `s-${total - 1}`)).toBe(true);
    });

    it("onModuleDestroy 清空墓碑", () => {
      emitTerminal("s1");
      service.onModuleDestroy();
      expect((service as any).recentTerminals.size).toBe(0);
    });
  });
});

describe("SessionStreamManager 事件盖戳", () => {
  it("(prevSeq, chunkSeq) 跨流（回合）连续：同一区间 ord 递增，base 不变", () => {
    const mgr = new SessionStreamManager();
    const relay = jest.fn();
    mgr.setStreamRelay(relay);

    mgr.startStream("s1", new AbortController(), "chat");
    mgr.publish("s1", { type: "turn_start", turnId: "t1" } as any);
    mgr.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "a",
    } as any);
    mgr.stopStream("s1", "completed");

    // 新回合（新 ActiveStream）：位置继续递增而非归零——
    // 否则前端幂等游标会把新回合首批事件误判为重复而丢弃
    mgr.startStream("s1", new AbortController(), "chat");
    mgr.publish("s1", { type: "turn_start", turnId: "t2" } as any);

    expect(relay.mock.calls.map((c) => [c[1].prevSeq, c[1].chunkSeq])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(new Set(relay.mock.calls.map((c) => c[1].streamBootId)).size).toBe(1);
    // 盖戳后的同一对象进 buffer（补发与 live 一致）
    const buffer = mgr.getActiveStreams()[0].eventBuffer;
    expect(buffer.map((e) => [e.prevSeq, e.chunkSeq])).toEqual([[0, 3]]);
  });

  it("会话之间位置相互独立", () => {
    const mgr = new SessionStreamManager();
    const relay = jest.fn();
    mgr.setStreamRelay(relay);

    mgr.startStream("s1", new AbortController(), "chat");
    mgr.startStream("s2", new AbortController(), "chat");
    mgr.publish("s1", { type: "turn_start", turnId: "t1" } as any);
    mgr.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "a",
    } as any);
    mgr.publish("s2", { type: "turn_start", turnId: "t9" } as any);

    expect(relay.mock.calls.map((c) => [c[0], c[1].prevSeq, c[1].chunkSeq])).toEqual([
      ["s1", 0, 1],
      ["s1", 0, 2],
      ["s2", 0, 1],
    ]);
  });

  it("base 前进（有新事件落库）→ ord 归零为 1", () => {
    const mgr = new SessionStreamManager();
    const relay = jest.fn();
    mgr.setStreamRelay(relay);
    mgr.startStream("s1", new AbortController(), "chat");

    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "a", prevSeq: 7 } as any);
    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "b", prevSeq: 7 } as any);
    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "c", prevSeq: 8 } as any);

    expect(relay.mock.calls.map((c) => [c[1].prevSeq, c[1].chunkSeq])).toEqual([
      [7, 1],
      [7, 2],
      [8, 1],
    ]);
  });

  it("prevSeq 回退（并发 publish 乱序）→ 钳制到当前 base 并递增 ord", () => {
    const mgr = new SessionStreamManager();
    const relay = jest.fn();
    mgr.setStreamRelay(relay);
    mgr.startStream("s1", new AbortController(), "chat");

    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "a", prevSeq: 8 } as any);
    // 后到的帧读到更旧的 prevSeq：不能让它把位置拉回去，否则前端会当成已消费
    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "b", prevSeq: 7 } as any);
    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "c", prevSeq: 9 } as any);

    expect(relay.mock.calls.map((c) => [c[1].prevSeq, c[1].chunkSeq])).toEqual([
      [8, 1],
      [8, 2],
      [9, 1],
    ]);
  });

  it("缺 prevSeq 的运行时帧（chat-runner 裸 error）沿用上次 base 并递增 ord", () => {
    const mgr = new SessionStreamManager();
    const relay = jest.fn();
    mgr.setStreamRelay(relay);
    mgr.startStream("s1", new AbortController(), "chat");

    mgr.publish("s1", { type: "text_delta", messageId: "m1", text: "a", prevSeq: 5 } as any);
    mgr.publish("s1", { type: "error", error: "boom" } as any);

    expect(relay.mock.calls.map((c) => [c[1].prevSeq, c[1].chunkSeq])).toEqual([
      [5, 1],
      [5, 2],
    ]);
  });
});

/**
 * jobs 快照广播契约：前端 jobs store 的唯一上游。
 * 这条映射此前零测试——事件名/payload 层级写错（例如漏 bootId、把 jobs 套一层）
 * 前端只会静默丢快照，UI 停在过期状态且没有任何报错。
 */
describe("SessionEventsService jobs 快照广播", () => {
  let service: SessionEventsService;

  beforeEach(() => {
    const streamManager = new SessionStreamManager();
    const sessionStore = { getSessionType: jest.fn().mockReturnValue("web") };
    const userInputQueue = {
      epoch: "test-epoch",
      getAllCounts: jest.fn(() => ({})),
    };
    service = new SessionEventsService(
      streamManager,
      sessionStore as any,
      userInputQueue as any,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it("jobs.changed → jobs_snapshot，payload 带 bootId/revision/jobs", () => {
    const broadcast = jest.spyOn(service as any, "broadcastToAllClients");
    const jobs: JobSnapshot[] = [
      {
        id: "job-1",
        kind: "shell",
        label: "sleep 60",
        sessionId: "s1",
        status: "running",
        startedAt: 1,
        reported: false,
      },
    ];

    service.handleJobsChanged({
      sessionId: "s1",
      bootId: "boot-1",
      revision: 7,
      timestamp: "2026-01-01T00:00:00.000Z",
      jobs,
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: "jobs_snapshot",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { bootId: "boot-1", revision: 7, jobs },
    });
  });
});
