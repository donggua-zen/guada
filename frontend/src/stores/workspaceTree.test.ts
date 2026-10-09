import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/services/ApiService", () => ({
  apiService: { getWorkspacePath: vi.fn() },
}));

import { useWorkspaceTreeStore } from "./workspaceTree";
import { useTabStore } from "./tab";
import { apiService } from "@/services/ApiService";
import type { WorkspaceNode } from "@/types/workspace";

/**
 * 工作目录路径的单一来源测试
 *
 * 背景：后端的 workspace-path 是派生值（session.workspacePath ?? 全局 baseDir + sessionId），
 * 解析时还会确保目录存在，所以客户端只该按会话问一次；此前目录树、输入区工作目录条、
 * 文件预览各自调用，导致同一次启动出现两条请求。
 *
 * 覆盖：
 * - 同会话重复调用命中缓存（0 额外请求）
 * - 并发调用共享同一个在途请求
 * - 会话切换（resetForSession）后缓存失效、重新解析
 * - 失败不写缓存，下次重试
 * - force 绕过缓存
 * - 跨会话不污染目录树使用的 workspacePath
 */

const mockedGetPath = vi.mocked(apiService.getWorkspacePath);

describe("workspaceTree.ensureWorkspacePath", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedGetPath.mockReset();
  });

  it("同会话重复调用：第二次命中缓存，不再请求", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");

    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");

    expect(mockedGetPath).toHaveBeenCalledTimes(1);
  });

  it("并发调用：共享同一个在途请求", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");

    const [a, b] = await Promise.all([
      store.ensureWorkspacePath("s1"),
      store.ensureWorkspacePath("s1"),
    ]);

    expect(a).toBe("/ws/s1");
    expect(b).toBe("/ws/s1");
    expect(mockedGetPath).toHaveBeenCalledTimes(1);
  });

  it("会话切换后缓存失效：按新会话重新解析", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");
    await store.ensureWorkspacePath("s1");

    // 切到 s2：缓存整体失效
    expect(store.resetForSession("s2")).toBe(true);
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s2" });
    expect(await store.ensureWorkspacePath("s2")).toBe("/ws/s2");

    expect(mockedGetPath).toHaveBeenCalledTimes(2);
    // 同会话重复同步（返回 false）不应清缓存
    expect(store.resetForSession("s2")).toBe(false);
    expect(await store.ensureWorkspacePath("s2")).toBe("/ws/s2");
    expect(mockedGetPath).toHaveBeenCalledTimes(2);
  });

  it("首次初始化（null → sid）不清缓存：同会话不会被解析第二次", async () => {
    // 回归用例：WorkingDirBar 先解析（此时 store 还没同步到任何会话），
    // WorkspaceSidebar 随后挂载并 resetForSession(null → sid)——不得作废上面的结果。
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");

    expect(store.resetForSession("s1")).toBe(true);
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");

    expect(mockedGetPath).toHaveBeenCalledTimes(1);
  });

  it("切换到目标会话时若缓存已属于它：不重复解析（与消费方顺序无关）", async () => {
    // WorkingDirBar 先为新会话解析，WorkspaceSidebar 随后才 resetForSession 同步到该会话
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s2" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");
    expect(await store.ensureWorkspacePath("s2")).toBe("/ws/s2");

    expect(store.resetForSession("s2")).toBe(true);
    expect(await store.ensureWorkspacePath("s2")).toBe("/ws/s2");

    expect(mockedGetPath).toHaveBeenCalledTimes(1);
  });

  it("离开会话后缓存被丢弃：再回来重新解析（拿最新迁移结果）", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");
    await store.ensureWorkspacePath("s1");

    store.resetForSession("s2");
    store.resetForSession("s1");

    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1-moved" });
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1-moved");
    expect(mockedGetPath).toHaveBeenCalledTimes(2);
  });

  it("请求失败：返回 null 且不写缓存，下次重试", async () => {
    mockedGetPath.mockRejectedValueOnce(new Error("backend down"));
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");

    expect(await store.ensureWorkspacePath("s1")).toBeNull();

    mockedGetPath.mockResolvedValueOnce({ workspacePath: "/ws/s1" });
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");
    expect(mockedGetPath).toHaveBeenCalledTimes(2);
  });

  it("force 绕过缓存重新解析", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s1");
    await store.ensureWorkspacePath("s1");

    mockedGetPath.mockResolvedValueOnce({ workspacePath: "/ws/moved" });
    expect(await store.ensureWorkspacePath("s1", true)).toBe("/ws/moved");
    expect(mockedGetPath).toHaveBeenCalledTimes(2);
  });

  it("跨会话：不把别的会话的路径写进目录树使用的 workspacePath", async () => {
    mockedGetPath.mockResolvedValue({ workspacePath: "/ws/s1" });
    const store = useWorkspaceTreeStore();
    store.resetForSession("s2");

    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");
    expect(store.workspacePath).toBeNull();

    // 但该会话的路径已进缓存，再问不再请求
    expect(await store.ensureWorkspacePath("s1")).toBe("/ws/s1");
    expect(mockedGetPath).toHaveBeenCalledTimes(1);
  });

  it("空会话 id 直接返回 null，不发请求", async () => {
    const store = useWorkspaceTreeStore();
    expect(await store.ensureWorkspacePath("")).toBeNull();
    expect(mockedGetPath).not.toHaveBeenCalled();
  });
});

