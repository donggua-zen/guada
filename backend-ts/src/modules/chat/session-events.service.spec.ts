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
jest.mock("./session-meta.store", () => ({ SessionMetaStore: class {} }));

import { SessionEventsService } from "./session-events.service";
import { SessionStreamManager } from "./session-stream.manager";

describe("SessionEventsService 连接补发", () => {
  let streamManager: SessionStreamManager;
  let service: SessionEventsService;

  const parse = (e: any) => JSON.parse(e.data);

  beforeEach(() => {
    streamManager = new SessionStreamManager();
    const sessionStore = { getSessionType: jest.fn().mockReturnValue("web") };
    service = new SessionEventsService(streamManager, sessionStore as any);
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
    expect(received[1].method).toBe("stream/turn_start");
    expect(received[2].method).toBe("stream/text_delta");
    expect(received[2].payload.text).toBe("你");
    expect(received[3].payload.text).toBe("好");
    expect(received[4].type).toBe("stream_status_changed");
    expect(received[4].payload).toMatchObject({
      status: "running",
      kind: "chat",
      sessionType: "web",
    });
    // 重放事件携带 publish 盖戳（前端入口幂等的游标依据）
    expect(received[2].payload.streamSeq).toBe(2);
    expect(received[2].payload.streamBootId).toBeTruthy();
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
      "stream/turn_start",
      "stream_status_changed",
      "stream/text_delta",
    ]);
    expect(received[3].payload.streamSeq).toBe(2);
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
});

describe("SessionStreamManager 事件盖戳", () => {
  it("streamSeq 每会话单调递增、跨流（回合）不重置，bootId 恒定", () => {
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

    // 新回合（新 ActiveStream）：序号继续递增而非归零——
    // 否则前端幂等游标会把新回合首批事件误判为重复而丢弃
    mgr.startStream("s1", new AbortController(), "chat");
    mgr.publish("s1", { type: "turn_start", turnId: "t2" } as any);

    expect(relay.mock.calls.map((c) => c[1].streamSeq)).toEqual([1, 2, 3]);
    expect(new Set(relay.mock.calls.map((c) => c[1].streamBootId)).size).toBe(1);
    // 盖戳后的同一对象进 buffer（补发与 live 一致）
    expect(mgr.getActiveStreams()[0].eventBuffer.map((e) => e.streamSeq)).toEqual([
      3,
    ]);
  });

  it("会话之间序号相互独立", () => {
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

    expect(relay.mock.calls.map((c) => [c[0], c[1].streamSeq])).toEqual([
      ["s1", 1],
      ["s1", 2],
      ["s2", 1],
    ]);
  });
});
