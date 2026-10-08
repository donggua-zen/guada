import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/services/ApiService", () => ({
  apiService: { getWorkspacePath: vi.fn() },
}));

import { useWorkspaceTreeStore } from "./workspaceTree";
import { apiService } from "@/services/ApiService";

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