/**
 * SSE 文件变化事件的本地增量更新。
 *
 * 背景：change / unlink 曾被「父目录节点未加载就整条丢弃」的门闸挡住——
 * 深层文件（页面刷新后恢复的标签、聊天链接打开、树刷新后）因此收不到刷新信号，
 * 表现为同一文件有时能自动刷新、有时毫无反应。
 */
describe("workspaceTree.applyFileChange", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedGetPath.mockReset();
  });

  /** 初始树：根级 README.md + 已加载子节点的 src/（deep/ 从未展开） */
  function seedTree(): void {
    const store = useWorkspaceTreeStore();
    store.treeData = [
      {
        name: "src",
        path: "src",
        isDirectory: true,
        children: [{ name: "a.ts", path: "src/a.ts", isDirectory: false }],
      },
      { name: "README.md", path: "README.md", isDirectory: false },
    ] as WorkspaceNode[];
  }

  function changeEvent(path: string) {
    return { type: "change" as const, path, sessionId: "s1", timestamp: Date.now() };
  }

  it("change：父目录已加载时递增版本号", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange(changeEvent("src/a.ts"));

    expect(store.fileChangeVersions["src/a.ts"]).toBe(1);
  });

  it("change：父目录未加载（从未展开）也必须递增版本号", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange(changeEvent("deep/nested/file.ts"));

    expect(store.fileChangeVersions["deep/nested/file.ts"]).toBe(1);
  });

  it("change：反斜杠路径归一化为正斜杠键", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange(changeEvent("src\\a.ts"));
    store.applyFileChange(changeEvent("src/a.ts"));

    expect(store.fileChangeVersions["src/a.ts"]).toBe(2);
    expect(Object.keys(store.fileChangeVersions)).toEqual(["src/a.ts"]);
  });

  it("unlink：父目录未加载时也要关闭对应文件标签", () => {
    seedTree();
    const store = useWorkspaceTreeStore();
    const tabStore = useTabStore();
    tabStore.tabs = [
      { type: "file", key: "file:deep/nested/file.ts", path: "deep/nested/file.ts", name: "file.ts" },
      { type: "file", key: "file:src/a.ts", path: "src/a.ts", name: "a.ts" },
    ] as typeof tabStore.tabs;

    store.applyFileChange({ type: "unlink", path: "deep/nested/file.ts", sessionId: "s1", timestamp: 1 });

    expect(tabStore.tabs.map(t => t.key)).toEqual(["file:src/a.ts"]);
  });

  it("unlinkDir：关闭其下全部文件标签（含更深层），不误伤其他标签", () => {
    seedTree();
    const store = useWorkspaceTreeStore();
    const tabStore = useTabStore();
    tabStore.tabs = [
      { type: "file", key: "file:src/a.ts", path: "src/a.ts", name: "a.ts" },
      { type: "file", key: "file:src/sub/b.ts", path: "src/sub/b.ts", name: "b.ts" },
      { type: "file", key: "file:src.ts", path: "src.ts", name: "src.ts" },
    ] as typeof tabStore.tabs;

    store.applyFileChange({ type: "unlinkDir", path: "src", sessionId: "s1", timestamp: 1 });

    expect(tabStore.tabs.map(t => t.key)).toEqual(["file:src.ts"]);
  });

  it("unlink：已加载父目录时同步移除树节点", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange({ type: "unlink", path: "src/a.ts", sessionId: "s1", timestamp: 1 });

    const src = store.findNodeByPath(store.treeData, "src");
    expect(src?.children).toEqual([]);
  });

  it("add：父目录已加载时插入并按目录优先、名称排序", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange({ type: "add", path: "src/z.ts", sessionId: "s1", timestamp: 1 });
    store.applyFileChange({ type: "addDir", path: "src/utils", sessionId: "s1", timestamp: 1 });

    const src = store.findNodeByPath(store.treeData, "src");
    expect(src?.children?.map(c => c.path)).toEqual(["src/utils", "src/a.ts", "src/z.ts"]);
  });

  it("add：同名子节点已存在时不重复插入", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange({ type: "add", path: "src/a.ts", sessionId: "s1", timestamp: 1 });

    const src = store.findNodeByPath(store.treeData, "src");
    expect(src?.children?.filter(c => c.name === "a.ts")).toHaveLength(1);
  });

  it("add：父目录未加载时忽略（不建节点、不报错）", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange({ type: "add", path: "deep/nested/new.ts", sessionId: "s1", timestamp: 1 });

    expect(store.findNodeByPath(store.treeData, "deep")).toBeNull();
    expect(store.fileChangeVersions["deep/nested/new.ts"]).toBeUndefined();
  });

  it("heartbeat / git / 空路径事件忽略", () => {
    seedTree();
    const store = useWorkspaceTreeStore();

    store.applyFileChange({ type: "heartbeat", path: "", sessionId: "s1", timestamp: 1 });
    store.applyFileChange({ type: "git", path: "", sessionId: "s1", timestamp: 1 });
    store.applyFileChange({ type: "change", path: "", sessionId: "s1", timestamp: 1 });

    expect(store.fileChangeVersions).toEqual({});
  });
});
