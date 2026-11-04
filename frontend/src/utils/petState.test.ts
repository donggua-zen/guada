import { describe, expect, it } from "vitest";
import { buildPetBubble, derivePetMode, PET_YAWN_IDLE_MS } from "./petState";

describe("derivePetMode", () => {
  const idle = 0;

  it("无任务无未读 → idle", () => {
    expect(derivePetMode({ running: 0, unread: 0, idleMs: idle })).toBe("idle");
  });

  it("1 个任务 → walk", () => {
    expect(derivePetMode({ running: 1, unread: 0, idleMs: idle })).toBe("walk");
  });

  it("2 个及以上任务 → run", () => {
    expect(derivePetMode({ running: 2, unread: 0, idleMs: idle })).toBe("run");
    expect(derivePetMode({ running: 5, unread: 3, idleMs: idle })).toBe("run");
  });

  it("有未读但无任务 → 仍是 idle（不装睡打哈欠）", () => {
    expect(
      derivePetMode({ running: 0, unread: 2, idleMs: PET_YAWN_IDLE_MS * 3 }),
    ).toBe("idle");
  });

  it("空闲时长阈值：刚好等于阈值打哈欠，差 1ms 不打", () => {
    expect(derivePetMode({ running: 0, unread: 0, idleMs: PET_YAWN_IDLE_MS - 1 })).toBe("idle");
    expect(derivePetMode({ running: 0, unread: 0, idleMs: PET_YAWN_IDLE_MS })).toBe("yawn");
  });

  it("任务数优先于长空闲", () => {
    expect(
      derivePetMode({ running: 1, unread: 0, idleMs: PET_YAWN_IDLE_MS * 10 }),
    ).toBe("walk");
  });

  it("异常输入（负数/NaN）按 0 处理", () => {
    expect(derivePetMode({ running: -3, unread: -1, idleMs: 0 })).toBe("idle");
    expect(
      derivePetMode({ running: Number.NaN, unread: Number.NaN, idleMs: 0 }),
    ).toBe("idle");
  });
});

describe("buildPetBubble", () => {
  it("无任务无未读 → null（气泡收起）", () => {
    expect(buildPetBubble({ running: 0, unread: 0 })).toBeNull();
  });

  it("有任务：展示标题 + 工具名", () => {
    expect(
      buildPetBubble({ running: 1, unread: 0, title: "重构登录模块", toolLabel: "edit" }),
    ).toEqual({ text: "重构登录模块", sub: "正在执行 · edit", tone: "busy" });
  });

  it("有任务但标题缺失 → 回退到计数文案", () => {
    expect(buildPetBubble({ running: 2, unread: 0 })).toEqual({
      text: "2 个会话运行中",
      sub: "正在执行 · 工具调用",
      tone: "busy",
    });
  });

  it("有任务但工具名缺失 → 回退到「工具调用」", () => {
    expect(buildPetBubble({ running: 1, unread: 0, title: "写文档" })).toEqual({
      text: "写文档",
      sub: "正在执行 · 工具调用",
      tone: "busy",
    });
  });

  it("标题空白串按缺失处理", () => {
    expect(buildPetBubble({ running: 1, unread: 0, title: "   " })?.text).toBe(
      "1 个会话运行中",
    );
  });

  it("仅未读：提示未读会话数", () => {
    expect(buildPetBubble({ running: 0, unread: 3 })).toEqual({
      text: "3 个会话有未读消息",
      sub: "点击打开最近会话",
      tone: "idle",
    });
  });

  it("任务优先于未读", () => {
    expect(
      buildPetBubble({ running: 1, unread: 5, title: "跑测试" })?.tone,
    ).toBe("busy");
  });
});
