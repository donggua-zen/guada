import type { WindowInfo } from "./browser-tab-manager";

/**
 * 每个 AI 会话（createdBy）的标签预算。
 *
 * 用户手动打开的标签没有 createdBy，不占额度；子 Agent 各自独立计数。
 * 这里只做纯计算，真正的创建/拒绝逻辑在 BrowserAutomationService。
 */
export const MAX_TABS_PER_SESSION = 8;

/** 达到该数量后，结果开始附带完整标签列表和清理提示。 */
export const TAB_WARN_THRESHOLD = 6;

export interface BrowserTabInfo {
  index: number;
  tabId: string;
  url: string;
  title: string;
  isCurrent: boolean;
}

export interface BrowserTabSummary {
  count: number;
  limit: number;
  current: BrowserTabInfo | null;
  /** 新建标签或达到软提醒阈值时才返回，避免每次导航都重复长列表。 */
  items?: BrowserTabInfo[];
  warning?: string;
}

/**
 * 列出某个 createdBy 的标签，索引与 browser.tabs.list 保持一致。
 */
export function listCreatorTabs(
  windows: readonly WindowInfo[],
  createdBy: string,
  currentTabId?: string,
): BrowserTabInfo[] {
  if (!createdBy) return [];
  return windows
    .filter((window) => window.metadata?.createdBy === createdBy)
    .map((window, index) => ({
      index,
      tabId: window.windowId,
      url: window.url,
      title: window.title,
      isCurrent: window.windowId === currentTabId,
    }));
}

export function buildTabSummary(
  windows: readonly WindowInfo[],
  createdBy: string,
  currentTabId: string | undefined,
  options: { includeItems?: boolean } = {},
): BrowserTabSummary | undefined {
  if (!createdBy) return undefined;

  const items = listCreatorTabs(windows, createdBy, currentTabId);
  const count = items.length;
  const includeItems =
    options.includeItems === true || count >= TAB_WARN_THRESHOLD;
  const warning = tabWarning(count);

  return {
    count,
    limit: MAX_TABS_PER_SESSION,
    current: items.find((tab) => tab.isCurrent) ?? null,
    ...(includeItems ? { items } : {}),
    ...(warning ? { warning } : {}),
  };
}

export function tabLimitMessage(count: number): string {
  return (
    `Tab limit reached for this session (${count}/${MAX_TABS_PER_SESSION}). ` +
    "Reuse the current tab with tab.goto(url), or close tabs with " +
    "browser.tabs.close(indexOrTabId) / browser.tabs.closeAll() before opening another."
  );
}

function tabWarning(count: number): string | undefined {
  if (count < TAB_WARN_THRESHOLD) return undefined;
  if (count >= MAX_TABS_PER_SESSION) {
    return (
      `Tab limit reached (${count}/${MAX_TABS_PER_SESSION}). ` +
      "Reuse the current tab or close unneeded tabs with " +
      "browser.tabs.close(indexOrTabId) / browser.tabs.closeAll(); " +
      "new tabs will fail with TAB_LIMIT."
    );
  }
  return (
    `${count}/${MAX_TABS_PER_SESSION} tabs are open in this session. ` +
    "Reuse the current tab or close unneeded tabs with " +
    "browser.tabs.close(indexOrTabId) / browser.tabs.closeAll() before opening more."
  );
}
