/**
 * `git status --porcelain=v2 --branch -z` 解析器。
 *
 * v2 的关键点（-z 模式下所有记录以 NUL 分隔）：
 * - `# branch.head <name>` / `# branch.ab +A -B`；
 * - `1 XY sub mH mI mW hH hI <path>`；
 * - `2 XY sub mH mI mW hH hI <Xscore> <path>\0<origPath>`；
 * - `u XY sub m1 m2 m3 mW h1 h2 h3 <path>`；
 * - `? <path>`；
 * - `! <path>`（ignored，未请求，跳过）。
 *
 * XY 中的 `.` 表示该侧无变更，这里统一归一化为空字符串，与前端
 * classifyFile 的语义（空串 = 无变更）保持一致。
 */
export interface ParsedGitStatusEntry {
  /** git 输出的路径（正斜杠；未跟踪目录保留尾斜杠） */
  path: string;
  /** 暂存区状态；空字符串表示无变更，`?` 表示未跟踪 */
  index: string;
  /** 工作区状态；空字符串表示无变更，`?` 表示未跟踪 */
  workingDir: string;
  isUntracked: boolean;
  isUnmerged: boolean;
}

export interface ParsedGitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: ParsedGitStatusEntry[];
}

function normalizeStatusChar(char: string | undefined): string {
  if (!char || char === "." || char === " ") return "";
  return char;
}

export function parseGitStatusPorcelain(stdout: string): ParsedGitStatus {
  const entries: ParsedGitStatusEntry[] = [];
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;

  const tokens = stdout.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith("# ")) {
      const header = token.slice(2);
      if (header.startsWith("branch.head ")) {
        const head = header.slice("branch.head ".length).trim();
        branch = head === "(detached)" ? null : head;
      } else if (header.startsWith("branch.ab ")) {
        const match = header.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = parseInt(match[1], 10);
          behind = parseInt(match[2], 10);
        }
      }
      continue;
    }

    const type = token[0];
    if (type === "1") {
      const parts = token.split(" ");
      if (parts.length < 9) continue;
      const xy = parts[1] ?? "";
      entries.push({
        path: parts.slice(8).join(" "),
        index: normalizeStatusChar(xy[0]),
        workingDir: normalizeStatusChar(xy[1]),
        isUntracked: false,
        isUnmerged: false,
      });
    } else if (type === "2") {
      const parts = token.split(" ");
      if (parts.length < 10) continue;
      const xy = parts[1] ?? "";
      entries.push({
        path: parts.slice(9).join(" "),
        index: normalizeStatusChar(xy[0]),
        workingDir: normalizeStatusChar(xy[1]),
        isUntracked: false,
        isUnmerged: false,
      });
      // rename/copy 的原路径是下一个 NUL token；当前 UI 只展示新路径
      i++;
    } else if (type === "u") {
      const parts = token.split(" ");
      if (parts.length < 11) continue;
      const xy = parts[1] ?? "UU";
      entries.push({
        path: parts.slice(10).join(" "),
        index: normalizeStatusChar(xy[0]) || "U",
        workingDir: normalizeStatusChar(xy[1]) || "U",
        isUntracked: false,
        isUnmerged: true,
      });
    } else if (type === "?") {
      const path = token.slice(2);
      if (!path) continue;
      entries.push({
        path,
        index: "?",
        workingDir: "?",
        isUntracked: true,
        isUnmerged: false,
      });
    }
  }

  return { branch, ahead, behind, entries };
}
