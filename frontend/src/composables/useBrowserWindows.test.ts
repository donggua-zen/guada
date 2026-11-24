/**
 * useBrowserWindows 测试（输入区状态胶囊的「浏览器窗口」段数据）
 *
 * 覆盖：按会话过滤、会话切换、激活窗口（开工作区 + 选标签）、
 * 新建窗口（metadata / 成功选中 / 会话切走不误选 / 无 Electron 不调用 / 异常不抛）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("只列当前会话的窗口；切换会话后重算", () => {
    const store = useBrowserWebviewStore();
    addWindow(store, "win_1", "s1", "A");
    addWindow(store, "win_2", "s2", "B");

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

  it("create：传 sessionId/createdBy，成功后开工作区并选中新窗口", async () => {
    const createBrowserWindow = vi.fn().mockResolvedValue({
      success: true,
      window: { windowId: "win_new" },
    });
    vi.stubGlobal("window", { electronAPI: { createBrowserWindow } });

    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(() => "s1"))!;
    expect(api.canCreate.value).toBe(true);

    await api.create();
    expect(createBrowserWindow).toHaveBeenCalledWith("about:blank", {
      sessionId: "s1",
      createdBy: "s1",
    });
    expect(layoutMocks.setWorkspaceVisible).toHaveBeenCalledWith(true);

    await nextTick();
    expect(tabMocks.selectTab).toHaveBeenCalledWith("browser:win_new");

    scope.stop();
  });

  it("create：await 期间切走会话则不选中旧窗口", async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    const createBrowserWindow = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal("window", { electronAPI: { createBrowserWindow } });

    const sid = ref<string | undefined>("s1");
    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(sid))!;

    const pending = api.create();
    sid.value = "s2";
    resolveCreate({ success: true, window: { windowId: "win_old" } });
    await pending;
    await nextTick();

    expect(layoutMocks.setWorkspaceVisible).not.toHaveBeenCalled();
    expect(tabMocks.selectTab).not.toHaveBeenCalled();

    scope.stop();
  });

  it("无 Electron / 无会话：canCreate=false，create 不调用", async () => {
    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(() => "s1"))!;
    expect(api.canCreate.value).toBe(false);
    await api.create();
    expect(tabMocks.selectTab).not.toHaveBeenCalled();
    scope.stop();

    const createBrowserWindow = vi.fn();
    vi.stubGlobal("window", { electronAPI: { createBrowserWindow } });
    const empty = effectScope();
    const noSession = empty.run(() => useBrowserWindows(() => undefined))!;
    expect(noSession.canCreate.value).toBe(false);
    await noSession.create();
    expect(createBrowserWindow).not.toHaveBeenCalled();
    empty.stop();
  });

  it("create 异常被吞掉：不选中、不抛出", async () => {
    const createBrowserWindow = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("window", { electronAPI: { createBrowserWindow } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const scope = effectScope();
    const api = scope.run(() => useBrowserWindows(() => "s1"))!;

    await expect(api.create()).resolves.toBeUndefined();
    expect(tabMocks.selectTab).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    scope.stop();
    errorSpy.mockRestore();
  });
});
