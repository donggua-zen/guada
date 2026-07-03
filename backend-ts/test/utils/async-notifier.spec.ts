import { AsyncNotifier } from "../../src/common/utils/async-notifier";

describe("AsyncNotifier", () => {
  let notifier: AsyncNotifier;

  beforeEach(() => {
    notifier = new AsyncNotifier();
  });

  // ==================== wait / notify 基础 ====================

  it("wait 返回 true 当被 notify 唤醒", async () => {
    setTimeout(() => notifier.notify("k"), 10);
    const result = await notifier.wait("k", 5000);
    expect(result).toBe(true);
  });

  it("wait 返回 false 当超时", async () => {
    const result = await notifier.wait("k", 50);
    expect(result).toBe(false);
  });

  it("wait(..,0) 不等待立即返回 false", async () => {
    const result = await notifier.wait("k", 0);
    expect(result).toBe(false);
  });

  it("notify 多次不抛异常", () => {
    notifier.notify("k"); // 没有等待者
    notifier.notify("k"); // 再次
    expect(true).toBe(true); // 不应抛异常
  });

  // ==================== hasWaiters ====================

  it("hasWaiters 返回 false 当没有等待者", () => {
    expect(notifier.hasWaiters("k")).toBe(false);
  });

  it("hasWaiters 返回 true 当有等待者", () => {
    notifier.wait("k", 5000); // 不 await
    expect(notifier.hasWaiters("k")).toBe(true);
  });

  it("hasWaiters 返回 false 当等待者被 notify 后", async () => {
    notifier.wait("k", 5000);
    notifier.notify("k");
    // 微任务让 Promise 消化
    await new Promise((r) => setImmediate(r));
    expect(notifier.hasWaiters("k")).toBe(false);
  });

  it("hasWaiters 返回 false 当等待者超时后", async () => {
    await notifier.wait("k", 10);
    expect(notifier.hasWaiters("k")).toBe(false);
  });

  // ==================== 多等待者 ====================

  it("notify 唤醒所有等待者（多个 wait 同一个 key）", async () => {
    const p1 = notifier.wait("k", 5000);
    const p2 = notifier.wait("k", 5000);
    notifier.notify("k");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it("不同 key 互不干扰", async () => {
    const resultA = notifier.wait("a", 5000);
    notifier.notify("a");
    const resultB = await notifier.wait("b", 10);
    await expect(resultA).resolves.toBe(true);
    expect(resultB).toBe(false);
  });

  // ==================== 超时后 notify 不生效 ====================

  it("超时后再 notify 不影响已超时的等待者", async () => {
    await notifier.wait("k", 10);
    // 等待者已超时，hasWaiters 应为 false
    expect(notifier.hasWaiters("k")).toBe(false);
    // notify 不抛异常
    notifier.notify("k");
  });
});
