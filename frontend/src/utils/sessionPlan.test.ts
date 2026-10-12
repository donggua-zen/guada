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

import { refreshSessionPlans, pickPlanDraft } from "./sessionPlan";

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

// ── 生成中的计划草稿 ──
// 面板读的持久化列表来自后端对**已落库转录**的解析，ExitPlanMode 的参数要等 LLM 流结束才落库，
// 所以"正文正在写"这段只能靠消息树里的半截 args 供面板展示。pickPlanDraft 是这条链路的选源规则：
// 挑错了要么生成中看不到，要么和落库后的条目重复。
describe("pickPlanDraft 选源", () => {
  const planTool = (over: Record<string, unknown> = {}) => ({
    id: "call_1",
    name: "ExitPlanMode",
    // 流式中：JSON 只写了一半
    arguments: '{"plan":"# 标题\\n正文第一段',
    ...over,
  });

  it("流式半截 args：能解析出半截正文，且标记 streaming", () => {
    const draft = pickPlanDraft([planTool()], new Set());
    expect(draft?.planId).toBe("call_1");
    expect(draft?.content).toBe("# 标题\n正文第一段");
    expect(draft?.streaming).toBe(true);
    // 执行中没有终态 → 不出徽标
    expect(draft?.status).toBeUndefined();
  });

  it("args 写完（严格 JSON 可解析）：streaming 为 false，正文取完整值", () => {
    const draft = pickPlanDraft(
      [planTool({ arguments: '{"plan":"# 标题\\n正文"}' })],
      new Set(),
    );
    expect(draft?.content).toBe("# 标题\n正文");
    expect(draft?.streaming).toBe(false);
  });

  it("planId 已进持久化列表 → 让位（不产生重复条目，交接不闪空）", () => {
    expect(pickPlanDraft([planTool()], new Set(["call_1"]))).toBeUndefined();
  });

  it("args 里还没有 plan 字段 → 无可看内容，不选它", () => {
    expect(pickPlanDraft([planTool({ arguments: '{"pl' })], new Set())).toBeUndefined();
  });

  it("计划正文为空串 → 不选它", () => {
    expect(
      pickPlanDraft([planTool({ arguments: '{"plan":""}' })], new Set()),
    ).toBeUndefined();
  });

  it("缺 toolCallId → 不选它（没有身份无法与落库条目对接）", () => {
    expect(pickPlanDraft([planTool({ id: undefined })], new Set())).toBeUndefined();
  });

  it("多条命中取最后一条（最新）", () => {
    const draft = pickPlanDraft(
      [
        planTool({ id: "call_old", arguments: '{"plan":"旧"}' }),
        planTool({ id: "call_new", arguments: '{"plan":"新"}' }),
      ],
      new Set(),
    );
    expect(draft?.planId).toBe("call_new");
    expect(draft?.content).toBe("新");
  });

  it("非 plan 渲染器的工具调用被忽略", () => {
    const draft = pickPlanDraft(
      [{ id: "call_sh", name: "run_command", arguments: '{"command":"ls"}' }],
      new Set(),
    );
    expect(draft).toBeUndefined();
  });

  it("工具已中断：带出 aborted 徽标", () => {
    const draft = pickPlanDraft([planTool({ outcome: "aborted" })], new Set());
    expect(draft?.status).toBe("aborted");
  });
});
