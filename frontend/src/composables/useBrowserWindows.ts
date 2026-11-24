import { computed, nextTick, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";

import { useBrowserWebviewStore, type WebviewState } from "@/stores/browserWebview";
import { useLayoutStore } from "@/stores/layout";
import { useTabStore } from "@/stores/tab";

/**
 * 输入区状态胶囊「浏览器窗口」段的数据域。
 *
 * 浏览器窗口不走后端：webview 生命周期完全由 Electron 主进程 + 常驻
 * BrowserWebviewLayer 维护，本 composable 只做当前会话的投影与两个动作
 * （切到某个窗口 / 新建窗口）。
 *
 * 按传入的 sessionId 过滤而不是读 store.currentSessionId：后者由 ChatPage 绑定，
 * 切会话瞬间可能滞后一帧，胶囊会把上一个会话的窗口短暂列出来。
 */
export function useBrowserWindows(
  sessionId: MaybeRefOrGetter<string | undefined>,
) {
  const browserStore = useBrowserWebviewStore();
  const layoutStore = useLayoutStore();
  const tabStore = useTabStore();

  /** 当前会话的浏览器窗口（Map 插入顺序 = 创建顺序） */
  const windows = computed<WebviewState[]>(() => {
    const sid = toValue(sessionId);
    if (!sid) return [];
    return browserStore.allWebviews.filter(
      (w) => w.metadata?.sessionId === sid,
    );
  });

  /** 新建入口只在 Electron + 有会话时可用（web 模式没有 window.electronAPI） */
  const canCreate = computed<boolean>(() => {
    if (!toValue(sessionId)) return false;
    if (typeof window === "undefined") return false;
    return !!window.electronAPI?.createBrowserWindow;
  });

  /** 切到某个浏览器窗口：先开工作区，等标签栏同步完成再选中 */
  function activate(windowId: string): void {
    layoutStore.setWorkspaceVisible(true);
    void nextTick(() => tabStore.selectTab(`browser:${windowId}`));
  }

  /** 新建浏览器窗口（about:blank），成功后打开工作区并选中 */
  async function create(): Promise<void> {
    const sid = toValue(sessionId);
    if (!sid || typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.createBrowserWindow) return;
    try {
      const result = await api.createBrowserWindow("about:blank", {
        sessionId: sid,
        createdBy: sid,
      });
      const windowId = result.window?.windowId;
      if (!result.success || !windowId) return;
      // await 期间切走会话：窗口属于旧会话，不能把当前工作区切过去
      if (toValue(sessionId) !== sid) return;
      layoutStore.setWorkspaceVisible(true);
      void nextTick(() => tabStore.selectTab(`browser:${windowId}`));
    } catch (e) {
      console.error("Failed to create browser window:", e);
    }
  }

  return { windows, canCreate, activate, create };
}
