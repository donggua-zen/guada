import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/// <reference types="jest" />

const mockRunGit = jest.fn();

jest.mock("../../src/modules/git/git-command-runner", () => ({
  runGitWithOutputCap: (...args: unknown[]) => mockRunGit(...args),
}));

import { GitService } from "../../src/modules/git/git.service";

interface GitCommandResultLike {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  outputTruncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

function result(
  overrides: Partial<GitCommandResultLike> = {},
): GitCommandResultLike {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    outputTruncated: false,
    timedOut: false,
    durationMs: 1,
    ...overrides,
  };
}

function record(...lines: string[]): string {
  return lines.join("\0") + "\0";
}

describe("GitService 大仓库字节上限降级", () => {
  let repo: string;
  let normalResult: GitCommandResultLike;
  let allResult: GitCommandResultLike;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-large-"));
    const huge = path.join(repo, "huge");
    fs.mkdirSync(huge);
    fs.writeFileSync(path.join(huge, "a.txt"), "a\n");
    fs.writeFileSync(path.join(huge, "b.txt"), "b\n");

    normalResult = result({
      stdout: record(
        "# branch.oid abc",
        "# branch.head main",
        "# branch.ab +0 -0",
        "? huge/",
        "1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
      ),
    });
    allResult = result({ outputTruncated: true });

    mockRunGit.mockReset();
    mockRunGit.mockImplementation(
      async (options: { args: string[] }): Promise<GitCommandResultLike> => {
        const args = options.args.join(" ");
        if (args === "rev-parse --show-toplevel") {
          return result({ stdout: `${repo}\n` });
        }
        if (args.startsWith("status") && args.includes("--untracked-files=normal")) {
          return normalResult;
        }
        if (args.startsWith("status") && args.includes("--untracked-files=all")) {
          return allResult;
        }
        if (args.includes("--numstat")) {
          return result();
        }
        return result();
      },
    );
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  function statusCalls(mode: "normal" | "all"): unknown[][] {
    return mockRunGit.mock.calls.filter(([options]) =>
      String(options.args.join(" ")).includes(`--untracked-files=${mode}`),
    );
  }

  it("-u all 超限：回退 -u normal，并记住该 repoRoot 不再尝试 all", async () => {
    const service = new GitService();

    const first = await service.getStatus(repo);

    expect(first.statusError).toBeUndefined();
    expect(first.files.map((f) => f.path)).toEqual(["huge/", "src/a.ts"]);
    expect(first.collapsedUntrackedDirs).toEqual(["huge/"]);
    expect(statusCalls("all")).toHaveLength(1);

    mockRunGit.mockClear();
    const second = await service.getStatus(repo);

    expect(second.files.map((f) => f.path)).toEqual(["huge/", "src/a.ts"]);
    expect(statusCalls("all")).toHaveLength(0);
  });

  it("-u normal 也超限：返回 too_many_changes，不返回部分列表", async () => {
    normalResult = result({ outputTruncated: true });
    const service = new GitService();

    const status = await service.getStatus(repo);

    expect(status.statusError).toBe("too_many_changes");
    expect(status.files).toEqual([]);
    expect(status.truncated).toBe(true);
  });

  it("too_many_changes 有 60s TTL，TTL 内不再重复 spawn status", async () => {
    normalResult = result({ outputTruncated: true });
    const service = new GitService();

    await service.getStatus(repo);
    const callsAfterFirst = statusCalls("normal").length;
    await service.getStatus(repo);

    expect(statusCalls("normal")).toHaveLength(callsAfterFirst);
  });

  it("status 超时降级为 timeout", async () => {
    normalResult = result({ timedOut: true });
    const service = new GitService();

    const status = await service.getStatus(repo);

    expect(status.statusError).toBe("timeout");
    expect(status.files).toEqual([]);
  });
});
