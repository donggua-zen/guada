/**
 * 命令策略：POSIX（Git Bash）侧只读白名单。
 *
 * 表形状借鉴 zcode 的 bash-readonly-policy（按命令名/子命令 + 参数级核验 + 写选项否决），
 * 表内容是本项目自维护的第一批高频命令。原则：
 * - 只写"**没有**任何写语义"的命令；有写开关的命令把写开关列进 forbidden
 * - 只允许特定形态的命令用 `match` 显式列举（如只允许 `node --version`）
 * - 不确定的一律不写进表（unknown → 需审批/拒绝），宁可少放行
 */

import { evaluateArgs, type FlagKind } from "./flag-eval";
import { scanCommand } from "./scan";
import type { DialectAnalysis, DialectVerdict } from "./types";

type MatchVerdict = "ok" | "unsafe" | "unknown";

interface PosixPolicy {
  /** 已知安全开关 → 是否吃值 */
  flags?: Record<string, FlagKind>;
  /** 命中即 unsafe 的写/危险开关（短开关按前缀匹配附加形式，如 -i.bak） */
  forbidden?: readonly string[];
  /** 位置参数规则：默认 any */
  positionals?: "any" | "none" | "at-most-one";
  /** 命令本身只有读语义，参数不参与判定（仍会跑 forbidden） */
  allowAnyArgs?: boolean;
  /** 只接受特定形态的命令（参数数组，不含命令名） */
  match?: (argv: readonly string[]) => MatchVerdict;
}

/** 允许任意参数的纯读命令：**自身没有任何写开关**（加之前先确认这点） */
const ANY_ARGS_READ_ONLY: readonly string[] = [
  // 文件查看/信息
  "cat",
  "head",
  "wc",
  "ls",
  "dir",
  "stat",
  "file",
  "du",
  "df",
  "readlink",
  "realpath",
  "basename",
  "dirname",
  "pwd",
  "tac",
  "rev",
  "nl",
  "strings",
  "cksum",
  "md5sum",
  "sha1sum",
  "sha256sum",
  // 文本处理（只写 stdout）
  "cut",
  "tr",
  "jq",
  "column",
  "comm",
  "join",
  "paste",
  "diff",
  "diff3",
  "cmp",
  // 搜索（无写开关）
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  // 解析/探测
  "echo",
  "printf",
  "test",
  "[",
  "true",
  "false",
  "which",
  "whereis",
  "type",
  "id",
  "groups",
  "whoami",
  "hostname",
  "uname",
  "printenv",
  "seq",
  "expr",
  "sleep",
  "cd",
  "pushd",
  "popd",
  // Windows 自带只读工具（Git Bash 只是转交执行）
  "systeminfo",
  "netstat",
  "tasklist",
  "ping",
  "findstr",
  "nslookup",
  "tracert",
  "getmac",
  "driverquery",
  "where",
];

/** 只接受"报版本/帮助"形态的工具（这些工具本体是执行器，绝不能放行其它形态） */
const VERSION_ONLY_ARGS: readonly string[] = [
  "--version",
  "-v",
  "-V",
  "--help",
  "-h",
];

function onlyVersionArgs(argv: readonly string[]): MatchVerdict {
  if (argv.length === 0) return "unknown";
  return argv.every((arg) => VERSION_ONLY_ARGS.includes(arg)) ? "ok" : "unknown";
}

function firstArgIn(allowed: readonly string[]): (argv: readonly string[]) => MatchVerdict {
  return (argv) => (argv.length > 0 && allowed.includes(argv[0]) ? "ok" : "unknown");
}

/** git 只读子命令共享：这些子命令都接受大量只读开关，但 --output 会落盘 */
const GIT_READ_SUBCOMMAND_FORBIDDEN: readonly string[] = ["--output"];

