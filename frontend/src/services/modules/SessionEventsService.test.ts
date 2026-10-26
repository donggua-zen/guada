import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 连接监督器测试：只验证「何时重建连接」，不涉及真实网络。
 * event-source-polyfill 用内存 mock 替代。
 */
const hoisted = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock("event-source-polyfill", () => {
  class MockEventSource {
    url: string;
    options: any;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    closed = false;

    constructor(url: string, options: any) {
      this.url = url;
      this.options = options;
      hoisted.instances.push(this);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
    }
  }
  return { EventSourcePolyfill: MockEventSource };
});

import { SessionEventsService } from "./SessionEventsService";

const OPEN = 1;
const CLOSED = 2;

function lastSource() {
  return hoisted.instances[hoisted.instances.length - 1];
}

function openLastSource() {
  const source = lastSource();
  source.readyState = OPEN;
  source.onopen?.();
}

let doc: any;
let win: any;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  hoisted.instances.length = 0;
  doc = new EventTarget() as any;
  doc.hidden = false;
  doc.visibilityState = "visible";
  win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", { getItem: () => "test-token" });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createService() {
  return new SessionEventsService(() => "http://localhost:3000/api/v1");
}

function dispatchVisibility(hidden: boolean) {
  doc.hidden = hidden;
  doc.visibilityState = hidden ? "hidden" : "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
}

describe("SessionEventsService 连接监督", () => {
  it("初始连接创建一个 EventSource", () => {
    const service = createService();
    service.connect();
    expect(hoisted.instances).toHaveLength(1);
    expect(lastSource().url).toContain("/events/sessions");
    service.disconnect();
  });

  it("页面隐藏超过 15s 后恢复可见会重建连接", () => {
    const service = createService();
    service.connect();
    openLastSource();

    dispatchVisibility(true);
    vi.advanceTimersByTime(20_000);
    dispatchVisibility(false);

    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });

  it("短暂切后台（<15s）且连接正常时不重建", () => {
    const service = createService();
    service.connect();
    openLastSource();

    dispatchVisibility(true);
    vi.advanceTimersByTime(5_000);
    dispatchVisibility(false);

    expect(hoisted.instances).toHaveLength(1);
    service.disconnect();
  });

  it("恢复可见时连接已 CLOSED，即使隐藏时间很短也重建", () => {
    const service = createService();
    service.connect();
    openLastSource();
    lastSource().readyState = CLOSED;

    dispatchVisibility(true);
    vi.advanceTimersByTime(2_000);
    dispatchVisibility(false);

    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });

  it("网络恢复（online）时连接 CLOSED 会重建", () => {
    const service = createService();
    service.connect();
    openLastSource();
    lastSource().readyState = CLOSED;

    win.dispatchEvent(new Event("online"));

    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });

  it("watchdog 发现长时间无活动（>150s）会重建", () => {
    const service = createService();
    service.connect();
    openLastSource();

    vi.advanceTimersByTime(151_000);
    // 150s 时正好等于阈值不触发，180s 的巡检触发
    vi.advanceTimersByTime(30_000);

    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });

  it("polyfill CLOSED（如 401）时通知 fatal 并按退避重连", () => {
    const service = createService();
    const fatal = vi.fn();
    service.onConnectionFatal(fatal);
    service.connect();
    openLastSource();

    const source = lastSource();
    source.readyState = CLOSED;
    source.onerror?.(new Error("401"));

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(hoisted.instances).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });

  it("disconnect 后不再因可见性变化重建", () => {
    const service = createService();
    service.connect();
    openLastSource();
    service.disconnect();

    dispatchVisibility(true);
    vi.advanceTimersByTime(20_000);
    dispatchVisibility(false);

    expect(hoisted.instances).toHaveLength(1);
  });

  it("connect 时存在 CONNECTING 的旧连接也会先关闭（避免泄漏）", () => {
    const service = createService();
    service.connect();
    const first = lastSource();
    expect(first.readyState).toBe(0);

    service.connect();
    expect(first.closed).toBe(true);
    expect(hoisted.instances).toHaveLength(2);
    service.disconnect();
  });
});
