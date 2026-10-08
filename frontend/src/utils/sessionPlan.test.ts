/**
 * sessionPlan 计划列表刷新的在途合并测试
 *
 * 背景：批准计划时 plan_mode_changed 与 turn_end 会在同一回合各触发一次 refreshSessionPlans
 *（多窗口同时收到同一帧同理）。同会话在途请求必须合并成一次 HTTP，否则一帧内重复打接口。
 *
 * 未覆盖：**不同会话**的并发调用（两者应各自打一次）。实现上它们是各自的 Map 条目、
 * 互不影响，但这条断言在本仓库的测试环境里测不了——refreshSessionPlans 内部是动态
 * `import('@/services/ApiService')`，而 Vitest 的 mock 运行时下"两个同时进行的动态 import
 * 同一 specifier"会让其中一个 reject（实测抛环境侧的 localStorage TypeError），
 * 被实现里的静默 catch 吞掉，于是那个会话表现为"没打接口"。
 * 真实运行时浏览器的模块缓存对这种并发是天然去重的，不存在该问题。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { fetchSessionPlans } = vi.hoisted(() => ({ fetchSessionPlans: vi.fn() }));
vi.mock("@/services/ApiService", () => ({
  apiService: { fetchSessionPlans: (sid: string) => fetchSessionPlans(sid) },
}));

import { refreshSessionPlans } from "./sessionPlan";

describe("refreshSessionPlans 在途合并", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchSessionPlans.mockReset();
  });

  it("同会话并发调用只打一次接口，且共享同一结果", async () => {
    fetchSessionPlans.mockResolvedValue({ plans: [{ planId: "p1" }] });
    const [a, b] = await Promise.all([
      refreshSessionPlans("s1"),
      refreshSessionPlans("s1"),
    ]);
    expect(fetchSessionPlans).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ planId: "p1" }]);
    expect(b).toEqual(a);
  });

  it("请求落地后解锁：后续调用会重新拉取", async () => {
    fetchSessionPlans.mockResolvedValue({ plans: [] });
    await refreshSessionPlans("s1");
    await refreshSessionPlans("s1");
    expect(fetchSessionPlans).toHaveBeenCalledTimes(2);
  });

  it("失败静默返回 undefined，且不阻塞下一次刷新", async () => {
    fetchSessionPlans.mockRejectedValue(new Error("boom"));
    await expect(refreshSessionPlans("s1")).resolves.toBeUndefined();
    fetchSessionPlans.mockResolvedValue({ plans: [] });
    await expect(refreshSessionPlans("s1")).resolves.toEqual([]);
    expect(fetchSessionPlans).toHaveBeenCalledTimes(2);
  });

  it("空 sessionId 直接返回 undefined，不打接口", async () => {
    await expect(refreshSessionPlans("")).resolves.toBeUndefined();
    expect(fetchSessionPlans).not.toHaveBeenCalled();
  });
});
