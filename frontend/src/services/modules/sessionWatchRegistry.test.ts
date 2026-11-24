import { describe, it, expect, vi } from "vitest";
import { SessionWatchRegistry } from "./sessionWatchRegistry";

/**
 * watch 引用计数：多 pane 同时打开同一会话时，最后一个才真正 unwatch。
 */
describe("SessionWatchRegistry", () => {
  it("同一会话多次 acquire 只 watch 一次；最后一个 release 才 unwatch", () => {
    const watch = vi.fn();
    const unwatch = vi.fn();
    const registry = new SessionWatchRegistry(watch, unwatch);

    registry.acquire("s1");
    registry.acquire("s1");
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith("s1");
    expect(registry.size()).toBe(1);

    registry.release("s1");
    expect(unwatch).not.toHaveBeenCalled();

    registry.release("s1");
    expect(unwatch).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it("空会话与多余 release 是 no-op", () => {
    const watch = vi.fn();
    const unwatch = vi.fn();
    const registry = new SessionWatchRegistry(watch, unwatch);

    registry.acquire(null);
    registry.acquire(undefined);
    registry.release("missing");

    expect(watch).not.toHaveBeenCalled();
    expect(unwatch).not.toHaveBeenCalled();
  });

  it("不同会话独立计数", () => {
    const watch = vi.fn();
    const unwatch = vi.fn();
    const registry = new SessionWatchRegistry(watch, unwatch);

    registry.acquire("s1");
    registry.acquire("s2");
    registry.release("s1");

    expect(watch.mock.calls.map((c) => c[0])).toEqual(["s1", "s2"]);
    expect(unwatch.mock.calls.map((c) => c[0])).toEqual(["s1"]);
  });
});
