import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTabStore } from "./tab";

/**
 * tabStore 文件标签「预览 / 持久」双态测试
 *
 * 约束：
 * - 非空文件标签的 key 恒等于 file:<path>
 * - 至多一个预览文件标签（isPreview = true）
 * - 目录树单击/双击只作用于当前激活的文件标签（树仅在文件标签激活时可见）
 * - 只有文件标签参与预览/替换，其它类型标签不受影响
 */
describe("tabStore.openFileInActiveTab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("空占位标签（预览）打开文件：原位改键为 file:<path>，保持预览，标签数不变", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:new-1", name: "新建", path: "", isPreview: true });
    store.selectTab("file:new-1");

    const handled = store.openFileInActiveTab({
      path: "/a.ts",
      name: "a.ts",
      extension: ".ts",
      size: 10,
    });

    expect(handled).toBe(true);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].key).toBe("file:/a.ts");
    expect(store.tabs[0].path).toBe("/a.ts");
    expect(store.tabs[0].name).toBe("a.ts");
    expect(store.tabs[0].extension).toBe(".ts");
    expect(store.tabs[0].size).toBe(10);
    expect(store.tabs[0].isPreview).toBe(true);
    expect(store.activeTabKey).toBe("file:/a.ts");
  });

  it("持久标签打开另一文件：原位改键后仍为持久", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });
    store.selectTab("file:/a.ts");

    const handled = store.openFileInActiveTab({ path: "/b.ts", name: "b.ts", extension: ".ts" });

    expect(handled).toBe(true);
    expect(store.tabs.map((t) => t.key)).toEqual(["file:/b.ts"]);
    expect(store.tabs[0].isPreview).toBeFalsy();
  });

  it("persistent=true 且同文件已激活（预览）：提升为持久", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.selectTab("file:/a.ts");

    expect(store.openFileInActiveTab({ path: "/a.ts", name: "a.ts" }, { persistent: true })).toBe(true);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].isPreview).toBe(false);
  });

  it("persistent=true 且切到另一文件（预览）：原位改键并固定为持久", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.selectTab("file:/a.ts");

    store.openFileInActiveTab({ path: "/b.ts", name: "b.ts" }, { persistent: true });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/b.ts"]);
    expect(store.tabs[0].isPreview).toBe(false);
  });

  it("目标已开在别的标签：丢弃当前标签并聚焦已有标签", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });
    store.addTab({ type: "file", key: "file:new-1", name: "新建", path: "", isPreview: true });
    store.selectTab("file:new-1");

    expect(store.openFileInActiveTab({ path: "/a.ts", name: "a.ts" })).toBe(true);
    expect(store.tabs.map((t) => t.key)).toEqual(["file:/a.ts"]);
    expect(store.activeTabKey).toBe("file:/a.ts");
  });

  it("目标已开在别的标签且 persistent=true：一并提升为持久", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.addTab({ type: "file", key: "file:/b.ts", name: "b.ts", path: "/b.ts" });
    store.selectTab("file:/b.ts");

    expect(store.openFileInActiveTab({ path: "/a.ts", name: "a.ts" }, { persistent: true })).toBe(true);
    expect(store.tabs.map((t) => t.key)).toEqual(["file:/a.ts"]);
    expect(store.tabs[0].isPreview).toBe(false);
    expect(store.activeTabKey).toBe("file:/a.ts");
  });

  it("当前激活的不是文件标签（git）：返回 false", () => {
    const store = useTabStore();
    store.openGitTab();

    expect(store.openFileInActiveTab({ path: "/a.ts", name: "a.ts" })).toBe(false);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].type).toBe("git");
  });

  it("无激活标签：返回 false", () => {
    const store = useTabStore();
    expect(store.openFileInActiveTab({ path: "/a.ts", name: "a.ts" })).toBe(false);
  });
});

