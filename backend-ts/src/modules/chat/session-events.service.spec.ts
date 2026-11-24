/**
 * SessionEventsService（WebSocket 连接模型）回归测试：
 * - watch 触发按会话的连接补发（connected → buffer → running → 终态）
 * - 内容帧只发订阅者，跨会话信号（ask/workflow/compression_error）始终广播
 * - 会话/宿主事件全量广播；多连接互不影响
 */
jest.mock("./session-meta.store", () => ({ TestSessionStore: class {} }));

import { SessionEventsService } from "./session-events.service";
import { SessionStreamManager } from "./session-stream.manager";

describe("SessionEventsService 连接与订阅", () => {
  let streamManager: SessionStreamManager;
  let service: SessionEventsService;

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
    service.onModuleInit(); // 注册 relay：publish → pushStreamEvent
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  function connect(clientId = "c1") {
    const received: any[] = [];
    const connection = service.registerConnection(
      clientId,
      service.createConnectionId(),
      (data) => received.push(JSON.parse(data)),
    );
    return { connection, received };
  }

  const events = (received: any[]) =>
    received.filter((m) => m.kind === "event").map((m) => m.data);

  it("注册即下发队列计数快照", () => {
    const { received } = connect();
    expect(events(received)).toEqual([
      expect.objectContaining({
        type: "queues_snapshot",
        payload: { epoch: "test-epoch", counts: {} },
      }),
    ]);
  });

  it("侧栏修订号广播到所有连接，不受 watch 过滤", () => {
    const a = connect("a");
    const b = connect("b");
    service.watchSessions(b.connection, ["s1"]);
    a.received.length = 0;
    b.received.length = 0;

    service.handleSidebarStateChanged({
      scope: "sidebar",
      bootId: "boot-1",
      revision: 7,
      updatedAt: "2026-01-01T00:00:00.000Z",
      reason: "test",
    });

    const expected = {
      kind: "state",
      scope: "sidebar",
      bootId: "boot-1",
      revision: 7,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(a.received).toEqual([expected]);
    expect(b.received).toEqual([expected]);
  });

  it("watch 补发：connected → buffer 重放 → running 状态", () => {
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

    const { connection, received } = connect();
    service.watchSessions(connection, ["s1"]);

    const payloads = events(received).filter(
      (e: any) => e.type !== "queues_snapshot",
    );
    expect(payloads[0].type).toBe("connected");
    expect(payloads[0].payload.streamPositions).toEqual([
      { sessionId: "s1", baseSeq: 0, chunkSeq: 1 },
    ]);
    expect(payloads.slice(1, 3).map((e: any) => e.method)).toEqual([
      "stream/turn_start",
      "stream/text_delta",
    ]);
    expect(payloads[3]).toMatchObject({
      type: "stream_status_changed",
      payload: { status: "running", kind: "chat" },
    });
  });

  it("watch 只补发订阅的会话", () => {
    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.startStream("s2", new AbortController(), "chat");
    streamManager.publish("s1", { type: "turn_start", turnId: "t1" } as any);
    streamManager.publish("s2", { type: "turn_start", turnId: "t2" } as any);

    const { connection, received } = connect();
    service.watchSessions(connection, ["s1"]);

    const sessions = events(received)
      .filter((e: any) => typeof e.method === "string")
      .map((e: any) => e.payload.sessionId);
    expect(sessions).toEqual(["s1"]);
    const connected = events(received).find(
      (e: any) => e.type === "connected",
    ) as any;
    expect(connected.payload.streamPositions).toHaveLength(1);
  });

  it("内容帧只发订阅者；跨会话信号始终广播", () => {
    const watcher = connect("watch-s1");
    service.watchSessions(watcher.connection, ["s1"]);
    const other = connect("other");
    watcher.received.length = 0;
    other.received.length = 0;

    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.startStream("s2", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      index: 0,
      text: "a",
    } as any);
    streamManager.publish("s2", {
      type: "text_delta",
      messageId: "m2",
      index: 0,
      text: "b",
    } as any);
    // 跨会话信号：即使没 watch s2 也应收到
    streamManager.publish("s2", {
      type: "ask_requested",
      requestId: "r1",
      kind: "approval",
      questions: [],
    } as any);

    const watcherPayloads = events(watcher.received);
    expect(
      watcherPayloads.filter((e: any) => e.method === "stream/text_delta"),
    ).toHaveLength(1);
    expect(
      watcherPayloads.some(
        (e: any) => e.method === "stream/ask_requested",
      ),
    ).toBe(true);

    const otherPayloads = events(other.received);
    expect(
      otherPayloads.some((e: any) => e.method === "stream/text_delta"),
    ).toBe(false);
    expect(
      otherPayloads.some(
        (e: any) => e.method === "stream/ask_requested",
      ),
    ).toBe(true);
  });

  it("会话/宿主事件全量广播（不受 watch 影响）", () => {
    const a = connect("a");
    const b = connect("b");
    a.received.length = 0;
    b.received.length = 0;

    service.handleSessionUpdated({
      sessionId: "s9",
      timestamp: "t",
      payload: { session: { id: "s9" } },
    } as any);

    for (const received of [a.received, b.received]) {
      const list = events(received);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        type: "session_updated",
        sessionId: "s9",
      });
    }
  });

  it("终态墓碑按订阅补发", () => {
    service.handleStreamStatusChanged({
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      source: "c1",
      payload: { status: "completed", sessionType: "web" },
    } as any);

    const watching = connect("watching");
    service.watchSessions(watching.connection, ["s1"]);
    const notWatching = connect("not-watching");
    service.watchSessions(notWatching.connection, ["s2"]);

    const replayed = events(watching.received).find(
      (e: any) => e.type === "stream_status_changed" && e.payload?.replayed,
    );
    expect(replayed).toBeDefined();
    expect(
      events(notWatching.received).some(
        (e: any) => e.type === "stream_status_changed" && e.payload?.replayed,
      ),
    ).toBe(false);
  });

  it("unsubscribe 后不再接收任何帧", () => {
    const { connection, received } = connect();
    service.unsubscribe(connection);
    received.length = 0;

    streamManager.startStream("s1", new AbortController(), "chat");
    streamManager.publish("s1", {
      type: "text_delta",
      messageId: "m1",
      index: 0,
      text: "x",
    } as any);
    service.handleSessionUpdated({
      sessionId: "s1",
      timestamp: "t",
      payload: { session: { id: "s1" } },
    } as any);

    expect(received).toEqual([]);
    expect(service.getClientCount()).toBe(0);
  });

  it("同 clientId 的多条连接独立补发/清理", () => {
    const first = connect("same");
    const second = connect("same");
    service.unsubscribe(first.connection);
    const before = second.received.length;

    service.handleSessionUpdated({
      sessionId: "s1",
      timestamp: "t",
      payload: { session: { id: "s1" } },
    } as any);

    expect(second.received.length).toBe(before + 1);
  });
});
