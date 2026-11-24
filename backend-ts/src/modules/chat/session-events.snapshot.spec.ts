/// <reference types="jest" />

import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";

/**
 * 带内历史快照（WebSocket 版）：
 * - open 隐含 watch，并保证 snapshot 先于读页期间积压的帧
 * - 同一连接的 open 串行执行（多 pane 不互相抢占）
 * - 排空时丢弃 logSeq < endSeq 的持久化帧；读页失败也提交（带 error）
 */
describe("SessionEventsService 带内历史快照", () => {
  let service: SessionEventsService;
  let streamManager: SessionStreamManager;

  beforeEach(() => {
    streamManager = new SessionStreamManager();
    const sessionStore = { getSessionType: jest.fn().mockReturnValue("web") };
    const userInputQueue = { epoch: "e", getAllCounts: jest.fn(() => ({})) };
    service = new SessionEventsService(
      streamManager,
      sessionStore as any,
      userInputQueue as any,
    );
    service.onModuleInit();
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

  const kind = (received: any[], k: string) =>
    received.filter((m) => m.kind === k);
  const events = (received: any[]) =>
    received.filter((m) => m.kind === "event").map((m) => m.data);

  const page = (endSeq = 0) => ({
    events: [{ type: "turn/start", seq: endSeq }],
    endSeq,
    nextBeforeSeq: null,
    hasMore: false,
  });

  it("open 隐含 watch；snapshot 先于读页期间积压的帧", async () => {
    const { connection, received } = connect();
    streamManager.startStream("s1", new AbortController(), "chat");

    await service.openSnapshot(connection, "s1", "req-1", async () => {
      streamManager.publish("s1", {
        type: "text_delta",
        messageId: "m1",
        index: 0,
        text: "during",
        logSeq: 5,
      } as any);
      return page(2);
    });

    const snapshotIndex = received.findIndex((m) => m.kind === "snapshot");
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(received[snapshotIndex].requestId).toBe("req-1");
    expect(received[snapshotIndex].payload).toMatchObject({
      sessionId: "s1",
      endSeq: 2,
      hasMore: false,
    });

    const duringIndex = received.findIndex(
      (m) => m.kind === "event" && m.data.payload?.text === "during",
    );
    expect(duringIndex).toBeGreaterThan(snapshotIndex);
    // 打开即订阅：后续 live 帧能到达
    expect(connection.watchedSessions.has("s1")).toBe(true);
  });

  it("排空时丢弃 logSeq < endSeq 的帧，保留 delta/无 seq 帧", async () => {
    const { connection, received } = connect();

    await service.openSnapshot(connection, "s1", "req-1", async () => {
      streamManager.startStream("s1", new AbortController(), "chat");
      streamManager.publish("s1", {
        type: "text_delta",
        messageId: "m1",
        index: 0,
        text: "covered",
        logSeq: 4,
      } as any);
      streamManager.publish("s1", {
        type: "text_delta",
        messageId: "m1",
        index: 0,
        text: "after",
        logSeq: 5,
      } as any);
      streamManager.publish("s1", { type: "error", error: "boom" } as any);
      return page(5);
    });

    const texts = events(received)
      .filter((e: any) => e.method?.startsWith("stream/"))
      .map((e: any) => e.payload?.text ?? e.payload?.type);
    expect(texts).not.toContain("covered");
    expect(texts).toContain("after");
    expect(texts).toContain("error");
  });

  it("同一连接的 open 串行执行（第二个在读页前等待）", async () => {
    const { connection, received } = connect();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = service.openSnapshot(connection, "s1", "req-1", async () => {
      order.push("read-1");
      await firstGate;
      return page(1);
    });
    const second = service.openSnapshot(connection, "s1", "req-2", async () => {
      order.push("read-2");
      return page(2);
    });

    await Promise.resolve();
    expect(order).toEqual(["read-1"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["read-1", "read-2"]);
    expect(
      kind(received, "snapshot").map((m) => m.requestId),
    ).toEqual(["req-1", "req-2"]);
  });

  it("读页失败：提交带 error 的快照并放行队列", async () => {
    const { connection, received } = connect();

    const result = await service.openSnapshot(connection, "s1", "req-1", async () => {
      streamManager.startStream("s1", new AbortController(), "chat");
      streamManager.publish("s1", {
        type: "text_delta",
        messageId: "m1",
        index: 0,
        text: "queued",
        logSeq: 9,
      } as any);
      throw new Error("disk boom");
    });

    expect(result.ok).toBe(true);
    const snapshot = kind(received, "snapshot")[0];
    expect(snapshot.payload.error).toContain("disk boom");
    expect(
      events(received).some((e: any) => e.payload?.text === "queued"),
    ).toBe(true);
  });

  it("连接已断开：放弃提交", async () => {
    const { connection, received } = connect();

    const result = await service.openSnapshot(connection, "s1", "req-1", async () => {
      service.unsubscribe(connection);
      return page(3);
    });

    expect(result).toEqual({ ok: false, reason: "disconnected" });
    expect(kind(received, "snapshot")).toEqual([]);
  });
});