describe("tabStore.openFilePreview", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("已有预览标签：原位改键复用，不新增标签", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.addTab({ type: "file", key: "file:/b.ts", name: "b.ts", path: "/b.ts" });
    store.selectTab("file:/b.ts");

    store.openFilePreview({ path: "/c.ts", name: "c.ts", extension: ".ts" });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/c.ts", "file:/b.ts"]);
    expect(store.tabs[0].isPreview).toBe(true);
    expect(store.activeTabKey).toBe("file:/c.ts");
  });

  it("空占位标签（预览）：被复用为文件预览标签", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:new-1", name: "新建", path: "", isPreview: true });
    store.selectTab("file:new-1");

    store.openFilePreview({ path: "/a.ts", name: "a.ts" });

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].key).toBe("file:/a.ts");
    expect(store.tabs[0].isPreview).toBe(true);
  });

  it("无预览标签：新建预览标签，且不改动当前持久标签", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });
    store.selectTab("file:/a.ts");

    store.openFilePreview({ path: "/b.ts", name: "b.ts" });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/a.ts", "file:/b.ts"]);
    expect(store.tabs[0].isPreview).toBeFalsy();
    expect(store.tabs[1].isPreview).toBe(true);
    expect(store.activeTabKey).toBe("file:/b.ts");
  });

  it("目标已打开：只激活，不新建也不降级", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });
    store.selectTab("file:/a.ts");

    store.openFilePreview({ path: "/a.ts", name: "a.ts" });

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].isPreview).toBeFalsy();
  });

  it("连续打开不同文件：预览标签始终只有一个", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });

    store.openFilePreview({ path: "/b.ts", name: "b.ts" });
    store.openFilePreview({ path: "/c.ts", name: "c.ts" });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/a.ts", "file:/c.ts"]);
    expect(store.tabs.filter((t) => t.type === "file" && t.isPreview)).toHaveLength(1);
  });

  it("addTab 直接添加预览标签时替换旧预览标签（回归）", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.addTab({ type: "file", key: "file:/b.ts", name: "b.ts", path: "/b.ts", isPreview: true });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/b.ts"]);
  });
});

describe("tabStore.openNewTab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("清空激活标签表示起始页，且不新增标签", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });
    store.selectTab("file:/a.ts");

    store.openNewTab();

    expect(store.activeTabKey).toBeNull();
    expect(store.tabs).toHaveLength(1);
  });
});

describe("tabStore.pinTab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("预览文件标签：固定为持久，标签数与激活态不变", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.selectTab("file:/a.ts");

    store.pinTab("file:/a.ts");

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].isPreview).toBe(false);
    expect(store.activeTabKey).toBe("file:/a.ts");
  });

  it("固定后新增预览标签不会替换它（固定即为防止被替换）", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });
    store.pinTab("file:/a.ts");

    store.addTab({ type: "file", key: "file:/b.ts", name: "b.ts", path: "/b.ts", isPreview: true });

    expect(store.tabs.map((t) => t.key)).toEqual(["file:/a.ts", "file:/b.ts"]);
    expect(store.tabs[0].isPreview).toBe(false);
    expect(store.tabs[1].isPreview).toBe(true);
  });

  it("空占位标签（path=''）同样可固定", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:new-1", name: "新建", path: "", isPreview: true });

    store.pinTab("file:new-1");

    expect(store.tabs[0].isPreview).toBe(false);
  });

  it("非文件标签（git）：no-op", () => {
    const store = useTabStore();
    store.openGitTab();

    store.pinTab("git");

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].type).toBe("git");
    expect(store.tabs[0].isPreview).toBeUndefined();
  });

  it("已是持久标签：幂等不变", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts" });

    store.pinTab("file:/a.ts");

    expect(store.tabs[0].isPreview).toBeFalsy();
  });

  it("key 不存在：no-op 不抛错", () => {
    const store = useTabStore();
    store.addTab({ type: "file", key: "file:/a.ts", name: "a.ts", path: "/a.ts", isPreview: true });

    expect(() => store.pinTab("file:/nope.ts")).not.toThrow();
    expect(store.tabs[0].isPreview).toBe(true);
  });
});
