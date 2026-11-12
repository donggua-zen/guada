import type { BrowserScriptTabInfo } from "./browser-script.types";

/** 提醒里最多列出的标签数；超过时只显示前 N 个。 */
const MAX_TABS_SHOWN = 8;
const MAX_TITLE_CHARS = 100;
const MAX_URL_CHARS = 180;

/**
 * 脚本结束后给模型的标签清理提醒。
 *
 * 只有 2 个及以上标签才提醒：单个标签通常是本次任务的最终页面，不需要额外噪音。
 * compact 模式用于失败结果，只给数量与清理方法，避免和错误 details 里的标签列表重复。
 */
export function formatOpenTabsNote(
  tabs: readonly BrowserScriptTabInfo[] | undefined,
  options: { compact?: boolean } = {},
): string | null {
  if (!tabs || tabs.length <= 1) return null;

  if (options.compact) {
    return (
      `${tabs.length} browser tabs are still open in this session. ` +
      "Close tabs you no longer need with browser.tabs.close(indexOrTabId) or " +
      "browser.tabs.closeAll(); tabs left open stay visible to the user."
    );
  }

  const shown = tabs.slice(0, MAX_TABS_SHOWN);
  const lines = shown.map((tab) => {
    // 标题/URL 来自页面，压掉换行，避免把不可信内容拼成额外行。
    const title = truncate(clean(tab.title || "(untitled)"), MAX_TITLE_CHARS);
    const url = truncate(clean(tab.url), MAX_URL_CHARS);
    const current = tab.isCurrent ? " (current)" : "";
    return `[${tab.index}] ${title} — ${url}${current}`;
  });
  if (tabs.length > shown.length) {
    lines.push(`...and ${tabs.length - shown.length} more`);
  }

  return [
    `Open tabs (${tabs.length}):`,
    ...lines,
    "Close tabs you no longer need with browser.tabs.close(indexOrTabId) or browser.tabs.closeAll(); tabs left open stay visible to the user.",
  ].join("\n");
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
