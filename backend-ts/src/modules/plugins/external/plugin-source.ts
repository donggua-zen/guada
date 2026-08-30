/**
 * 插件分发源（source）解析层
 *
 * 支持的分发协议（参考 DSH 的 pnpm 风格，但适配 GuaDa 的"目录插件"形态）：
 *   github:owner/repo[#ref]        -> https://github.com/owner/repo.git
 *   gitee:owner/repo[#ref]         -> https://gitee.com/owner/repo.git
 *   git:https://host/path.git[#ref]-> 任意 git 仓库
 *   local:/abs/path 或 local:rel/path -> 本地目录（拷贝安装）
 *
 * ref 可以是分支名 / tag / commit（git clone -b 支持分支与 tag）。
 * 返回便于消费的结构化信息；解析失败抛 BadRequest。
 */

export type PluginSourceProtocol = "github" | "gitee" | "git" | "local";

export interface ParsedPluginSource {
  protocol: PluginSourceProtocol;
  /** 展示用（如 github:owner/repo#ref） */
  display: string;
  /** git 克隆地址（非 local 时有效） */
  cloneUrl?: string;
  /** git ref（分支/tag/commit），可空 */
  ref?: string;
  /** 本地路径（local 时有效） */
  localPath?: string;
  /** 安装到用户目录时的目录名（去 .git 后缀的仓库名） */
  dirName: string;
}

function normalizeDirName(name: string): string {
  // 仓库名 -> 目录名：合法、去 .git 后缀
  return name
    .replace(/\.git$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
}

const SAFE_REPO = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;
const SAFE_REF = /^[a-zA-Z0-9_.\/-]+$/;

export function parsePluginSource(source: string): ParsedPluginSource {
  if (!source || typeof source !== "string") {
    throw new Error("source is required");
  }
  const raw = source.trim();

  // github:owner/repo#ref
  let m = raw.match(/^github:([^#\/\s]+)\/([^#\s]+)(?:#([^\s]+))?$/i);
  if (m) return buildGitSource("github", m[1], m[2], m[3], raw);

  // gitee:owner/repo#ref
  m = raw.match(/^gitee:([^#\/\s]+)\/([^#\s]+)(?:#([^\s]+))?$/i);
  if (m) return buildGitSource("gitee", m[1], m[2], m[3], raw);

  // git:https://host/path#ref
  m = raw.match(/^git:(https?:\/\/[^#\s]+)(?:#([^\s]+))?$/i);
  if (m) {
    const repoUrl = m[1];
    const host = new URL(repoUrl).hostname;
    const dirName = normalizeDirName(repoUrl.split("/").pop() || "");
    if (!dirName) throw new Error(`Invalid git source: ${raw}`);
    return {
      protocol: "git",
      display: raw,
      cloneUrl: repoUrl,
      ref: m[2] || undefined,
      dirName,
    };
  }

  // local:path
  m = raw.match(/^local:(.+)$/i);
  if (m) {
    const p = m[1].trim();
    if (!p) throw new Error(`Invalid local source: ${raw}`);
    const dirName = normalizeDirName(p.split(/[\\/]/).pop() || "plugin");
    return {
      protocol: "local",
      display: raw,
      localPath: p,
      dirName,
    };
  }

  throw new Error(
    `Unsupported source "${raw}". Use github:owner/repo, gitee:owner/repo, git:https://...#ref, or local:path`,
  );
}

function buildGitSource(
  protocol: "github" | "gitee",
  owner: string,
  repo: string,
  ref: string | undefined,
  raw: string,
): ParsedPluginSource {
  if (!SAFE_REPO.test(owner) || !SAFE_REPO.test(repo)) {
    throw new Error(`Invalid ${protocol} repository path: ${owner}/${repo}`);
  }
  if (ref && !SAFE_REF.test(ref)) {
    throw new Error(`Invalid ref: ${ref}`);
  }
  const host = protocol === "github" ? "github.com" : "gitee.com";
  return {
    protocol,
    display: raw,
    cloneUrl: `https://${host}/${owner}/${repo}.git`,
    ref: ref || undefined,
    dirName: normalizeDirName(repo),
  };
}
