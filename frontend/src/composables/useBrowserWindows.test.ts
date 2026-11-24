/**
 * useBrowserWindows 测试（输入区状态胶囊的「浏览器窗口」段数据）
 *
 * 覆盖：按会话过滤、窗口增删后的重算、会话切换、激活窗口（开工作区 + 选标签）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";

const layoutMocks = vi.hoisted(() => ({ setWorkspaceVisible: vi.fn() }));
vi.mock("@/stores/layout", () => ({ useLayoutStore: () => layoutMocks }));
const tabMocks = vi.hoisted(() => ({ selectTab: vi.fn() }));
vi.mock("@/stores/tab", () => ({ useTabStore: () => tabMocks }));

import { useBrowserWebviewStore } from "@/stores/browserWebview";
import { useBrowserWindows } from "./useBrowserWindows";

function addWindow(
  store: ReturnType<typeof useBrowserWebviewStore>,
  id: string,
  sessionId: string,
  title = id,
): void {
  store.addWebview({
    windowId: id,
    url: "about:blank",
    title,
    partition: "p",
    preloadUrl: "preload",
    isVisible: false,
    metadata: { sessionId },
  });
}

describe("useBrowserWindows", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    layoutMocks.setWorkspaceVisible.mockReset();
    tabMocks.selectTab.mockReset();
  });

  it("只列当前会话的窗口；窗口增删后列表重算", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1", "A");
    addWindow(store, "win_2", "s2", "B");

    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(() => "s1"))!;
    expect(api.windows.value.map((w) => w.windowId)).toEqual(["win_1"]);

    addWindow(store, "win_3", "s1", "C");
    expect(api.windows.value.map((w) => w.windowId)).toEqual(["win_1", "win_3"]);

    store.removeWebview("win_1");
    expect(api.windows.value.map((w) => w.windowId)).toEqual(["win_3"]);

    scope.stop();
  });

  it("切换会话后重算；undefined 时为空", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1");
    addWindow(store, "win_2", "s2");

    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(sid))!;
    expect(api.windows.value.map((w) => w.windowId)).toEqual(["win_1"]);

    sid.value = "s2";
    expect(api.windows.value.map((w) => w.windowId)).toEqual(["win_2"]);

    sid.value = undefined;
    expect(api.windows.value).toEqual([]);

    scope.stop();
  });

  it("activate：先开工作区，nextTick 后选中浏览器标签", async () => {
    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(() => "s1"))!;

    api.activate("win_1");
    expect(layoutMocks.setWorkspaceVisible).toHaveBeenCalledWith(true);
    expect(tabMocks.selectTab).not.toHaveBeenCalled();

    await nextTick();
    expect(tabMocks.selectTab).toHaveBeenCalledWith("browser:win_1");

    scope.stop();
  });
});
