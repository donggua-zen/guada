import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WebSocket 版事件客户端：连接/握手/watch 重放/快照等待器/重连监督。
 * 用内存 MockWebSocket 替代真实网络；时间用 fake timers。
 */
const hoisted = vi.hoisted(() => ({ sockets: [] as any[] }));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: any[] = [];
  closed = false;

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    hoisted.sockets.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  // 测试驱动
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  ready() {
    this.open();
    this.push({ kind: "ready", connectionId: "c1", protocol: "guada.events.v1" });
  }
}

let doc: any;
let win: any;

beforeEach(() => {
  vi.useFakeTimers();
  hoisted.sockets.length = 0;
  doc = new EventTarget() as any;
  doc.hidden = false;
  doc.visibilityState = "visible";
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("localStorage", { getItem: () => "test-token" });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

import { SessionEventsService } from "./SessionEventsService";

function lastSocket() {
  return hoisted.sockets[hoisted.sockets.length - 1];
}

function createService() {
  return new SessionEventsService(() => "http://localhost:3000/api/v1");
}

describe("SessionEventsService（WebSocket）连接", () => {
  it("connect：URL 带 clientId，子协议带 bearer token", () => {
    const service = createService();
    service.connect();

    expect(hoisted.sockets).toHaveLength(1);
    const socket = lastSocket();
    expect(socket.url).toContain("/api/v1/events/ws");
    expect(socket.url).toContain("clientId=");
    expect(socket.protocols).toEqual([
      "guada.events.v1",
      "bearer.test-token",
    ]);
    service.disconnect();
  });

  it("收到 ready 才算已连接，并触发 onConnected", () => {
    const service = createService();
    const connected = vi.fn();
    service.onConnected(connected);
    service.connect();

    expect(service.isConnected()).toBe(false);
    lastSocket().open();
    expect(service.isConnected()).toBe(false); // 还没 ready
    lastSocket().push({ kind: "ready" });
    expect(service.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledTimes(1);
    service.disconnect();
  });

  it("两个 pane 共享同一订阅，最后一个释放才 unwatch，重连不增加引用数", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    service.watchSession("s1");
    service.watchSession("s1");
    expect(lastSocket().sent.filter((m: any) => m.kind === "watch")).toHaveLength(1);

    expect(service.unwatchSession("s1")).toBe(false);
    expect(lastSocket().sent.some((m: any) => m.kind === "unwatch")).toBe(false);

    service.reconnect("test reconnect");
    lastSocket().ready();
    expect(lastSocket().sent.filter((m: any) => m.kind === "watch")).toEqual([
      { kind: "watch", sessionIds: ["s1"] },
    ]);
    expect(service.unwatchSession("s1")).toBe(true);
    expect(lastSocket().sent.filter((m: any) => m.kind === "unwatch")).toEqual([
      { kind: "unwatch", sessionIds: ["s1"] },
    ]);
    expect(service.unwatchSession("s1")).toBe(false);
    service.disconnect();
  });

  it("不同会话独立计数，释放空会话不发请求", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    service.watchSession("s1");
    service.watchSession("s2");
    expect(service.unwatchSession("")).toBe(false);
    expect(service.unwatchSession("missing")).toBe(false);
    expect(service.unwatchSession("s1")).toBe(true);
    expect(lastSocket().sent.filter((m: any) => m.kind === "unwatch")).toEqual([
      { kind: "unwatch", sessionIds: ["s1"] },
    ]);
    expect(service.unwatchSession("s2")).toBe(true);
    service.disconnect();
  });

  it("watch 在 ready 后重放（重连语义）", () => {
    const service = createService();
    service.watchSession("s1"); // 未连接：只记期望
    service.connect();
    lastSocket().ready();

    expect(
      lastSocket().sent.filter((m: any) => m.kind === "watch"),
    ).toEqual([{ kind: "watch", sessionIds: ["s1"] }]);
    service.disconnect();
  });

  it("stream/* 事件路由到 StreamEventHub；其余按 type 分发", async () => {
    const { streamEventHub } = await import("./StreamEventHub");
    const route = vi.spyOn(streamEventHub, "route").mockImplementation(() => {});
    const service = createService();
    service.connect();
    lastSocket().ready();

    const onUpdated = vi.fn();
    service.on("session_updated", onUpdated);
    lastSocket().push({
      kind: "event",
      data: {
        method: "stream/text_delta",
        payload: { sessionId: "s1", type: "text_delta", text: "a" },
      },
    });
    lastSocket().push({
      kind: "event",
      data: { type: "session_updated", sessionId: "s1", payload: {} },
    });

    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", text: "a" }),
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
    route.mockRestore();
    service.disconnect();
  });

  it("终态帧按 terminalId 入口去重", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    const seen: any[] = [];
    service.on("stream_status_changed", (e) => seen.push(e));

    const terminal = {
      kind: "event",
      data: {
        type: "stream_status_changed",
        sessionId: "s1",
        payload: { status: "completed", terminalId: "tid-1" },
      },
    };
    lastSocket().push(terminal);
    lastSocket().push(terminal);
    expect(seen).toHaveLength(1);
    service.disconnect();
  });

  it("连接关闭后按指数退避重连", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    const first = lastSocket();

    first.close();
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(hoisted.sockets.length).toBe(2);
    service.disconnect();
  });

  it("ready 携带侧栏修订号：首次与重连 meta 正确", () => {
    const service = createService();
    const listener = vi.fn();
    service.onSidebarState(listener);
    service.connect();
    lastSocket().open();
    lastSocket().push({
      kind: "ready",
      connectionId: "c1",
      protocol: "guada.events.v1",
      state: {
        scope: "sidebar",
        bootId: "boot-1",
        revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ bootId: "boot-1", revision: 1 }),
      { reason: "ready", reconnected: false, changed: true },
    );

    lastSocket().close();
    vi.advanceTimersByTime(2_000);
    lastSocket().open();
    lastSocket().push({
      kind: "ready",
      connectionId: "c2",
      protocol: "guada.events.v1",
      state: {
        scope: "sidebar",
        bootId: "boot-1",
        revision: 2,
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    });

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ bootId: "boot-1", revision: 2 }),
      { reason: "ready", reconnected: true, changed: true },
    );
    service.disconnect();
  });

  it("state 推送只在修订号变化时通知", () => {
    const service = createService();
    const listener = vi.fn();
    service.onSidebarState(listener);
    service.connect();
    lastSocket().open();
    lastSocket().push({
      kind: "ready",
      connectionId: "c1",
      protocol: "guada.events.v1",
      state: {
        scope: "sidebar",
        bootId: "boot-1",
        revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    listener.mockClear();

    const frame = {
      kind: "state",
      scope: "sidebar",
      bootId: "boot-1",
      revision: 2,
      updatedAt: "2026-01-01T00:00:01.000Z",
    };
    lastSocket().push(frame);
    lastSocket().push(frame);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
      { reason: "push", reconnected: false, changed: true },
    );
    service.disconnect();
  });

  it("每 60s 发一次 state/ping；隐藏时不发", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    lastSocket().sent.length = 0;

    vi.advanceTimersByTime(60_000);
    expect(lastSocket().sent).toContainEqual({ kind: "state/ping" });

    doc.hidden = true;
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    lastSocket().sent.length = 0;
    vi.advanceTimersByTime(60_000);
    expect(lastSocket().sent).not.toContainEqual({ kind: "state/ping" });
    service.disconnect();
  });

  it("短时间隐藏后回前台补一次 state/ping（不触发重连）", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();
    lastSocket().sent.length = 0;

    doc.hidden = true;
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.hidden = false;
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(hoisted.sockets).toHaveLength(1);
    expect(lastSocket().sent).toContainEqual({ kind: "state/ping" });
    service.disconnect();
  });

  it("页面隐藏超过 15s 后恢复可见 → 重建连接", () => {
    const service = createService();
    service.connect();
    lastSocket().ready();

    doc.hidden = true;
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(20_000);
    doc.hidden = false;
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(hoisted.sockets.length).toBe(2);
    service.disconnect();
  });
});

