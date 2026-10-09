import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceWatcherService } from "./WorkspaceWatcherService";

/**
 * 工作目录 SSE 客户端的 subscribe-scope 生命周期测试。
 *
 * 背景：后端把 scope 记在「连接」上，SSE 一断开（后端重启、网络抖动、休眠唤醒）
 * 该 clientId 的 scope 就被清空；客户端此前只在会话切换时 POST 一次，重连后
 * 不再重放 → file/git watcher 静默停用，文件变更事件全部丢失。
 */

interface MockEventSourceInstance {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  readyState: number;
  closed: boolean;
  close(): void;
}

const esMock = vi.hoisted(() => {
  class MockEventSource {
    static instances: MockEventSource[] = [];
    static reset() {
      MockEventSource.instances = [];
    }
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    readyState = 1;
    closed = false;
    constructor(url: string) {
      this.url = url;
      MockEventSource.instances.push(this);
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
  }
  return { MockEventSource };
});

vi.mock("event-source-polyfill", () => ({
  EventSourcePolyfill: esMock.MockEventSource,
}));

const MockES = esMock.MockEventSource;

/** 等待 onopen 里 void 掉的异步重放跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WorkspaceWatcherService 订阅范围重放", () => {
  let service: WorkspaceWatcherService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockES.reset();
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    service = new WorkspaceWatcherService(() => "http://api/v1");
  });

  afterEach(() => {
    service.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function lastInstance(): MockEventSourceInstance {
    return MockES.instances[MockES.instances.length - 1] as unknown as MockEventSourceInstance;
  }

  /** POST 到 workspace/watch 的调用参数（排除其他请求） */
  function watchCalls() {
    return fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/workspace/watch"))
      .map(([, init]) => JSON.parse((init as { body: string }).body));
  }

  it("首次连接：onopen 重放已记录的 scope（保证 REST 先于 SSE 也能生效）", async () => {
    await service.setWatchScope("s1", "file", true);
    expect(watchCalls()).toEqual([{ scope: "file", enabled: true }]);

    service.connect("s1");
    lastInstance().onopen?.();
    await flush();

    expect(watchCalls()).toEqual([
      { scope: "file", enabled: true },
      { scope: "file", enabled: true },
    ]);
  });

  it("未订阅过 scope：连接不产生任何 watch 请求", async () => {
    service.connect("s1");
    lastInstance().onopen?.();
    await flush();

    expect(watchCalls()).toEqual([]);
  });

  it("重连（polyfill 放弃连接）：重建连接并重放 scope", async () => {
    vi.useFakeTimers();
    service.connect("s1");
    await service.setWatchScope("s1", "file", true);
    await service.setWatchScope("s1", "git", true);
    const callsBefore = watchCalls().length;

    const failed = lastInstance();
    failed.readyState = 2; // CLOSED：polyfill 已放弃
    failed.onerror?.(new Error("boom"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(MockES.instances).toHaveLength(2);
    const reconnected = lastInstance();
    reconnected.onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(watchCalls().slice(callsBefore)).toEqual([
      { scope: "file", enabled: true },
      { scope: "git", enabled: true },
    ]);
  });

  it("主动 disconnect 后：已放弃的连接不再被复活", async () => {
    vi.useFakeTimers();
    service.connect("s1");
    const stale = lastInstance();
    service.disconnect();

    stale.readyState = 2;
    stale.onerror?.(new Error("boom"));
    await vi.advanceTimersByTimeAsync(10000);

    expect(MockES.instances).toHaveLength(1);
  });

  it("切换会话：旧会话的期望订阅作废，不会在新连接上被重放", async () => {
    service.connect("s1");
    await service.setWatchScope("s1", "file", true);

    service.connect("s2");
    await flush();
    const callsBefore = watchCalls().length;
    lastInstance().onopen?.();
    await flush();

    expect(lastInstance().url).toContain("/sessions/s2/workspace/events");
    expect(watchCalls().length).toBe(callsBefore);
  });

  it("取消订阅后不再重放", async () => {
    service.connect("s1");
    await service.setWatchScope("s1", "file", true);
    await service.setWatchScope("s1", "file", false);
    const callsBefore = watchCalls().length;

    lastInstance().onopen?.();
    await flush();

    expect(watchCalls().length).toBe(callsBefore);
  });
});
