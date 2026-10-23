import { parseGitStatusPorcelain } from "../../src/modules/git/git-status-parser";

/// <reference types="jest" />

function record(...lines: string[]): string {
  return lines.join("\0") + "\0";
}

describe("parseGitStatusPorcelain", () => {
  it("解析 branch 头与普通变更（. 归一化为空）", () => {
    const parsed = parseGitStatusPorcelain(
      record(
        "# branch.oid abc123",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -3",
        "1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
        "1 M. N... 100644 100644 100644 aaa bbb src/b.ts",
        "? new.txt",
      ),
    );

    expect(parsed.branch).toBe("main");
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(3);
    expect(parsed.entries).toEqual([
      { path: "src/a.ts", index: "", workingDir: "M", isUntracked: false, isUnmerged: false },
      { path: "src/b.ts", index: "M", workingDir: "", isUntracked: false, isUnmerged: false },
      { path: "new.txt", index: "?", workingDir: "?", isUntracked: true, isUnmerged: false },
    ]);
  });

  it("rename：取新路径，跳过紧随其后的原路径 token", () => {
    const parsed = parseGitStatusPorcelain(
      record(
        "# branch.head main",
        "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts",
        "old name.ts",
      ),
    );

    expect(parsed.entries).toEqual([
      { path: "new name.ts", index: "R", workingDir: "", isUntracked: false, isUnmerged: false },
    ]);
  });

  it("冲突：保留 XY 并标记 unmerged", () => {
    const parsed = parseGitStatusPorcelain(
      record(
        "# branch.head main",
        "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
      ),
    );

    expect(parsed.entries).toEqual([
      { path: "conflict.ts", index: "U", workingDir: "U", isUntracked: false, isUnmerged: true },
    ]);
  });

  it("未跟踪目录保留尾斜杠", () => {
    const parsed = parseGitStatusPorcelain(
      record("# branch.head main", "? workbuddy-market/"),
    );

    expect(parsed.entries[0]).toEqual({
      path: "workbuddy-market/",
      index: "?",
      workingDir: "?",
      isUntracked: true,
      isUnmerged: false,
    });
  });

  it("detached HEAD → branch 为 null", () => {
    const parsed = parseGitStatusPorcelain(record("# branch.head (detached)"));
    expect(parsed.branch).toBeNull();
  });

  it("无 branch 头 → null/0/0", () => {
    const parsed = parseGitStatusPorcelain(record("? a.txt"));
    expect(parsed.branch).toBeNull();
    expect(parsed.ahead).toBe(0);
    expect(parsed.behind).toBe(0);
  });

  it("ignored 记录跳过；含空格/UTF-8 的路径完整保留", () => {
    const parsed = parseGitStatusPorcelain(
      record(
        "# branch.head main",
        "! ignored.log",
        "1 .M N... 100644 100644 100644 aaa bbb src/文件 名.ts",
      ),
    );

    expect(parsed.entries).toEqual([
      {
        path: "src/文件 名.ts",
        index: "",
        workingDir: "M",
        isUntracked: false,
        isUnmerged: false,
      },
    ]);
  });
});
