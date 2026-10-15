/**
 * GitService 子进程环境回归测试
 *
 * 背景：git 读命令（status/diff/show）在 stat 缓存过期时会刷新并写 .git/index，
 * 被 .git watcher 捕获后推送 → 前端刷新 → 再读命令，形成自激循环。修复手段是给
 * simple-git 实例设 GIT_OPTIONAL_LOCKS=0，让读命令不再做 optional 的 index 落盘
 * （借鉴 ZCode 的做法，见 packages/services/src/git/config.ts）。
 *
 * 同时锁定一个易错点：simple-git 的 `.env(对象)` 是**整体替换**子进程环境
 * （内部直接赋值 _executor.env，spawn 时作为完整 env 传入），所以必须展开 process.env，
 * 只传增量会让子进程丢掉 PATH 等变量、连 git 都找不到。
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockEnv = jest.fn();
const mockSimpleGit = jest.fn();

jest.mock("simple-git", () => ({
  simpleGit: (...args: unknown[]) => mockSimpleGit(...args),
}));

import { GitService } from "../../src/modules/git/git.service";

/// <reference types="jest" />

/** 最小 SimpleGit 桩：env 链式返回自身（真实用法是 simpleGit(...).env({...})），status/raw 返回空结果 */
function makeFakeGit(): Record<string, unknown> {
  const fake: Record<string, unknown> = {
    env: mockEnv,
    status: jest.fn(async () => ({
      files: [],
      current: null,
      ahead: 0,
      behind: 0,
    })),
    raw: jest.fn(async () => ""),
  };
  mockEnv.mockImplementation(() => fake);
  return fake;
}

describe("GitService 子进程环境", () => {
  let ws: string;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "git-service-"));
    mockSimpleGit.mockReset();
    mockEnv.mockReset();
    mockSimpleGit.mockImplementation(() => makeFakeGit());
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("实例带 GIT_OPTIONAL_LOCKS=0，且展开 process.env（.env 对象是整体替换）", async () => {
    const service = new GitService();
    await service.getStatus(ws);

    expect(mockEnv).toHaveBeenCalledTimes(1);
    const env = mockEnv.mock.calls[0][0] as NodeJS.ProcessEnv;
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(env.GIT_PAGER).toBe("cat");
    expect(env.PAGER).toBe("cat");
    // 必须保留完整环境：只传增量会让子进程丢 PATH，git 都找不到
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("同一工作目录复用实例：simpleGit 与 env 都只调用一次", async () => {
    const service = new GitService();
    await service.getStatus(ws);
    await service.getStatus(ws);

    expect(mockSimpleGit).toHaveBeenCalledTimes(1);
    expect(mockEnv).toHaveBeenCalledTimes(1);
  });
});
