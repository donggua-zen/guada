/**
 * AgentWorkspaceProvider — WorkspaceProvider 的"agent 后端"实现（SSH 远端与 Docker 容器共用）。
 *
 * 通过 RemoteAgent（JSON-RPC → 目标端 guada-agent）执行文件/搜索/进程操作；
 * 传输差异（SSH 隧道 WebSocket / 容器 docker exec stdio）由连接层统一封装，
 * 本类只做无状态的协议映射，实例可按调用即用即弃。
 * scheme 由连接类型传入（"ssh" / "docker"），供需要区分目标形态的调用方使用。
 *
 * 已知语义差异（工具层负责对齐，见 file.plugin 远程分支）：
 * - replaceInFile：agent 原语为"全部替换"且不做 CRLF 归一；工具层经 readFile+writeFile
 *   实现与本地一致的"首次替换 + 行尾还原"语义。
 * - grep：agent 端为 POSIX grep -rn（BRE），JS 正则的高级语法（\d 等）不适用；
 *   输出无函数名上下文后缀。
 * - watch：agent 已注册 fsnotify 但事件推送回路未实现，本实现返回 no-op。
 */
import type {
  WorkspaceProvider,
  FileStat,
  DirEntry,
  ReplaceResult,
  FileChangeEvent,
  WatchOptions,
  ExecuteOptions,
} from "../../common/workspace/workspace-provider.interface";
import { RemoteAgent } from "./remote-workspace-agent-manager";
import { isUnknownMethodError } from "./rpc";
import { MIN_REMOTE_JOB_AGENT_VERSION, versionAtLeast } from "./agent-version";
import type { JobOutputRead, JobReadOptions } from "../jobs/job.types";

type ProcessExecuteResult = import("../../modules/shell/process-manager.service").ExecuteResult;
type PollResult = import("../../modules/shell/process-manager.service").PollResult;
type ProcessStatus = import("../../modules/shell/process-manager.service").ProcessStatus;
type ProcessListEntry = import("../../modules/shell/process-manager.service").ProcessListEntry;

/** 远程进程 ID 前缀：完整形态为 "r:<连接名>:<pid>"，与本地 ProcessManager 进程 ID 区分 */
export const REMOTE_PROCESS_ID_PREFIX = "r:";

/** 构造带连接名前缀的远程进程 ID */
export function buildRemoteProcessId(connectionName: string, pid: string): string {
  return `${REMOTE_PROCESS_ID_PREFIX}${connectionName}:${pid}`;
}

/** 解析远程进程 ID（"r:<连接名>:<pid>"）；非远程 ID 返回 null */
export function parseRemoteProcessId(
  processId: string,
): { connectionName: string; pid: string } | null {
  if (!processId.startsWith(REMOTE_PROCESS_ID_PREFIX)) return null;
  const rest = processId.slice(REMOTE_PROCESS_ID_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx === -1) return { connectionName: "", pid: rest };
  return { connectionName: rest.slice(0, idx), pid: rest.slice(idx + 1) };
}

/** 远程 job_read 读取结果（offset 为远端原始日志字节） */
export interface RemoteJobRead extends JobOutputRead {
  status: string;
  exitCode: number | null;
  jobId?: string;
  uptimeMs: number;
}

/** 远端 agent 内存中的后台进程元数据 */
export interface RemoteProcessInfo {
  processId: string;
  jobId?: string;
  status: string;
  exitCode: number | null;
  logFile?: string;
  startTime?: number;
  uptimeMs: number;
}

export class AgentWorkspaceProvider implements WorkspaceProvider {
  readonly scheme: string;

  constructor(
    private readonly agent: RemoteAgent,
    private readonly connectionName = "",
    /** 连接类型（"ssh" / "docker"）；缺省 ssh 保持既有调用方语义 */
    scheme = "ssh",
  ) {
    this.scheme = scheme;
  }

  // ── Lifecycle（连接由 RemoteAgentManager 管理，这里无操作）──
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  /** 0.7+ agent 才提供 process_done / readProcess / killAllProcesses。 */
  get supportsRemoteJobs(): boolean {
    return versionAtLeast(
      this.agent.agentVersion,
      MIN_REMOTE_JOB_AGENT_VERSION,
    );
  }

