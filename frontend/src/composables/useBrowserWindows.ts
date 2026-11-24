import { computed, nextTick, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";

import { useBrowserWebviewStore, type WebviewState } from "@/stores/browserWebview";
import { useLayoutStore } from "@/stores/layout";
import { useTabStore } from "@/stores/tab";

/**
 * 输入区状态胶囊「浏览器窗口」段的数据域。
 *
 * 浏览器窗口不走后端：webview 生命周期完全由 Electron 主进程 + 常驻
 * BrowserWebviewLayer 维护，本 composable 只做当前会话的投影与「切到某个窗口」动作。
 * 新建窗口仍走工作区起始页入口，不在胶囊里重复提供。
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

  /** 切到某个浏览器窗口：先开工作区，等标签栏同步完成再选中 */
  function activate(windowId: string): void {
    layoutStore.setWorkspaceVisible(true);
    void nextTick(() => tabStore.selectTab(`browser:${windowId}`));
  }

  return { windows, activate };
}
