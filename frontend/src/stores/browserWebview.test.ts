import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useBrowserWebviewStore } from "./browserWebview";

/**
 * browserWebview 渲染视口测试
 *
 * 约束：
 * - 默认固定视口：未覆盖网页使用全局默认尺寸
 * - 自适应视口：布局盒跟随预览面板最近一次有效尺寸
 * - 面板隐藏（0×0 / null）时冻结最后一次有效尺寸，避免后台页面被压成 0
 * - 覆盖优先级：网页覆盖 > 全局默认；固定尺寸覆盖在全局自适应下不能被误删
 */

const WID = "w1";

function addWindow(store: ReturnType<typeof useBrowserWebviewStore>, id = WID): void {
  store.addWebview({
    windowId: id,
    url: "about:blank",
    title: "t",
    partition: "p",
    preloadUrl: "preload",
    isVisible: false,
  });
}

describe("browserWebview viewport", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("固定模式：未覆盖时使用全局默认尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);

    expect(store.getViewportMode(WID)).toBe("fixed");
    expect(store.getViewportSize(WID)).toEqual({ width: 1280, height: 720 });

    store.setViewportSize(1366, 768);
    expect(store.getViewportSize(WID)).toEqual({ width: 1366, height: 768 });
  });

  it("自适应覆盖：跟随最近一次有效面板尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);
    store.setWebviewAdaptive(WID, true);

    expect(store.getViewportMode(WID)).toBe("adaptive");
    // 尚未测量：退回全局固定尺寸
    expect(store.getViewportSize(WID)).toEqual({ width: 1280, height: 720 });

    store.setPreviewRect({ x: 0, y: 0, width: 823.6, height: 1147.2 });
    expect(store.getViewportSize(WID)).toEqual({ width: 824, height: 1147 });
  });

  it("自适应后台页冻结在最后一次前台尺寸，重新激活后跟随当前面板", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "a");
    addWindow(store, "b");
    store.setWebviewAdaptive("a", true);
    store.setWebviewAdaptive("b", true);

    store.setActive("a");
    store.setPreviewRect({ x: 0, y: 0, width: 900, height: 1000 });
    expect(store.getViewportSize("a")).toEqual({ width: 900, height: 1000 });

    // 切到 b 并缩放面板：b 跟随新尺寸，a 冻结在 900×1000
    store.setActive("b");
    store.setPreviewRect({ x: 0, y: 0, width: 700, height: 800 });
    expect(store.getViewportSize("b")).toEqual({ width: 700, height: 800 });
    expect(store.getViewportSize("a")).toEqual({ width: 900, height: 1000 });

    // 切回 a：立即应用当前面板尺寸
    store.setActive("a");
    expect(store.getViewportSize("a")).toEqual({ width: 700, height: 800 });
  });

  it("从未激活过的自适应后台页：退回当前面板尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "a");
    addWindow(store, "b");
    store.setWebviewAdaptive("b", true);

    store.setActive("a");
    store.setPreviewRect({ x: 0, y: 0, width: 700, height: 800 });

    expect(store.getViewportSize("b")).toEqual({ width: 700, height: 800 });
  });

  it("面板隐藏时后台自适应页保持冻结尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "a");
    addWindow(store, "b");
    store.setWebviewAdaptive("a", true);
    store.setWebviewAdaptive("b", true);

    store.setActive("a");
    store.setPreviewRect({ x: 0, y: 0, width: 900, height: 1000 });
    store.setActive("b");
    store.setPreviewRect({ x: 0, y: 0, width: 0, height: 0 });
    store.setPreviewRect(null);

    expect(store.getViewportSize("a")).toEqual({ width: 900, height: 1000 });
    expect(store.getViewportSize("b")).toEqual({ width: 900, height: 1000 });
  });

  it("固定覆盖在后台不受冻结逻辑影响", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "a");
    addWindow(store, "b");
    store.setWebviewViewport("a", 1920, 1080);

    store.setActive("a");
    store.setPreviewRect({ x: 0, y: 0, width: 900, height: 1000 });
    store.setActive("b");
    store.setPreviewRect({ x: 0, y: 0, width: 700, height: 800 });

    expect(store.getViewportSize("a")).toEqual({ width: 1920, height: 1080 });
  });

  it("面板隐藏（0×0 / null）时冻结最后一次有效尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);
    store.setWebviewAdaptive(WID, true);

    store.setPreviewRect({ x: 0, y: 0, width: 900, height: 1000 });
    store.setPreviewRect({ x: 0, y: 0, width: 0, height: 0 });
    expect(store.getViewportSize(WID)).toEqual({ width: 900, height: 1000 });

    store.setPreviewRect(null);
    expect(store.getViewportSize(WID)).toEqual({ width: 900, height: 1000 });
  });

  it("全局自适应：未覆盖网页跟随面板，固定覆盖优先", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);
    addWindow(store, "w2");

    store.setViewportAdaptive(true);
    store.setPreviewRect({ x: 0, y: 0, width: 700, height: 800 });

    expect(store.getViewportMode(WID)).toBe("adaptive");
    expect(store.getViewportSize(WID)).toEqual({ width: 700, height: 800 });

    // 全局自适应时，尺寸即使等于固定默认值也必须落成固定覆盖
    store.setWebviewViewport(WID, 1280, 720);
    expect(store.getViewportMode(WID)).toBe("fixed");
    expect(store.getViewportSize(WID)).toEqual({ width: 1280, height: 720 });

    // 另一个网页仍跟随全局自适应
    expect(store.getViewportMode("w2")).toBe("adaptive");
    expect(store.getViewportSize("w2")).toEqual({ width: 700, height: 800 });
  });

  it("固定模式下与全局默认一致的覆盖保持“跟随默认”语义", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);

    store.setWebviewViewport(WID, 1280, 720);
    expect(store.viewportOverrides.has(WID)).toBe(false);
    expect(store.getViewportMode(WID)).toBe("fixed");
  });

  it("AI 显式设置视口：即使等于全局默认也保留覆盖", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);

    store.setWebviewViewportExact(WID, 1280, 720);
    expect(store.viewportOverrides.get(WID)).toEqual({ width: 1280, height: 720 });

    // 全局默认变化后该页仍保持显式尺寸
    store.setViewportSize(1920, 1080);
    expect(store.getViewportSize(WID)).toEqual({ width: 1280, height: 720 });
  });

  it("自适应切回固定：写入全局固定尺寸覆盖", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);

    store.setViewportAdaptive(true);
    store.setWebviewAdaptive(WID, false);

    expect(store.getViewportMode(WID)).toBe("fixed");
    expect(store.viewportOverrides.get(WID)).toEqual({ width: 1280, height: 720 });
  });

  it("关闭网页时清理自适应覆盖与冻结尺寸", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);
    store.setWebviewAdaptive(WID, true);
    store.setActive(WID);
    store.setPreviewRect({ x: 0, y: 0, width: 900, height: 1000 });

    expect(store.viewportOverrides.has(WID)).toBe(true);
    expect(store.frozenAdaptiveSizes.has(WID)).toBe(true);
    store.removeWebview(WID);
    expect(store.viewportOverrides.has(WID)).toBe(false);
    expect(store.frozenAdaptiveSizes.has(WID)).toBe(false);
  });

  it("clearAll 清理冻结表但保留最近面板尺寸（后台自适应页面不跳变）", () => {
    const store = useBrowserWebviewStore();
    addWindow(store);
    store.setWebviewAdaptive(WID, true);
    store.setActive(WID);
    store.setPreviewRect({ x: 0, y: 0, width: 800, height: 900 });

    store.clearAll();
    expect(store.frozenAdaptiveSizes.size).toBe(0);
    expect(store.lastAdaptiveSize).toEqual({ width: 800, height: 900 });
  });
});
