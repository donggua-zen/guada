/**
 * useThrottledValue 测试
 *
 * 语义契约（第三条最关键）：
 * - 首值立即落地（不等一个窗口）
 * - 窗口内最多落地一次，取该窗口内的**最新**值
 * - 值一定收敛：窗口结束后展示值等于 source 的最终值，不会停在中间某一笔
 *   ——流式正文若丢尾值，屏幕上会一直少最后一段
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope, ref, nextTick, watch, type EffectScope } from "vue";
import { useThrottledValue } from "./useThrottledValue";

const INTERVAL = 300;

describe("useThrottledValue", () => {
  let scope: EffectScope;
  beforeEach(() => {
    vi.useFakeTimers();
    scope = effectScope();
  });
  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  /** 在 effectScope 里建实例：VueUse 的清理钩子需要活跃作用域 */
  function setup(initial: string, intervalMs = INTERVAL) {
    const source = ref(initial);
    const shown = scope.run(() => useThrottledValue(() => source.value, intervalMs));
    if (!shown) throw new Error("scope.run returned undefined");
    /** 落地次数 = 展示值变更次数，也就是"重渲染次数" */
    let commits = 0;
    watch(shown, () => {
      commits += 1;
    });
    const set = async (value: string) => {
      source.value = value;
      await nextTick(); // watch 默认 flush: 'pre'
    };
    const advance = async (ms = INTERVAL) => {
      vi.advanceTimersByTime(ms);
      await nextTick();
    };
    return { source, shown, set, advance, commits: () => commits };
  }

  it("以 source 的当前值初始化，不产生落地", () => {
    const { shown, commits } = setup("初始内容");
    expect(shown.value).toBe("初始内容");
    expect(commits()).toBe(0);
  });

  it("首次变化立即落地（leading 边）", async () => {
    const { shown, set } = setup("");
    await set("第一段");
    expect(shown.value).toBe("第一段");
  });

  it("窗口内的连续变化被合并，窗口结束时落到最新那笔", async () => {
    const { shown, set, advance, commits } = setup("");
    await set("A"); // leading → 立即
    await set("B");
    await set("C");
    await set("D");
    expect(shown.value).toBe("A"); // B~D 仍在窗口内，不逐笔落地
    expect(commits()).toBe(1);

    await advance();
    expect(shown.value).toBe("D"); // 尾值落到最新，而不是 B/C
    expect(commits()).toBe(2);
  });

  it("持续增长时节流：落地次数远小于写入次数", async () => {
    const { shown, set, advance, commits } = setup("");
    // 每 100ms 一笔、共 10 笔（1 秒），窗口 300ms
    for (let i = 1; i <= 10; i++) {
      await set(`第${i}段`);
      await advance(100);
    }
    await advance(); // 收尾：让最后一笔落地
    expect(shown.value).toBe("第10段");
    // 1 秒 / 300ms ≈ 4 个窗口，落地次数不该接近 10
    expect(commits()).toBeLessThanOrEqual(5);
  });

  it("静止后不再有额外落地", async () => {
    const { shown, set, advance, commits } = setup("");
    await set("A");
    await set("B");
    await advance();
    const settled = commits();
    expect(shown.value).toBe("B");

    await advance(INTERVAL * 5);
    expect(shown.value).toBe("B");
    expect(commits()).toBe(settled);
  });

  it("安静期之后的新变化在一个窗口内落地", async () => {
    const { shown, set, advance } = setup("");
    await set("A");
    await advance();
    await advance(INTERVAL * 3); // 静置

    await set("B");
    await advance();
    expect(shown.value).toBe("B");
  });

  it("作用域销毁后不再落地（内部定时器已随作用域清理）", async () => {
    const { source, shown } = setup("");
    const stop = watch(shown, () => {});
    scope.stop();

    source.value = "销毁后写入";
    await nextTick();
    vi.advanceTimersByTime(INTERVAL * 2);
    await nextTick();
    expect(shown.value).toBe("");
    stop();
  });
});
