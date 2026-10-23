/**
 * GitService 子进程环境回归测试
 *
 * 事故背景：为让 git 读命令不再写 .git/index，曾给 simple-git 实例设
 * `.env({ ...process.env, GIT_OPTIONAL_LOCKS: "0" })`。simple-git 的 block-unsafe-operations
 * 插件会扫描「显式传入的 env」，命中 EDITOR / PAGER / GIT_PAGER 等键就直接抛错
 * （Use of "EDITOR" is not permitted without enabling allowUnsafeEditor），于是**所有** git
 * 命令在开发机上全部 500。现改为由 GitService 写 process.env：simple-git 不传 env，
 * 插件只看到空对象，安全策略完整保留，也不必删除任何环境变量（用户的 GIT_SSH_COMMAND /
 * GIT_ASKPASS 等认证配置不受影响）。
 *
 * 注意：jest 的 node 环境把 process.env 隔离成副本，测试里对它的改动不会传到子进程，
 * 因此「变量生效后 git 不写 index」无法在此断言 —— 该效果已在真实 node 进程里实测确认
 * （GIT_OPTIONAL_LOCKS=0 时 getStatus 不改动 .git/index 的 mtime）。本文件锁定两件事：
 * ① 策略变量确实被写入进程环境；② 环境里存在 EDITOR / PAGER / GIT_PAGER 时 git 仍能出结果。
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { GitService } from "../../src/modules/git/git.service";

/// <reference types="jest" />

/** 会被 simple-git 插件判定为 unsafe 的常见环境变量（覆盖开发机与 CI） */
const UNSAFE_ENV_KEYS = ["EDITOR", "PAGER", "GIT_PAGER"] as const;

describe("GitService 子进程环境", () => {
  let repo: string;
  let hasGit = false;
  /** 被改写的环境变量原值（测后还原，避免影响同 worker 内的其他用例） */
  let saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    hasGit = new GitService().isGitAvailable();
  });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-service-"));
    saved = {};
    for (const key of UNSAFE_ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of UNSAFE_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(repo, { recursive: true, force: true });
  });

  /** 建一个真实仓库并提交一个文件（只有真实 git 行为才能验证 env 的影响） */
  function initRepoWithCommit(): void {
    const git = (...args: string[]) =>
      execFileSync("git", args, { windowsHide: true });
    git("init", "-q", repo);
    git("-C", repo, "config", "user.email", "test@example.com");
    git("-C", repo, "config", "user.name", "test");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    git("-C", repo, "add", "a.txt");
    git("-C", repo, "commit", "-qm", "init");
  }

  it("策略变量写入进程环境：GIT_OPTIONAL_LOCKS=0", () => {
    new GitService();
    expect(process.env.GIT_OPTIONAL_LOCKS).toBe("0");
  });

  it("环境含 EDITOR/PAGER 时仍能执行 git 命令（不得向 simple-git 传 env）", async () => {
    if (!hasGit) return; // 环境无 git：无法验证真实 git 行为，跳过

    initRepoWithCommit();
    fs.writeFileSync(path.join(repo, "b.txt"), "new\n");

    process.env.EDITOR = "vim";
    process.env.PAGER = "less";
    process.env.GIT_PAGER = "less";

    const status = await new GitService().getStatus(repo);

    expect(status.files.map((f) => f.path)).toContain("b.txt");
  }, 30000);

  it("超大未跟踪目录：折叠为一条目录记录，不逐文件枚举", async () => {
    if (!hasGit) return;

    initRepoWithCommit();
    const huge = path.join(repo, "huge");
    fs.mkdirSync(huge);
    for (let i = 0; i < 2500; i++) {
      fs.writeFileSync(path.join(huge, `f-${i}.txt`), "x\n");
    }

    const status = await new GitService().getStatus(repo);

    // 25 万文件仓库的等价场景：只保留 git 的 `huge/` 折叠记录。
    expect(status.files.map((f) => f.path)).toEqual(["huge/"]);
    expect(status.collapsedUntrackedDirs).toEqual(["huge/"]);
    expect(status.files[0]?.additions).toBe(0);
    expect(status.totalFiles).toBe(1);
  }, 60000);

  it("小未跟踪目录：仍逐文件展开（普通项目行为不回退）", async () => {
    if (!hasGit) return;

    initRepoWithCommit();
    const newDir = path.join(repo, "newdir");
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, "a.txt"), "a\n");
    fs.writeFileSync(path.join(newDir, "b.txt"), "b\n");

    const status = await new GitService().getStatus(repo);

    expect(status.files.map((f) => f.path).sort()).toEqual([
      "newdir/a.txt",
      "newdir/b.txt",
    ]);
    expect(status.collapsedUntrackedDirs).toBeUndefined();
  }, 30000);

  it("未跟踪大文件：保留条目但不读取全文统计行数", async () => {
    if (!hasGit) return;

    initRepoWithCommit();
    fs.writeFileSync(path.join(repo, "big.txt"), Buffer.alloc(2 * 1024 * 1024, 97));

    const status = await new GitService().getStatus(repo);
    const big = status.files.find((f) => f.path === "big.txt");

    expect(big).toBeDefined();
    expect(big?.additions).toBe(0);
  }, 30000);

  it("未跟踪文件 diff：走 ls-files 定向判断，返回 new-file", async () => {
    if (!hasGit) return;

    initRepoWithCommit();
    const newDir = path.join(repo, "newdir");
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, "a.txt"), "hello\n");

    const diff = await new GitService().getDiff(repo, "newdir/a.txt", false);

    expect(diff.type).toBe("new-file");
    expect(diff.content).toBe("hello\n");
  }, 30000);
});