  /** 远程相对路径 → 远端绝对路径（posix 语义；绝对路径原样返回） */
  resolvePath(p: string): string {
    return this.agent.resolveRemotePath(p);
  }

  // ── File operations ──

  readFile(path: string, opts?: { encoding?: string }): Promise<string | Buffer> {
    return this.agent.readFileRaw(path, opts?.encoding);
  }

  async writeFile(
    path: string,
    content: string | Buffer,
    opts?: { encoding?: string },
  ): Promise<void> {
    if (Buffer.isBuffer(content)) {
      // 二进制内容走分块上传（uploadStart/Chunk/End）
      const absPath = this.agent.resolveRemotePath(path);
      await this.agent.uploadBuffer(absPath, content);
      return;
    }
    await this.agent.writeFileRaw(path, content, opts?.encoding);
  }

  async readFileRange(path: string, offset: number, length: number): Promise<Buffer> {
    return this.agent.readFileRangeRaw(path, offset, length);
  }

  stat(path: string): Promise<FileStat> {
    return this.agent.stat(path);
  }

  readdir(path: string): Promise<DirEntry[]> {
    return this.agent.readdir(path);
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.agent.mkdir(path, { recursive: opts?.recursive ?? true });
  }

  async unlink(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.agent.unlink(path, { recursive: opts?.recursive ?? true });
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this.agent.rename(oldPath, newPath);
  }

  /**
   * 就地文本替换（agent 原语：全部替换、无 CRLF 归一）。
   * 与本地语义一致的编辑请走工具层的 readFile+writeFile 路径。
   */
  replaceInFile(
    path: string,
    oldText: string,
    newText: string,
    _opts?: { encoding?: string },
  ): Promise<ReplaceResult> {
    return this.agent.replaceInFile(path, oldText, newText);
  }

  // ── Search ──

  /**
   * 远端 grep：主路径原生 grep RPC（agent >= 0.5.0，RE2 语法、相对路径行）；
   * 旧版 agent（unknown method）降级 execute 原语执行 shell grep（grepViaShell）。
   */
  async grep(
    pattern: string,
    opts: { path: string; maxResults?: number; ignore?: string[] },
  ): Promise<string[]> {
    try {
      return await this.agent.grepRaw(
        pattern,
        opts.path,
        opts.maxResults ?? 50,
        opts.ignore,
      );
    } catch (e: any) {
      if (!isUnknownMethodError(e)) throw e;
      return this.grepViaShell(pattern, opts);
    }
  }

  /** 旧版 agent 降级：execute 原语执行 grep -rn（BRE 语义），--exclude-dir 剪枝 + head 截断 */
  private async grepViaShell(
    pattern: string,
    opts: { path: string; maxResults?: number; ignore?: string[] },
  ): Promise<string[]> {
    const maxResults = opts.maxResults ?? 50;
    const ignore = opts.ignore || [];
    const caseFlag = pattern === pattern.toLowerCase() ? "-i" : "";
    const excludeDirs = [...new Set(ignore.map(extractPruneDir).filter(Boolean))] as string[];
    const parts = ["grep", "-rn", caseFlag];
    for (const d of excludeDirs) parts.push(`--exclude-dir=${shellQuote(d)}`);
    parts.push("--", shellQuote(pattern), shellQuote(opts.path));
    const cmd = `${parts.join(" ")} 2>/dev/null | head -n ${maxResults}`;
    const result = await this.agent.executeRaw(cmd, { timeoutMs: 60000 });
    const out = (result.output || "").replace(/\n$/, "");
    return out ? out.split("\n") : [];
  }

  /**
   * 远端 glob：主路径原生 glob RPC（agent >= 0.5.0，服务端模式匹配）；
   * 旧版 agent（unknown method）降级 find|wc 模拟（globViaFind）。
   */
  async glob(
    pattern: string,
    opts: { cwd: string; ignore?: string[]; limit?: number; deep?: number },
  ): Promise<{ path: string; size: number }[]> {
    try {
      const r = await this.agent.globRaw(
        pattern,
        opts.cwd,
        opts.ignore,
        opts.limit ?? 100,
        opts.deep,
      );
      return r.files;
    } catch (e: any) {
      if (!isUnknownMethodError(e)) throw e;
      return this.globViaFind(pattern, opts);
    }
  }

