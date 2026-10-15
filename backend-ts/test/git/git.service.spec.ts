/**
 * GitService 子进程环境回归测试
 *
 * 事故背景：为让 git 读命令不再写 .git/index，曾给 simple-git 实例设
 * `.env({ ...process.env, GIT_OPTIONAL_LOCKS: "0" })`。但 simple-git 的
 * block-unsafe-operations 插件会扫描「显式传入的 env」，命中 EDITOR / PAGER / GIT_PAGER
 * 等键就直接抛错（Use of "EDITOR" is not permitted without enabling allowUnsafeEditor），
 * 于是**所有** git 命令在开发机上全部 500。
 *
 * 本测试用真实 git 复现该环境：只要实现不向 simple-git 传 env（子进程走默认继承
 * process.env），在 EDITOR 等变量存在时也必须能正常出结果。
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
  let ws: string;
  let hasGit = false;
  /** 被改写的环境变量原值（同一 jest worker 内多个测试文件共用 process.env，测后必须还原） */
  let saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    hasGit = new GitService().isGitAvailable();
  });

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "git-service-"));
    saved = {};
    for (const key of UNSAFE_ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of UNSAFE_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("环境含 EDITOR/PAGER 时仍能执行 git 命令（实现不得向 simple-git 传 env）", async () => {
    if (!hasGit) return; // 环境无 git：无法验证真实 git 行为，跳过

    execFileSync("git", ["init", "-q", ws], { windowsHide: true });
    fs.writeFileSync(path.join(ws, "a.txt"), "one");

    process.env.EDITOR = "vim";
    process.env.PAGER = "less";
    process.env.GIT_PAGER = "less";

    const status = await new GitService().getStatus(ws);

    expect(status.files.map((f) => f.path)).toContain("a.txt");
  }, 30000);
});
