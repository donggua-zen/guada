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
 *
 * 归一层 normalizePluginSource：安装框里用户常粘贴的是"人类写法"（仓库网页地址、
 * owner/repo 短写法、本地路径），在进既有解析前先归一成上述规范形式，
 * 带规范前缀的输入原样透传（市场收录的 install 串不受影响）。
 */

import * as fs from "fs";

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

// ---------------------------------------------------------------------------
// 归一层：把"人类写法"归一成规范源字符串（带规范前缀的输入原样返回）
// ---------------------------------------------------------------------------

/** Windows 盘符绝对路径（D:\... 或 D:/...） */
const WIN_ABS_PATH = /^[a-zA-Z]:[\\/].+/;
/** POSIX 绝对路径（/home/...，含 file:// 展开后的形式） */
const POSIX_ABS_PATH = /^\/.+/;

/**
 * 把用户输入归一成规范源字符串；无法识别时原样返回（交给既有解析报错）。
 *
 * 识别优先级：双斜杠笔误 → github/gitee 网页或 clone URL → 任意 https git URL →
 * 本地路径（file:// / 跨平台绝对路径，且必须真实存在）→ owner/repo 短写法。
 */
export function normalizePluginSource(raw: string): string {
  const input = raw?.trim() ?? "";
  if (!input) return input;

  // 双斜杠笔误（github://owner/repo 等）：规范前缀 + 多余斜杠 → 归一。
  // 注意只匹配 2 个及以上斜杠：`local:/abs/path` 的单个 / 是绝对路径语义，不能吞。
  const prefixed = input.match(/^(github|gitee|git|local):\/{2,}(.+)$/i);
  if (prefixed) {
    const protocol = prefixed[1].toLowerCase();
    let rest = prefixed[2].replace(/^\/+/, "").replace(/[\\/]+$/, "");
    if (protocol === "local") rest = rest.replace(/\\/g, "/");
    return `${protocol}:${rest}`;
  }

  // local: 前缀 + Windows 反斜杠路径（local:D:\a\b）：单斜杠前缀，仅做分隔符归一
  const localPrefixed = input.match(/^local:(.+)$/i);
  if (localPrefixed && /\\/.test(localPrefixed[1])) {
    return `local:${localPrefixed[1].replace(/\\+/g, "/").replace(/\/+$/, "")}`;
  }

  // file:// scheme → 本地路径（file:///C:/x 与 file:///home/x 都要保住绝对语义）
  const fileUrl = input.match(/^file:\/\/(.+)$/i);
  if (fileUrl) {
    let p = decodeURIComponent(fileUrl[1]).replace(/\\/g, "/");
    // file:///C:/x → "/C:/x" → 去掉盘符前多余的一个 /
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
    return `local:${p.replace(/\/+$/, "")}`;
  }

  // https 仓库 URL：github/gitee 网页与 clone 地址归一成对应协议，其余归一成 git:
  if (/^https?:\/\//i.test(input)) {
    return normalizeHttpUrl(input);
  }

  // 跨平台绝对路径（目录必须真实存在才归一，不存在的路径走原报错，提示更准确）
  if (WIN_ABS_PATH.test(input) || POSIX_ABS_PATH.test(input)) {
    return normalizeLocalPath(input);
  }

  // owner/repo[#ref] 短写法：恰好两段且两段都满足 SAFE_REPO（避免吞掉别的写法）
  const short = input.match(/^([^/#\s]+)\/([^/#\s]+)(?:#([^\s]+))?$/);
  if (short && SAFE_REPO.test(short[1]) && SAFE_REPO.test(short[2])) {
    const ref = short[3] ? `#${short[3]}` : "";
    return `github:${short[1]}/${short[2]}${ref}`;
  }

  return input;
}

/** 本地路径归一：反斜杠 → 正斜杠、去尾部分隔符；存在性校验在 parse 侧已有报错语义 */
function normalizeLocalPath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return `local:${normalized}`;
}

/**
 * http(s) 仓库 URL 归一。
 * - github.com / gitee.com → 对应协议（`#ref` 从 /tree/<branch> 提取）
 * - 其他 host → git:<url>（/tree/<branch> 同样提取）
 * - /blob/ 开头说明指向单文件而非仓库根，不识别（原样返回 → 既有解析报错）
 */
function normalizeHttpUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return input;
  if (url.username || url.password) return input;
  if (url.search || url.hash) return input; // 带查询/锚点不是仓库地址

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return input;
  if (segments.length < 2) return input; // owner/repo 至少两段
  // /blob/…（owner/repo/blob/...）说明指向单文件而非仓库根，不识别
  if (segments[2] === "blob") return input;

  let ref = "";
  let pathSegments: string[];
  if (segments[2] === "tree" && segments.length >= 4) {
    // /tree/<branch>(/...)：只取首段为 ref（子路径属于网页目录视图，不参与安装）
    ref = `#${segments[3]}`;
    pathSegments = [segments[0], segments[1]];
  } else {
    pathSegments = segments;
  }

  // 去掉 .git 后缀（clone 地址形式）
  const last = pathSegments[pathSegments.length - 1];
  if (last && /\.git$/i.test(last)) {
    pathSegments = [...pathSegments.slice(0, -1), last.replace(/\.git$/i, "")];
  }

  const host = url.hostname.toLowerCase();
  if (host === "github.com") {
    if (pathSegments.length !== 2) return input;
    return `github:${pathSegments[0]}/${pathSegments[1]}${ref}`;
  }
  if (host === "gitee.com") {
    if (pathSegments.length !== 2) return input;
    return `gitee:${pathSegments[0]}/${pathSegments[1]}${ref}`;
  }

  // 其他 https git 仓库（GitCode、自建 GitLab 等）：ref 挂在 URL 后
  const cleanUrl = `${url.protocol}//${url.host}/${pathSegments.join("/")}`;
  return `git:${cleanUrl}${ref}`;
}

export function parsePluginSource(source: string): ParsedPluginSource {
  if (!source || typeof source !== "string") {
    throw new Error("source is required");
  }
  const raw = normalizePluginSource(source);

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