  /** 旧版 agent 降级：经 execute 原语用 `find | wc -c` 枚举 + Node 侧正则过滤 */
  private async globViaFind(
    pattern: string,
    opts: { cwd: string; ignore?: string[]; limit?: number; deep?: number },
  ): Promise<{ path: string; size: number }[]> {
    const limit = opts.limit ?? 100;
    const cwd = opts.cwd.replace(/\/$/, "");
    const plan = planFind(pattern, cwd, opts.deep);
    if (!plan) return [];

    const cmd = plan.staticFile
      ? `wc -c ${shellQuote(plan.staticFile)}`
      : buildFindCommand(plan, opts.ignore || []);
    const result = await this.agent.executeRaw(cmd, { timeoutMs: 60000 });
    const entries = parseWcOutput(result.output || "");

    // wc 输出的路径为远端绝对路径，剥去 cwd 前缀还原为相对路径
    const cwdPrefix = `${cwd}/`;

    // Node 侧完整 glob 语义过滤（忽略清单 + 模式精确匹配）
    const regexes = expandBraces(pattern).map(globToRegex);
    const ignoreRegexes = (opts.ignore || []).flatMap((p) =>
      expandBraces(p).map(globToRegex),
    );
    const matched: { path: string; size: number }[] = [];
    for (const entry of entries) {
      if (matched.length >= limit) break;
      if (!entry.path.startsWith(cwdPrefix)) continue;
      const rel = entry.path.slice(cwdPrefix.length);
      if (ignoreRegexes.some((re) => re.test(rel))) continue;
      if (!regexes.some((re) => re.test(rel))) continue;
      matched.push({ path: rel, size: entry.size });
    }
    return matched;
  }

  // ── File watching（agent 端事件推送回路未实现，Phase 1 no-op）──
  watch(
    _paths: string[],
    _opts: WatchOptions,
    _callback: (event: FileChangeEvent) => void,
  ): () => void {
    return () => {};
  }

  // ── Process execution ──

  /**
   * 远端命令执行。超时转后台语义与本地 ProcessManager 对齐：
   * agent 前台超时（默认 60s）自动转后台进程，输出落远端日志文件。
   * 返回的 processId 带 "r:" 前缀与本地进程 ID 区分。
   */
  async execute(
    command: string,
    _cwd: string,
    opts: ExecuteOptions,
  ): Promise<ProcessExecuteResult> {
    if (opts.background && !this.supportsRemoteJobs) {
      throw new Error(
        `Remote agent is too old for background jobs (requires >= ${MIN_REMOTE_JOB_AGENT_VERSION}, got ${this.agent.agentVersion || "unknown"}). Reconnect/upgrade the agent and retry.`,
      );
    }
    const timeoutMs = opts.timeout ?? 60000;
    const r = await this.agent.executeRaw(command, {
      timeoutMs,
      signal: opts.abortSignal,
      background: opts.background,
      encoding: opts.encoding,
    });
    const base = {
      output: r.output || "",
      exitCode: r.exitCode,
      uptimeMs: r.uptimeMs,
      waitMs: r.uptimeMs,
    };
    if (r.kind === "completed") {
      return {
        kind: "completed",
        ...base,
        processStatus: "completed" as const,
        ...(r.truncated === true ? { truncated: true, logFilePath: r.logFile } : {}),
      };
    }
    // backgrounded（显式后台或超时转后台）
    return {
      kind: "backgrounded",
      ...base,
      processId: r.processId
        ? buildRemoteProcessId(this.connectionName, r.processId)
        : undefined,
      jobId: r.jobId as any,
      logFilePath: r.logFile,
      ...(r.truncated === true ? { truncated: true } : {}),
    };
  }

