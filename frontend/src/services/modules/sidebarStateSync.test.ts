import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SidebarStateChangeMeta,
  SidebarStateSnapshot,
} from "./SessionEventsService";
import { SidebarStateSync } from "./sidebarStateSync";

function stateFromKey(key: string): SidebarStateSnapshot {
  const [bootId, revision] = key.split(":");
  return {
    scope: "sidebar",
    bootId,
    revision: Number(revision),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createHarness() {
  let key: string | null = "boot-1:1";
  let visible = true;
  const listeners = new Set<
    (state: SidebarStateSnapshot, meta: SidebarStateChangeMeta) => void
  >();
  const refresh = vi.fn(async () => true);
  const ping = vi.fn();
  const sync = new SidebarStateSync({
    getStateKey: () => key,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ping,
    refresh,
    isVisible: () => visible,
  });

  return {
    sync,
    refresh,
    ping,
    setKey(next: string | null) {
      key = next;
    },
    setVisible(next: boolean) {
      visible = next;
    },
    push(
      nextKey: string | null,
      meta: SidebarStateChangeMeta = {
        reason: "push",
        reconnected: false,
        changed: true,
      },
    ) {
      key = nextKey;
      if (!nextKey) return;
      for (const listener of listeners) {
        listener(stateFromKey(nextKey), meta);
      }
    },
  };
}

describe("SidebarStateSync", () => {
  let doc: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new EventTarget();
    vi.stubGlobal("document", doc);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("修订号未变不刷新；变化后防抖合并为一次", async () => {
    const h = createHarness();
    h.sync.start();
    h.sync.markApplied();

    h.push("boot-1:1");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).not.toHaveBeenCalled();

    h.push("boot-1:2");
    h.push("boot-1:3");
    expect(h.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.sync.stop();
  });

  it("重连时即使修订号相同也强制刷新一次", async () => {
    const h = createHarness();
    h.sync.start();
    h.sync.markApplied();

    h.push("boot-1:1", {
      reason: "ready",
      reconnected: true,
      changed: false,
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.sync.stop();
  });

  it("页面隐藏时挂起，恢复可见后刷新", async () => {
    const h = createHarness();
    h.sync.start();
    h.sync.markApplied();
    h.setVisible(false);

    h.push("boot-1:2");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.refresh).not.toHaveBeenCalled();

    h.setVisible(true);
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ping).toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.sync.stop();
  });

  it("单飞 + trailing：刷新期间的新修订号结束后补跑一次", async () => {
    const h = createHarness();
    let resolveFirst: (applied: boolean) => void = () => {};
    h.refresh.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    h.sync.start();
    h.sync.markApplied();

    h.push("boot-1:2");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    h.push("boot-1:3");
    resolveFirst(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.sync.stop();
  });

  it("失败按退避重试，成功后停止", async () => {
    const h = createHarness();
    h.refresh
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(true);
    h.sync.start();
    h.sync.markApplied();

    h.push("boot-1:2");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.sync.stop();
  });

  it("refresh 返回 false（忙）时 1s 后强制重试", async () => {
    const h = createHarness();
    h.refresh.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    h.sync.start();
    h.sync.markApplied();

    h.push("boot-1:2");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.sync.stop();
  });

  it("markApplied 时修订号已经变新：立即排一次对账", async () => {
    const h = createHarness();
    h.sync.start();
    h.setKey("boot-1:5");
    h.sync.markApplied("boot-1:4");

    await vi.advanceTimersByTimeAsync(400);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.sync.stop();
  });

  it("stop 清理等待中的定时器", async () => {
    const h = createHarness();
    h.sync.start();
    h.sync.markApplied();
    h.push("boot-1:2");
    h.sync.stop();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