/** git 只读子命令（未列出的子命令一律 unknown） */
const GIT_READONLY_SUBCOMMANDS: Record<string, PosixPolicy> = {
  status: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  diff: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  log: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  show: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "rev-parse": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "rev-list": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "ls-files": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "ls-tree": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "ls-remote": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "cat-file": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  blame: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  describe: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  shortlog: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "show-ref": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "symbolic-ref": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "merge-base": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "count-objects": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "check-ignore": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "diff-tree": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "diff-index": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "diff-files": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "name-rev": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  "var": { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  version: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  grep: { allowAnyArgs: true, forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN },
  // 子命令本身有写/删形态，用显式列举
  reflog: {
    match: (argv) => (argv.length === 0 || argv[0] === "show" ? "ok" : "unknown"),
    forbidden: GIT_READ_SUBCOMMAND_FORBIDDEN,
  },
  stash: {
    match: (argv) => (argv.length === 0 || argv[0] === "list" || argv[0] === "show" ? "ok" : "unknown"),
  },
  remote: {
    match: (argv) =>
      argv.every((a) => ["-v", "--verbose"].includes(a)) ||
      (argv.length >= 1 &&
        ["show", "get-url"].includes(argv[0]) &&
        argv.slice(1).every((a) => !a.startsWith("-")))
        ? "ok"
        : "unknown",
  },
  worktree: {
    match: (argv) => (argv.length === 0 || argv[0] === "list" ? "ok" : "unknown"),
  },
  branch: {
    flags: {
      "-l": "none",
      "--list": "none",
      "-a": "none",
      "--all": "none",
      "-r": "none",
      "--remotes": "none",
      "-v": "none",
      "-vv": "none",
      "--verbose": "none",
      "--show-current": "none",
      "--contains": "string",
      "--no-contains": "string",
      "--merged": "none",
      "--no-merged": "none",
      "--points-at": "string",
    },
    positionals: "none",
  },
  tag: {
    flags: {
      "-l": "none",
      "--list": "none",
      "-n": "number",
      "--contains": "string",
      "--no-contains": "string",
      "--points-at": "string",
    },
    positionals: "none",
  },
  config: {
    flags: {
      "--get": "string",
      "--get-all": "string",
      "--get-regexp": "string",
      "--list": "none",
      "-l": "none",
      "--show-origin": "none",
      "--local": "none",
      "--global": "none",
      "--system": "none",
    },
    positionals: "at-most-one",
  },
};

/** git 全局开关：能改写配置/工作树/执行路径的一律危险；--no-pager 之类无害 */
const GIT_SAFE_GLOBAL_FLAGS: readonly string[] = [
  "--no-pager",
  "--paginate",
  "--no-optional-locks",
  "--literal-pathspecs",
];
const GIT_DANGEROUS_GLOBAL_FLAGS: readonly string[] = [
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--exec-path",
  "--config-env",
  "--bare",
  "--namespace",
];

/** 有开关语义的命令（逐个核验参数） */
const POSIX_POLICIES: Record<string, PosixPolicy> = {
  // find：写语义集中在这些开关上（-fprint/-fls 系、-exec 系、-delete）
  find: {
    allowAnyArgs: true,
    forbidden: [
      "-delete",
      "-exec",
      "-execdir",
      "-ok",
      "-okdir",
      "-fprint",
      "-fprint0",
      "-fprintf",
      "-fls",
      "-files0-from",
    ],
  },
  // sort：-o/--output 落盘
  sort: { allowAnyArgs: true, forbidden: ["-o", "--output"] },
  // uniq：第二个位置参数是输出文件
  uniq: { allowAnyArgs: true, positionals: "at-most-one" },
  // tail：-f 会长期跟踪（挂住会话）
  tail: { allowAnyArgs: true, forbidden: ["-f", "--follow", "-F"] },
  // date：-s/--set 改系统时间
  date: { allowAnyArgs: true, forbidden: ["-s", "--set"] },
  // tree：-o 落盘
  tree: { allowAnyArgs: true, forbidden: ["-o", "--output"] },
  // sed：-i 原地写；脚本内的 w/W/r/e 命令也会写文件或执行命令
  sed: {
    forbidden: ["-i", "--in-place"],
    match: (argv) => {
      const scripts = argv.filter((arg) => !arg.startsWith("-"));
      for (const script of scripts) {
        // w file / W file / r file / e 命令，以及 s///w file
        if (/(^|[\s;])[wWr]\s|(^|[\s;])e(\s|$)|\/w\s/.test(script)) {
          return "unsafe";
        }
      }
      return "ok";
    },
  },
  // 解释器/构建工具：只允许报版本
  node: { match: onlyVersionArgs },
  python: { match: onlyVersionArgs },
  python3: { match: onlyVersionArgs },
  pip: { match: firstArgIn(["--version", "-V"]) },
  cargo: { match: firstArgIn(["--version", "-V"]) },
  java: { match: firstArgIn(["-version", "--version"]) },
  dotnet: { match: firstArgIn(["--version", "--info", "--list-sdks", "--list-runtimes"]) },
  go: { match: firstArgIn(["version"]) },
  npm: { match: firstArgIn(["--version", "-v", "ls", "list"]) },
  // docker 的只读子命令（ps/images/version/info/inspect）；logs 会持续输出，不列。
  // `container` 必须跟只读子子命令（ls/list）才算只读——裸 `container` 曾把
  // `docker container run/rm/stop` 一并放行。
  docker: {
    match: (argv) =>
      argv.length > 0 &&
      (["ps", "images", "version", "info", "inspect"].includes(argv[0]) ||
        (argv[0] === "container" && ["ls", "list"].includes(argv[1] ?? "")))
        ? "ok"
        : "unknown",
  },
  git: { match: () => "unknown" }, // 由 evaluateGit 专用分支处理，这里不会被用到
};

function basenamePosix(token: string): string {
  const trimmed = token.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function applyPolicy(
  policy: PosixPolicy | undefined,
  args: readonly string[],
  label: string,
  reasons: string[],
  offending: string[],
): DialectVerdict {
  const reject = (verdict: DialectVerdict, detail: string): DialectVerdict => {
    reasons.push(`${label}: ${detail}`);
    offending.push(label);
    return verdict;
  };

  if (!policy) return reject("unknown", "not in the read-only allowlist");

  if (policy.match) {
    const verdict = policy.match(args);
    if (verdict === "unsafe") return reject("unsafe", "matched a write/dangerous shape");
    if (verdict === "unknown") return reject("unknown", "not a verified read-only form");
    // match 通过后仍跑一遍 forbidden（例如 git 子命令的 --output）
    if (policy.forbidden) {
      const result = evaluateArgs(args, { forbidden: policy.forbidden });
      if (result.verdict === "unsafe") return reject("unsafe", result.detail);
    }
    return "read-only";
  }

  if (policy.allowAnyArgs) {
    if (policy.forbidden) {
      const result = evaluateArgs(args, { forbidden: policy.forbidden });
      if (result.verdict === "unsafe") return reject("unsafe", result.detail);
    }
    if (policy.positionals === "at-most-one") {
      const positionals = args.filter((arg) => !arg.startsWith("-"));
      if (positionals.length > 1) return reject("unknown", "too many positional arguments (may write a file)");
    }
    return "read-only";
  }

  const result = evaluateArgs(args, { flags: policy.flags, forbidden: policy.forbidden });
  if (result.verdict === "unsafe") return reject("unsafe", result.detail);
  if (result.verdict === "unknown") return reject("unknown", result.detail);
  if (policy.positionals === "none" && result.positionals.length > 0) {
    return reject("unknown", `does not accept positional arguments (${result.positionals[0]})`);
  }
  if (policy.positionals === "at-most-one" && result.positionals.length > 1) {
    return reject("unknown", "too many positional arguments");
  }
  return "read-only";
}

function evaluateGit(
  args: readonly string[],
  reasons: string[],
  offending: string[],
): DialectVerdict {
  let index = 0;

  // 前缀：git 全局开关（--no-pager 等）；危险开关直接 unsafe
  while (index < args.length && args[index].startsWith("-")) {
    const flag = args[index];
    const dangerous = GIT_DANGEROUS_GLOBAL_FLAGS.some(
      (f) => flag === f || (f.length === 2 && flag.startsWith(f) && flag.length > 2),
    );
    if (dangerous) {
      reasons.push(`git: dangerous global flag ${flag}`);
      offending.push(`git ${flag}`);
      return "unsafe";
    }
    if (flag === "--version" || GIT_SAFE_GLOBAL_FLAGS.includes(flag)) {
      index++;
      continue;
    }
    reasons.push(`git: unknown global flag ${flag}`);
    offending.push(`git ${flag}`);
    return "unknown";
  }

  const subcommand = args[index];
  if (!subcommand) return "read-only"; // 裸 git：打印用法
  return applyPolicy(
    GIT_READONLY_SUBCOMMANDS[subcommand],
    args.slice(index + 1),
    `git ${subcommand}`,
    reasons,
    offending,
  );
}

/**
 * 取 git 段的子命令名：跳过无害的全局开关（`--no-pager` 等）与 `--version`。
 * 遇到危险/未知的全局开关返回 null（由 evaluateGit 负责给出 unsafe/unknown 结论）。
 */
export function gitSubcommandOf(args: readonly string[]): string | null {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    const flag = args[index];
    const dangerous = GIT_DANGEROUS_GLOBAL_FLAGS.some(
      (f) => flag === f || (f.length === 2 && flag.startsWith(f) && flag.length > 2),
    );
    if (dangerous) return null;
    if (flag !== "--version" && !GIT_SAFE_GLOBAL_FLAGS.includes(flag)) return null;
    index++;
  }
  return args[index] ?? null;
}

/**
 * "只认特定形态"的工具：这些命令本体是执行器（python 能跑任何脚本、docker 能起容器），
 * 白名单只认核验过的几种形态。物化到配置里时**展开成具体形态**（`python --version`），
 * 避免用户在列表里看到一个裸的 `python` 而误以为"任意参数都放行"。
 *
 * 候选形态会再过一遍分析器（`evaluatePosixArgv` 判 read-only 才收），所以这里写多了不会失真。
 */
const RESTRICTED_FORM_CANDIDATES: Record<string, readonly string[]> = {
  node: ["--version", "-v", "-V", "--help", "-h"],
  python: ["--version", "-v", "-V", "--help", "-h"],
  python3: ["--version", "-v", "-V", "--help", "-h"],
  pip: ["--version", "-V"],
  cargo: ["--version", "-V"],
  java: ["-version", "--version"],
  dotnet: ["--version", "--info", "--list-sdks", "--list-runtimes"],
  go: ["version"],
  npm: ["--version", "-v", "ls", "list"],
  docker: ["ps", "images", "version", "info", "inspect", "container ls", "container list"],
};

/**
 * 内置只读名单条目（供默认策略物化 / 漂移测试）。
 *
 * 条目是"命令前缀"：
 * - 普通命令 → 裸命令名（`cat`）：其后参数由本表的参数级核验把关
 * - `git` → `git <子命令>`
 * - 只认特定形态的工具 → 展开成具体形态（`python --version`、`docker ps`）
 */
export function posixReadOnlyEntries(): string[] {
  const entries = new Set<string>(ANY_ARGS_READ_ONLY);
  for (const name of Object.keys(POSIX_POLICIES)) {
    if (name === "git") continue; // git 由 evaluateGit 按子命令处理
    const forms = RESTRICTED_FORM_CANDIDATES[name];
    if (forms) {
      for (const form of forms) {
        const argv = [name, ...form.split(" ")];
        if (evaluatePosixArgv(argv).verdict === "read-only") entries.add(`${name} ${form}`);
      }
      continue;
    }
    entries.add(name);
  }
  for (const subcommand of Object.keys(GIT_READONLY_SUBCOMMANDS)) {
    entries.add(`git ${subcommand}`);
  }
  return [...entries].sort();
}

/**
 * 以 POSIX（Git Bash）语义判定单个命令片段（供 PowerShell 侧对"非 cmdlet 外部命令"回落复用）。
 */
export function evaluatePosixArgv(argv: readonly string[]): {
  verdict: DialectVerdict;
  reason: string;
} {
  const reasons: string[] = [];
  const offending: string[] = [];
  const [head, ...args] = argv;
  if (!head) return { verdict: "unknown", reason: "empty command segment" };

  const name = basenamePosix(head);
  const verdict =
    name === "git"
      ? evaluateGit(args, reasons, offending)
      : ANY_ARGS_READ_ONLY.includes(name)
        ? applyPolicy({ allowAnyArgs: true }, args, name, reasons, offending)
        : applyPolicy(POSIX_POLICIES[name], args, name, reasons, offending);

  return { verdict, reason: reasons.join("; ") };
}

/**
 * 以 POSIX（Git Bash）语义判定整条命令。
 */
export function analyzePosixCommand(command: string): DialectAnalysis {
  const { segments, problems } = scanCommand(command, "posix");
  const reasons = problems.map((p) => p.detail);
  const offending = problems.map((p) => p.detail);

  // 写重定向是"已知写"；其余结构性问题都是"不可核验"
  if (problems.some((p) => p.code === "write-redirect")) {
    return { verdict: "unsafe", reasons, offending };
  }
  if (problems.length > 0) {
    return { verdict: "unknown", reasons, offending };
  }
  if (segments.length === 0) {
    // 纯注释 / 纯空白的命令是无副作用的空操作
    return { verdict: "read-only", reasons: ["comments/whitespace only (no-op)"], offending: [] };
  }

  let worst: DialectVerdict = "read-only";
  for (const segment of segments) {
    const argv = segment.tokens.map((t) => t.text);
    const { verdict, reason } = evaluatePosixArgv(argv);
    if (reason) {
      reasons.push(reason);
      offending.push(segment.text);
    }
    if (verdict === "unsafe") return { verdict: "unsafe", reasons, offending };
    if (verdict === "unknown") worst = "unknown";
  }

  return { verdict: worst, reasons, offending };
}