  async poll(
    processId: string,
    timeoutMs: number,
    abortSignal?: AbortSignal,
    encoding?: string,
  ): Promise<PollResult | null> {
    const parsed = parseRemoteProcessId(processId);
    if (!parsed) return null;
    const r = await this.agent.pollRaw(parsed.pid, timeoutMs, abortSignal, encoding);
    if (!r) return null;
    return {
      processId,
      status: r.status,
      exitCode: r.exitCode,
      output: r.output || "",
      waitMs: r.waitMs ?? 0,
      uptimeMs: r.uptimeMs,
      ...(r.truncated === true ? { truncated: true, logFilePath: r.logFile } : {}),
    } as PollResult;
  }

  /** 非破坏性读取远端后台进程日志；offset=-1 表示尾部。 */
  async readProcess(
    processId: string,
    opts: JobReadOptions = {},
    encoding?: string,
  ): Promise<RemoteJobRead> {
    const parsed = parseRemoteProcessId(processId);
    if (!parsed) throw new Error(`Not a remote process id: ${processId}`);
    if (!this.supportsRemoteJobs) {
      throw new Error(
        `Remote agent is too old for job output (requires >= ${MIN_REMOTE_JOB_AGENT_VERSION}).`,
      );
    }
    const r = await this.agent.readProcessRaw(
      parsed.pid,
      { offset: opts.offset ?? -1, maxBytes: opts.maxBytes },
      encoding,
    );
    return {
      text: r.output || "",
      offset: r.offset,
      nextOffset: r.nextOffset,
      size: r.size,
      truncated: !!r.truncated,
      logFilePath: r.logFile,
      status: r.status,
      exitCode: r.exitCode,
      jobId: r.jobId,
      uptimeMs: r.uptimeMs,
    };
  }

  async listProcesses(): Promise<RemoteProcessInfo[]> {
    if (!this.supportsRemoteJobs) return [];
    const rows = await this.agent.listProcessesRaw();
    return rows.map((r) => ({
      processId: buildRemoteProcessId(this.connectionName, String(r.processId)),
      jobId: r.jobId,
      status: r.status,
      exitCode: r.exitCode ?? null,
      logFile: r.logFile,
      startTime: r.startTime,
      uptimeMs: r.uptimeMs ?? 0,
    }));
  }

  async killAllProcesses(): Promise<number> {
    if (!this.supportsRemoteJobs) return 0;
    const result = await this.agent.killAllProcessesRaw();
    return result.killed ?? 0;
  }

  writeToStdin(processId: string, text: string): void {
    const parsed = parseRemoteProcessId(processId);
    if (!parsed) return;
    void this.agent.writeStdinRaw(parsed.pid, text);
  }

  kill(processId: string): ProcessStatus | null {
    // agent kill RPC 为异步请求，包装为同步语义：发出终止即视为 killed
    const parsed = parseRemoteProcessId(processId);
    if (!parsed) return null;
    void this.agent.killRaw(parsed.pid).catch(() => {});
    return "killed";
  }

  listBySession(_sessionId: string): ProcessListEntry[] {
    // 远端进程表按 agent 连接隔离（会话级进程），无需按会话列出
    return [];
  }

  async drainCompleted(encoding?: string): Promise<PollResult[]> {
    const rows = await this.agent.drainCompletedRaw(encoding);
    return rows.map((r) => ({
      processId: buildRemoteProcessId(this.connectionName, r.processId),
      status: r.status,
      output: r.output || "",
      exitCode: r.exitCode,
      uptimeMs: r.uptimeMs,
      ...(r.truncated === true ? { truncated: true, logFilePath: r.logFile } : {}),
    })) as PollResult[];
  }
}

// ── 进程 ID 命名空间（buildRemoteProcessId / parseRemoteProcessId 见文件头）──

// ── find 命令构造（远端 glob）──

interface FindPlan {
  /** find 起始目录（绝对路径） */
  startDir: string;
  /** 全静态模式：目标文件的绝对路径（直接 wc -c，不走 find） */
  staticFile?: string;
  /** 文件名模式（已展开花括号；空 = 仅目录枚举） */
  namePatterns: string[];
  /** find -maxdepth（undefined = 不限） */
  maxdepth?: number;
}

