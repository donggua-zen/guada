import { formatOpenTabsNote } from "../../src/modules/plugins/builtins/browser-script/browser-script.tab-note";
import type { BrowserScriptTabInfo } from "../../src/modules/plugins/builtins/browser-script/browser-script.types";

function tab(index: number, extra: Partial<BrowserScriptTabInfo> = {}): BrowserScriptTabInfo {
  return {
    index,
    tabId: `t${index}`,
    url: `https://example.com/${index}`,
    title: `Tab ${index}`,
    isCurrent: false,
    ...extra,
  };
}

describe("formatOpenTabsNote", () => {
  it("0/1 个标签不提醒", () => {
    expect(formatOpenTabsNote(undefined)).toBeNull();
    expect(formatOpenTabsNote([])).toBeNull();
    expect(formatOpenTabsNote([tab(0)])).toBeNull();
  });

  it("多个标签列出索引、标题、URL 和清理方法", () => {
    const note = formatOpenTabsNote([
      tab(0, { isCurrent: true }),
      tab(1),
    ]);

    expect(note).toContain("Open tabs (2)");
    expect(note).toContain("[0] Tab 0 — https://example.com/0 (current)");
    expect(note).toContain("[1] Tab 1 — https://example.com/1");
    expect(note).toContain("browser.tabs.close(indexOrTabId)");
    expect(note).toContain("browser.tabs.closeAll()");
  });

  it("超过 8 个只展示前 8 个并说明剩余数量", () => {
    const tabs = Array.from({ length: 10 }, (_, index) => tab(index));
    const note = formatOpenTabsNote(tabs);

    expect(note).toContain("Open tabs (10)");
    expect(note).toContain("[7]");
    expect(note).not.toContain("[8]");
    expect(note).toContain("...and 2 more");
  });

  it("页面标题/URL 的换行会被压平", () => {
    const note = formatOpenTabsNote([
      tab(0, { title: "A\nB", url: "https://example.com/\nC" }),
      tab(1),
    ]);

    expect(note).toContain("[0] A B — https://example.com/ C");
    expect(note?.split("\n").some((line) => line === "B")).toBe(false);
  });

  it("compact 模式只给数量和清理提示", () => {
    const note = formatOpenTabsNote([tab(0), tab(1)], { compact: true });

    expect(note).toContain("2 browser tabs are still open");
    expect(note).toContain("browser.tabs.close(indexOrTabId)");
    expect(note).not.toContain("[0]");
  });
});
