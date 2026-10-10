import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// 只桩掉后端调用：ApiService 真实模块在加载期会读 localStorage（mock 开关），
// node 测试环境没有它。store 的竞态逻辑全部在这里被测，无需真实服务。
const apiMocks = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  getGitBranches: vi.fn(),
  onWorkspaceChange: vi.fn(() => () => {}),
  setWorkspaceWatchScope: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/services/ApiService", () => ({ apiService: apiMocks }));

import { useGitStore } from "./git";
import type { GitStatus } from "@/services/modules/git.api";

const repoStatus = (files: string[] = []): GitStatus =>
  ({
    isGitRepo: true,
    branch: "local-dev",
    ahead: 0,
    behind: 0,
    files: files.map((p) => ({ path: p, index: "M", workingDir: "", additions: 1, deletions: 0 })),
    stagedAdditions: 0,
    stagedDeletions: 0,
  }) as unknown as GitStatus;

const nonRepoStatus = (): GitStatus =>
  ({ isGitRepo: false, branch: null, ahead: 0, behind: 0, files: [] }) as unknown as GitStatus;

/**
 * GitStore 会话切换竞态回归测试
 *
 * 背景（2026-10-10 打包版复现）：从 git 仓库会话切到非仓库工作区会话（如「公共目录」）时，
 * 上一个会话的 `git/status` 响应可能在切换后才返回并被写进 store —— 原实现每次都用
 * `sessionId.value` 取值、且写回前不校验会话是否已切走，于是：
 *   ① 侧边栏停留在上一个工作区的变更列表；
 *   ② `isGitRepo` 仍为 true → 面板对非仓库工作区请求 `git/diff` → 后端 400
 *      「Not a git repository」+ 前端弹「加载 Git 状态失败」。
 * 并且无参数的 `refreshing` 布尔锁会把新会话的 refresh 当成"重复刷新"直接跳过。
 */
describe("gitStore 会话切换竞态", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getGitStatus.mockReset();
    apiMocks.getGitBranches.mockReset();
  });

  it("切走后到达的旧会话 status 不得覆盖新会话，且不得用新会话 id 请求 branches", async () => {
    const git = useGitStore();

    let resolveRepoStatus: (v: GitStatus) => void = () => {};
    const slowRepoStatus = new Promise<GitStatus>((r) => {
      resolveRepoStatus = r;
    });

    apiMocks.getGitStatus.mockImplementation((sid: string) =>
      sid === "repo-session" ? slowRepoStatus : Promise.resolve(nonRepoStatus()),
    );
    apiMocks.getGitBranches.mockResolvedValue({ branches: [{ name: "local-dev", current: true }] });

    // 仓库会话开始刷新（响应挂起）
    git.bindSession("repo-session");
    await Promise.resolve();
    expect(apiMocks.getGitStatus).toHaveBeenCalledWith("repo-session");

    // 切到非仓库会话：新会话的刷新必须能启动（不被布尔锁吞掉）
    git.bindSession("public-session");
    await Promise.resolve();
    expect(apiMocks.getGitStatus).toHaveBeenCalledWith("public-session");

    // 旧会话的慢响应此刻才到：不得写入新会话状态、不得对新会话发起 branches
    resolveRepoStatus(repoStatus(["backend-ts/Dockerfile"]));
    await new Promise((r) => setTimeout(r, 0));

    expect(apiMocks.getGitBranches).not.toHaveBeenCalled();
    expect(git.isGitRepo).toBe(false);
    expect(git.status?.files ?? []).toEqual([]);
    expect(git.branches).toEqual([]);
  });

  it("仓库会话的 status 与 branches 用发起时会话 id 请求", async () => {
    const git = useGitStore();
    apiMocks.getGitStatus.mockResolvedValue(repoStatus());
    apiMocks.getGitBranches.mockResolvedValue({ branches: [{ name: "local-dev", current: true }] });

    git.bindSession("s1");
    await new Promise((r) => setTimeout(r, 0));

    expect(apiMocks.getGitStatus).toHaveBeenCalledWith("s1");
    expect(apiMocks.getGitBranches).toHaveBeenCalledWith("s1");
    expect(git.isGitRepo).toBe(true);
    expect(git.branches).toHaveLength(1);
  });
});