/** 花括号展开：src.{a,b} → [src.a, src.b] */
function expandBraces(pattern: string): string[] {
  const m = pattern.match(/\{([^{}]+)\}/);
  if (!m) return [pattern];
  const [full, body] = m;
  const out: string[] = [];
  for (const alt of body.split(",")) {
    out.push(...expandBraces(pattern.replace(full, alt)));
  }
  return out;
}

/** fast-glob 风格模式 → 精确正则（** 跨段、* 单段、? 单字符） */
function globToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * 将 glob 模式拆解为 find 计划。
 * 静态前缀段（无通配符）作为 find 起始目录缩小枚举范围；无法解析时返回 null。
 */
function planFind(pattern: string, cwd: string, deep?: number): FindPlan | null {
  const norm = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = norm.split("/").filter((s) => s && s !== ".");
  if (segments.length === 0) return null;

  const hasGlobChar = (s: string) => /[*?[{]/.test(s);
  let i = 0;
  while (i < segments.length && !hasGlobChar(segments[i])) i++;
  const staticSegments = segments.slice(0, i);
  const rest = segments.slice(i);

  // 模式全静态（无通配符）：当作单文件查询，直接 wc -c
  if (rest.length === 0) {
    return {
      startDir: cwd,
      staticFile: `${cwd}/${staticSegments.join("/")}`,
      namePatterns: [],
    };
  }

  const recursive = rest.some((s) => s === "**" || s.startsWith("**"));
  const filePattern = rest[rest.length - 1];

  let maxdepth: number | undefined;
  if (deep !== undefined) {
    maxdepth = deep; // 与 fast-glob deep 语义一致（1=仅当前目录）
  } else if (!recursive) {
    maxdepth = rest.length;
  }

  return {
    startDir: staticSegments.length
      ? `${cwd}/${staticSegments.join("/")}`
      : cwd,
    namePatterns: expandBraces(filePattern).filter((p) => p !== "**"),
    maxdepth,
  };
}

/** shell 单引号包裹（内容内不允许单引号，出现即拒绝以防注入） */
function shellQuote(s: string): string {
  if (s.includes("'")) {
    throw new Error(`Unsupported agent (') in pattern/path: ${s}`);
  }
  return `'${s}'`;
}

/** 从 fast-glob 风格的目录忽略模式中提取目录名（供 find -prune / grep --exclude-dir） */
function extractPruneDir(ig: string): string | null {
  const m = ig.match(/^\*\*\/([^\/]+)\/\*\*$/);
  return m ? m[1] : null;
}

function buildFindCommand(plan: FindPlan, ignore: string[]): string {
  const parts = ["find", shellQuote(plan.startDir)];
  if (plan.maxdepth !== undefined) parts.push(`-maxdepth ${plan.maxdepth}`);

  // 目录剪枝：从 "**/node_modules/**" 形态的忽略清单提取目录名，
  // 避免枚举 node_modules/.git 等大目录（其余形态交由 Node 侧正则过滤）
  const pruneDirs = new Set<string>();
  for (const ig of ignore) {
    const d = extractPruneDir(ig);
    if (d) pruneDirs.add(d);
  }
  if (pruneDirs.size > 0) {
    const prunePaths = [...pruneDirs].map((d) => shellQuote(`*/${d}`));
    parts.push(`\\( ${prunePaths.map((p) => `-path ${p}`).join(" -o ")} \\) -prune -o`);
  }

  parts.push("-type f");
  if (plan.namePatterns.length > 0) {
    const names = plan.namePatterns.map((p) => `-name ${shellQuote(p)}`);
    parts.push(
      names.length === 1 ? names[0] : `\\( ${names.join(" -o ")} \\)`,
    );
  }
  // wc -c 逐文件输出 "size path"（{} + 空匹配时不执行，避免 xargs 空输入挂起）
  parts.push("-exec wc -c {} +");
  return parts.join(" ");
}

/** 解析 `wc -c` 输出行（"  <size> <path>"；过滤聚合行 "total"） */
function parseWcOutput(output: string): { path: string; size: number }[] {
  const entries: { path: string; size: number }[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const filePath = m[2];
    if (filePath === "total") continue; // wc 的聚合行
    entries.push({ path: filePath, size: parseInt(m[1], 10) || 0 });
  }
  return entries;
}
