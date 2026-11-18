import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { effectScope, nextTick, ref } from "vue";
import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { useBrowserSessionBinding } from "./useBrowserSessionBinding";

/**
 * useBrowserSessionBinding
 *
 * 约束：
 * - 必须 immediate：ChatPage 重挂载时 mainSession 首帧就非空，非 immediate 的 watch
 *   等不到「变化」→ currentSessionId 永久为 null → 侧栏浏览器标签永不出现
 *   （回归自「AI 打开了网页、侧栏没有标签，切会话才出现」）
 * - 只跟随会话 id：会话对象被 mergeSession 就地更新/替换（id 不变）时不能重置
 *   activeWindowId / previewRect，否则每次 session_updated 都闪一下预览
 * - 作用域销毁（= 组件卸载）等价于「不再有正在看的会话」
 */

function addWindow(
  store: ReturnType<typeof useBrowserWebviewStore>,
  id: string,
  sessionId: string,
): void {
  store.addWebview({
    windowId: id,
    url: "about:blank",
    title: "t",
    partition: "p",
    preloadUrl: "preload",
    isVisible: false,
    metadata: { sessionId },
  });
}

describe("useBrowserSessionBinding", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("首帧即有会话 id：同步绑定（ChatPage 重挂载的最小回归）", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");
    // 前置：未绑定会话时（= 重挂载前的 null 状态）标签投影恒空，但窗口本身在
    expect(store.currentSessionId).toBeNull();
    expect(store.sessionWebviews).toHaveLength(0);

    const scope = effectScope();
    scope.run(() => useBrowserSessionBinding(() => "s1"));

    // 不需要任何 id 变化事件，绑定当帧即生效
    expect(store.currentSessionId).toBe("s1");
    expect(store.sessionWebviews.map((w) => w.windowId)).toEqual(["win_1"]);

    scope.stop();
  });

  it("会话 id 变化：跟随切换，列表按新会话重算", async () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");
    addWindow(store, "win_2", "s2");

    const sid = ref<string | null>("s1");
    const scope = effectScope();
    scope.run(() => useBrowserSessionBinding(sid));

    expect(store.sessionWebviews.map((w) => w.windowId)).toEqual(["win_1"]);

    sid.value = "s2";
    // 非 immediate 分支走默认 flush:'pre'，需等一个 tick 才落到 store
    await nextTick();
    expect(store.currentSessionId).toBe("s2");
    expect(store.sessionWebviews.map((w) => w.windowId)).toEqual(["win_2"]);

    scope.stop();
  });

  it("null / undefined（新建会话页）：不抛错且列表为空", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");

    expect(() => {
      const scope = effectScope();
      scope.run(() => useBrowserSessionBinding(() => undefined));
      expect(store.currentSessionId).toBeNull();
      expect(store.sessionWebviews).toHaveLength(0);
      scope.stop();
    }).not.toThrow();
  });

  it("只跟随会话 id：对象替换但 id 不变时不重置预览态", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");

    const session = ref<{ id: string; title: string } | null>({ id: "s1", title: "A" });
    const scope = effectScope();
    scope.run(() => useBrowserSessionBinding(() => session.value?.id));

    // 模拟打开预览：有活跃窗口 + 占位坐标
    store.setActive("win_1");
    store.setPreviewRect({ x: 10, y: 20, width: 800, height: 600 });
    expect(store.activeWindowId).toBe("win_1");

    // mergeSession 式的就地替换：id 不变，标题变了
    session.value = { id: "s1", title: "A (renamed)" };

    expect(store.activeWindowId).toBe("win_1");
    expect(store.previewRect).toEqual({ x: 10, y: 20, width: 800, height: 600 });

    scope.stop();
  });

  it("作用域销毁（组件卸载）：清空当前会话标记", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");

    const scope = effectScope();
    scope.run(() => useBrowserSessionBinding(() => "s1"));
    expect(store.currentSessionId).toBe("s1");

    scope.stop();
    expect(store.currentSessionId).toBeNull();
    expect(store.sessionWebviews).toHaveLength(0);
  });
});