describe("SessionEventsService（WebSocket）快照等待器", () => {
  function readyService() {
    const service = createService();
    service.connect();
    lastSocket().ready();
    return service;
  }

  it("requestOpen 发送 open；snapshot 帧兑现", async () => {
    const service = readyService();
    const wait = service.requestOpen("s1", {
      requestId: "req-1",
      turns: 15,
    });

    expect(lastSocket().sent).toContainEqual({
      kind: "open",
      requestId: "req-1",
      sessionId: "s1",
      turns: 15,
      beforeSeq: undefined,
    });
    lastSocket().push({
      kind: "snapshot",
      requestId: "req-1",
      payload: { requestId: "req-1", sessionId: "s1", endSeq: 3 },
    });
    await expect(wait).resolves.toMatchObject({ endSeq: 3 });
    service.disconnect();
  });

  it("error 载荷 → reject", async () => {
    const service = readyService();
    const wait = service.requestOpen("s1", { requestId: "req-1" });
    lastSocket().push({
      kind: "snapshot",
      requestId: "req-1",
      payload: { requestId: "req-1", error: "disk boom" },
    });
    await expect(wait).rejects.toThrow("disk boom");
    service.disconnect();
  });

  it("ack ok=false → reject", async () => {
    const service = readyService();
    const wait = service.requestOpen("s1", { requestId: "req-1" });
    lastSocket().push({ kind: "ack", requestId: "req-1", ok: false, reason: "bad" });
    await expect(wait).rejects.toThrow("bad");
    service.disconnect();
  });

  it("超时 → reject", async () => {
    const service = readyService();
    const wait = service.waitForSnapshot("req-1", 1000);
    const assertion = expect(wait).rejects.toThrow("timeout");
    vi.advanceTimersByTime(1000);
    await assertion;
    service.disconnect();
  });

  it("waitUntilConnected：ready 后 resolve", async () => {
    const service = createService();
    service.connect();
    const wait = service.waitUntilConnected(5000);
    lastSocket().ready();
    await expect(wait).resolves.toBeUndefined();
    service.disconnect();
  });

  it("disconnect：拒绝所有等待中的快照", async () => {
    const service = readyService();
    const wait = service.waitForSnapshot("req-1", 1000);
    service.disconnect();
    await expect(wait).rejects.toThrow("disconnected");
  });

  it("workspace 事件只分发给 workspace 监听器", () => {
    const service = readyService();
    const listener = vi.fn();
    service.onWorkspaceEvent(listener);
    lastSocket().push({
      kind: "workspace",
      data: { type: "change", sessionId: "s1", path: "a.ts" },
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.ts" }),
    );
    service.disconnect();
  });
});
