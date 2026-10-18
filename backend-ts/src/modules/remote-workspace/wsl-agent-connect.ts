/**
 * WSL 发行版工作区 — agent 注入与连接（wsl.exe 适配器）。
 *
 * 与 Docker 链路的同构性：目标发现/探测、注入、stdio 长连接、版本门禁（≥0.6.0）、
 * browse/握手等通用流程全部复用 cli-agent-install.ts 的共享内核；本文件只保留 WSL 特有的部分：
 *
 * - 仅 Windows 宿主可用（wsl.exe）；非 Windows 返回明确不可用（不抛错，供 UI 隐藏/提示）。
 * - 编码：wsl.exe 管理类输出默认 UTF-16LE（含 NUL），统一在 spawn env 设 WSL_UTF8=1 归一为
 *   UTF-8，解码仍保留 utf16le 兜底（老版本可能忽略该变量）。
 * - 注入：stdin 直传（`cat > file`，P0 实测 10MB sha256 双向一致）为主，`/mnt/<盘>` cp 兜底；
 *   落位用 tmp + `mv -f`（rename 替换 inode），避免覆盖正在执行的 agent 时命中 ETXTBSY。
 * - 生命周期：任何 wsl.exe 调用都会自动拉起已停止的发行版（无法规避，与用户在终端敲 wsl 一致）；
 *   本模块绝不 terminate/shutdown/unregister/安装/删除发行版。
 * - 长连接：`wsl.exe [-d <distro>] --exec <agent> --stdio --root <path> --perm <mode>`；
 *   stdin EOF → agent 自行退出（P0 实测无孤儿进程）。
 */
import { spawn } from "child_process";
import * as fs from "fs";
import { StreamRpcTransport } from "./rpc-stream-transport";
import type { RpcClient } from "./rpc";
import { MIN_STDIO_AGENT_VERSION } from "./agent-version";
import {
  AGENT_SUBDIR,
  assertDirInCliEnv,
  browseCliPath,
  ensureAgentInCliEnv,
  mapLinuxArch,
  startCliAgentStdio,
  type CliAgentEnv,
  type EnsureAgentResult,
} from "./cli-agent-install";

/** agent 安装目录候选基点（发行版内；$HOME 优先，见 wslAgentDirCandidates） */
export const WSL_AGENT_DIR_BASES = ["/tmp", "/var/tmp", "/dev/shm"];
/** 单次 wsl.exe 调用超时（管理/探测类） */
const WSL_CMD_TIMEOUT_MS = 30_000;
/** 发行版冷启动（Stopped → 首个命令）可能达数十秒，探测类调用单独放宽 */
const WSL_COLD_START_TIMEOUT_MS = 60_000;
/** 二进制注入（10MB 级）超时 */
const WSL_TRANSFER_TIMEOUT_MS = 120_000;

/** 发行版工作区所需的最低 agent 版本（与 stdio 门槛 0.6.0 共用同一常量；保留别名对称容器侧） */
export const MIN_AGENT_VERSION_FOR_WSL = MIN_STDIO_AGENT_VERSION;

export interface WslConnectionConfig {
  /** 连接类型判别字段（与 SSH/Docker 配置共同构成 RemoteConnectionConfig 联合类型） */
  kind: "wsl";
  /** WSL 发行版名（`wsl -l -v` 之一）；空 = 系统默认发行版（省略 -d） */
  distro: string;
  /** 发行版内工作目录（agent --root）；缺省用该发行版默认用户的 $HOME */
  path?: string;
  /** agent 权限模式：readonly | workspace | unrestricted（默认 workspace，发行版内强制） */
  perm?: string;
}

export interface WslRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface WslDistroInfo {
  name: string;
  /** Running / Stopped / ...（旧版 wsl.exe 走 -q 回退时为空） */
  state: string;
  /** WSL 版本：1 | 2（未知为 0） */
  version: number;
  isDefault: boolean;
}

export interface WslTargetInfo {
  /** 实际使用的发行版名（未配置时为占位描述） */
  distro: string;
  /** `uname -s`（应为 Linux） */
  os: string;
  /** `uname -m` 原始值（x86_64 / aarch64） */
  arch: string;
  goArch: "amd64" | "arm64";
  /** 发行版默认用户 */
  user: string;
  /** 默认用户 $HOME（path 未配置时用作 --root） */
  home: string;
}

/** WSL 连接仅在 Windows 宿主可用 */
export function isWslPlatformAvailable(platformName: string = process.platform): boolean {
  return platformName === "win32";
}

/**
 * wsl.exe 输出解码：管理类命令默认 UTF-16LE（含 NUL 字节），已归一时为 UTF-8。
 * 两种都兼容：Buffer 含 NUL 判为 UTF-16LE。
 */
export function decodeWslOutput(raw: Buffer | string | null | undefined): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  return raw.includes(0) ? raw.toString("utf16le") : raw.toString("utf8");
}

/**
 * `wsl.exe -l -v` 输出解析。
 * 列序 NAME / STATE / VERSION，默认发行版前缀 `*`；发行版名可能含空格 → 从右往左按列解析。
 * 表头（NAME ... VERSION）按“最后一列非数字”跳过；STATE 文本不做词表依赖（仅展示）。
 */
export function parseDistroList(text: string): WslDistroInfo[] {
  const out: WslDistroInfo[] = [];
  for (const raw of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const isDefault = /^\s*\*/.test(line);
    const rest = line.replace(/^\s*\*\s*/, "").trim();
    if (!rest) continue;
    const toks = rest.split(/\s+/);
    if (toks.length < 3) continue;
    const versionTok = toks[toks.length - 1];
    if (!/^\d+$/.test(versionTok)) continue; // 表头行（VERSION）在此跳过
    const state = toks[toks.length - 2];
    const name = toks.slice(0, -2).join(" ");
    if (!name) continue;
    out.push({ name, state, version: parseInt(versionTok, 10), isDefault });
  }
  return out;
}

/** `wsl.exe -l -q` 输出解析（旧版 wsl.exe 无 -v 时的回退；每行一个名称） */
export function parseDistroNames(text: string): string[] {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(" ")); // 回退路径下过滤掉说明性文案行（如"没有已安装的分发版"）
}

/** 组装 wsl.exe 参数（distro 为空时省略 -d，走系统默认发行版） */
export function buildWslArgs(
  config: Pick<WslConnectionConfig, "distro">,
  args: string[],
): string[] {
  const distro = config.distro?.trim();
  return distro ? ["-d", distro, ...args] : args;
}

/**
 * 运行一次性 wsl.exe 命令并捕获输出（管理/探测/注入共用）。
 * 超时/中止即杀本地客户端进程（发行版内进程随后因流关闭自行退出）。
 */
export function runWsl(
  config: Pick<WslConnectionConfig, "distro">,
  args: string[],
  opts: {
    input?: Buffer | string;
    timeoutMs?: number;
    signal?: AbortSignal;
    errorHint?: string;
  } = {},
): Promise<WslRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", buildWslArgs(config, args), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // 管理类命令输出归一为 UTF-8（老版本忽略该变量时由 decodeWslOutput 兜底）
      env: { ...process.env, WSL_UTF8: "1" },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(
        new Error(
          `wsl.exe 调用超时(${opts.timeoutMs ?? WSL_CMD_TIMEOUT_MS}ms)` +
            (opts.errorHint ? ` — ${opts.errorHint}` : ""),
        ),
      );
    }, opts.timeoutMs ?? WSL_CMD_TIMEOUT_MS);
    timer.unref?.();

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("wsl command aborted"));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", (err0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `wsl.exe 不可用（${err0.message}）— 请确认已安装 WSL（Windows 10 2004+ / Windows 11，可运行 wsl --install）`,
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: decodeWslOutput(Buffer.concat(out)),
        stderr: decodeWslOutput(Buffer.concat(err)),
      });
    });

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    } else {
      child.stdin?.end();
    }
  });
}

/** 在发行版内执行命令（`wsl.exe [-d x] --exec <argv...>`；需 shell 语义时显式传 sh -c） */
function wslExec(
  config: Pick<WslConnectionConfig, "distro">,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WslRunResult> {
  return runWsl(config, ["--exec", ...args], opts);
}

/** Windows 盘符路径 → WSL /mnt 路径（不可转换，如 UNC 路径，返回 null） */
export function toWslPath(winPath: string): string | null {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(String(winPath || ""));
  if (!m) return null;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

/** 发行版内 agent 安装目录候选：$HOME 优先（属主稳定），再退 /tmp 等（可能被 noexec/属主冲突） */
export function wslAgentDirCandidates(home: string): string[] {
  const h = (home || "").trim().replace(/\/+$/, "");
  const list: string[] = [];
  if (h) list.push(`${h}/${AGENT_SUBDIR}`);
  for (const base of WSL_AGENT_DIR_BASES) list.push(`${base}/${AGENT_SUBDIR}`);
  return list;
}

/** shell 单引号包裹（内嵌单引号转义；用于 sh -c 脚本里的路径） */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function lastLine(s: string): string {
  return (s || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
}

// ── 发行版列表（向导选择器用） ──

/**
 * 列出已安装的 WSL 发行版。
 * 非 Windows / 未安装 WSL 均返回 `available:false` + reason（不抛错，供 UI 隐藏入口并提示）。
 */
export async function listWslDistros(
  signal?: AbortSignal,
): Promise<{ available: boolean; reason?: string; distros: WslDistroInfo[] }> {
  if (!isWslPlatformAvailable()) {
    return { available: false, reason: "WSL 连接仅在 Windows 宿主上可用", distros: [] };
  }
  try {
    const r = await runWsl({ distro: "" }, ["-l", "-v"], { timeoutMs: WSL_CMD_TIMEOUT_MS, signal });
    if (r.code === 0) {
      const distros = parseDistroList(r.stdout);
      if (distros.length) return { available: true, distros };
      return {
        available: false,
        reason: '未检测到已安装的 WSL 发行版 — 可用 "wsl --install -d Ubuntu" 安装后重试',
        distros: [],
      };
    }
    // 旧版 wsl.exe（Windows 10 2004 之前）不支持 --verbose → 回退 -q 取名称（无状态列）
    const q = await runWsl({ distro: "" }, ["-l", "-q"], { timeoutMs: WSL_CMD_TIMEOUT_MS, signal });
    const names = q.code === 0 ? parseDistroNames(q.stdout) : [];
    if (names.length) {
      return {
        available: true,
        distros: names.map((name) => ({ name, state: "", version: 0, isDefault: false })),
      };
    }
    const detail = lastLine(r.stderr || r.stdout) || "wsl -l -v 失败";
    return { available: false, reason: `无法列出 WSL 发行版：${detail}`, distros: [] };
  } catch (err: any) {
    return { available: false, reason: err?.message || String(err), distros: [] };
  }
}

// ── 目标探测 ──

/** 发行版内一次性探针：OS / 架构 / 默认用户 / $HOME / sh 可用性（一次 wsl 调用五个字段） */
const WSL_PROBE_SCRIPT =
  "uname -s; echo ---; uname -m; echo ---; id -un; echo ---; printf '%s' \"$HOME\"; echo; echo ---; " +
  "command -v sh >/dev/null 2>&1 && echo sh-ok || echo sh-missing";

/**
 * 探测发行版：可用性（自动拉起已停止的发行版）+ 架构（选二进制）+ 默认用户与 $HOME。
 * 发行版不存在 / WSL 不可用时抛带操作指引的错误。
 */
export async function inspectWslTarget(
  config: WslConnectionConfig,
  signal?: AbortSignal,
): Promise<WslTargetInfo> {
  const distro = config.distro?.trim() || "";
  const ref = distro ? `'${distro}'` : "（默认发行版）";
  const r = await runWsl(config, ["--exec", "sh", "-c", WSL_PROBE_SCRIPT], {
    timeoutMs: WSL_COLD_START_TIMEOUT_MS,
    signal,
    errorHint: `发行版 ${ref} 不可用`,
  });
  if (r.code !== 0) {
    const detail = lastLine(r.stderr || r.stdout) || `wsl.exe 退出码 ${r.code}`;
    throw new Error(
      `无法连接 WSL 发行版 ${ref}：${detail}\n` +
        (distro
          ? `请确认发行版名正确（wsl -l -v），未安装的发行版可用 "wsl --install -d ${distro}" 安装`
          : `未安装任何发行版时可用 "wsl --install -d Ubuntu" 安装`),
    );
  }
  const [osRaw = "", archRaw = "", userRaw = "", homeRaw = "", shRaw = ""] = r.stdout
    .trim()
    .split(/\r?\n---\r?\n/)
    .map((s) => s.trim());
  if (!shRaw.includes("sh-ok")) {
    throw new Error(`发行版 ${ref} 内缺少 sh — 无法作为工作区（agent 的 execute/browse 依赖 sh）`);
  }
  if (osRaw && osRaw.toLowerCase() !== "linux") {
    throw new Error(`发行版 ${ref} 报告内核类型为 ${osRaw}（需要 Linux）`);
  }
  const mapped = mapLinuxArch(archRaw.toLowerCase());
  if (mapped.ok === false) {
    throw new Error(`不支持 WSL 发行版架构 ${archRaw}（需要 x86_64 或 aarch64）`);
  }
  return {
    distro: distro || "默认发行版",
    os: osRaw || "Linux",
    arch: archRaw,
    goArch: mapped.goArch,
    user: userRaw,
    home: homeRaw || "/",
  };
}

// ── 内核适配器（WSL 特有的执行/注入/长连接实现） ──

/** 注入落位：tmp + mv -f（rename 替换 inode，不命中运行中二进制的 ETXTBSY） */
async function finalizeInjection(
  config: WslConnectionConfig,
  tmpPath: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const mv = await wslExec(config, ["mv", "-f", tmpPath, destPath], {
    timeoutMs: 15_000,
    signal,
  });
  if (mv.code !== 0) {
    throw new Error(`落位失败（mv -f）：${lastLine(mv.stderr) || `退出码 ${mv.code}`}`);
  }
}

async function readRemoteSize(
  config: WslConnectionConfig,
  remotePath: string,
  signal?: AbortSignal,
): Promise<number> {
  const r = await wslExec(config, ["sh", "-c", `wc -c < ${sq(remotePath)}`], {
    timeoutMs: 30_000,
    signal,
  });
  const n = parseInt((r.stdout || "").trim(), 10);
  return Number.isFinite(n) ? n : -1;
}

/**
 * 把本地二进制注入发行版目标路径。
 * 主通道 stdin 直传（`cat > tmp`，P0 实测 10MB 字节保真）；失败时回退 `/mnt/<盘>` cp
 * （单一文件系统语义：先写 tmp、校验字节数、再 mv 落位）。
 */
async function injectBinaryIntoWsl(
  config: WslConnectionConfig,
  localPath: string,
  destPath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const tmpPath = `${destPath}.tmp`;
  const localBuf = fs.readFileSync(localPath);
  const errors: string[] = [];

  // 1) stdin 直传（不依赖盘符挂载，任何发行版环境普适）
  try {
    const w = await runWsl(config, ["--exec", "sh", "-c", `cat > ${sq(tmpPath)}`], {
      input: localBuf,
      timeoutMs: WSL_TRANSFER_TIMEOUT_MS,
      signal: opts.signal,
    });
    const size = w.code === 0 ? await readRemoteSize(config, tmpPath, opts.signal) : -1;
    if (size === localBuf.length) {
      await finalizeInjection(config, tmpPath, destPath, opts.signal);
      return;
    }
    errors.push(
      `stdin 直传校验失败（exit=${w.code}, size=${size}/${localBuf.length}${w.stderr ? `: ${lastLine(w.stderr)}` : ""}）`,
    );
  } catch (err: any) {
    errors.push(`stdin 直传异常：${err?.message || err}`);
  }

  // 2) 兜底：/mnt/<盘> 直接 cp（需要该盘符在发行版内已挂载）
  const wslSrc = toWslPath(localPath);
  if (wslSrc) {
    try {
      const r = await wslExec(
        config,
        ["sh", "-c", `test -r ${sq(wslSrc)} && cp -- ${sq(wslSrc)} ${sq(tmpPath)} && wc -c < ${sq(tmpPath)}`],
        { timeoutMs: WSL_TRANSFER_TIMEOUT_MS, signal: opts.signal },
      );
      const size = parseInt((r.stdout || "").trim().split(/\r?\n/).pop() || "", 10);
      if (r.code === 0 && size === localBuf.length) {
        await finalizeInjection(config, tmpPath, destPath, opts.signal);
        return;
      }
      errors.push(
        `/mnt cp 失败（exit=${r.code}, size=${Number.isFinite(size) ? size : "?"}/${localBuf.length}${r.stderr ? `: ${lastLine(r.stderr)}` : ""}）`,
      );
    } catch (err: any) {
      errors.push(`/mnt cp 异常：${err?.message || err}`);
    }
  } else {
    errors.push(`本地路径无法转换为 /mnt 路径：${localPath}`);
  }

  // 尽力清理残留 tmp 文件（避免半成品占位）
  try {
    await wslExec(config, ["rm", "-f", tmpPath], { timeoutMs: 15_000 });
  } catch {
    /* best-effort */
  }
  throw new Error(`agent 二进制注入失败：${errors.join("；")}`);
}

const WSL_AGENT_UNSUPPORTED_HINT =
  "请确认发行版的 $HOME 与 /tmp 可写；无 sh 的裁剪发行版暂不支持（可改用 SSH 或 Docker 连接）。";
const WSL_DIR_MISSING_HINT =
  "请在连接配置中改选一个已存在的目录（发行版内路径，如 /home/<user>/proj，或 Windows 盘挂载路径如 /mnt/d/proj）";

/** 基础环境适配器：执行/注入/长连接（候选目录由 wslEnv 按目标 $HOME 补全） */
function wslBaseEnv(config: WslConnectionConfig, distroName: string): CliAgentEnv {
  const ref = `'${distroName}'`;
  return {
    noun: "WSL 发行版",
    targetRef: ref,
    installErrorPrefix: `无法在 WSL 发行版 ${ref} 内安装 agent`,
    unsupportedHint: WSL_AGENT_UNSUPPORTED_HINT,
    dirMissingHint: WSL_DIR_MISSING_HINT,
    exec: (args, opts) => wslExec(config, args, opts),
    agentDirCandidates: () => [],
    injectBinary: (localPath, destPath, opts) =>
      injectBinaryIntoWsl(config, localPath, destPath, opts),
    // 不设 killStaleAgents：注入走 tmp+mv，不会命中运行中二进制的 ETXTBSY
    openAgentStdio: (binaryPath, rootPath, perm) =>
      StreamRpcTransport.spawn(
        "wsl.exe",
        buildWslArgs(config, [
          "--exec",
          binaryPath,
          "--stdio",
          "--root",
          rootPath,
          "--perm",
          perm,
        ]),
        { label: "stdio pipe" },
      ),
  };
}

function wslEnv(config: WslConnectionConfig, target: WslTargetInfo): CliAgentEnv {
  return {
    ...wslBaseEnv(config, target.distro),
    agentDirCandidates: () => wslAgentDirCandidates(target.home),
  };
}

// ── agent 注入 ──

/** 确保发行版内存在与期望版本一致的 agent 二进制（通用流程见 cli-agent-install.ts） */
export async function ensureAgentInWsl(
  config: WslConnectionConfig,
  target: WslTargetInfo,
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<EnsureAgentResult> {
  return ensureAgentInCliEnv(wslEnv(config, target), target.goArch, opts);
}

/** 校验发行版内目录存在（path 配置的工作目录） */
export async function assertDirInWsl(
  config: WslConnectionConfig,
  target: WslTargetInfo,
  dir: string,
): Promise<void> {
  return assertDirInCliEnv(wslEnv(config, target), dir);
}

// ── 连接 ──

export interface WslAgentConnectResult {
  rpc: RpcClient;
  transport: StreamRpcTransport;
  target: WslTargetInfo;
  agentDir: string;
  binaryPath: string;
  version: string;
  /** 生效的工作目录基准（path 未配置时取默认用户 $HOME） */
  rootPath: string;
}

/**
 * 部署（如需）+ 建立 stdio 长连接。
 * 返回的 RpcClient 与 SSH/Docker 链路语义完全一致（超时/心跳/cancel/shutdown 推送）。
 */
export async function connectWslAgent(
  config: WslConnectionConfig,
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<WslAgentConnectResult> {
  const target = await inspectWslTarget(config, opts.signal);
  opts.onLog?.(
    `WSL distro '${target.distro}' is available (${target.os}/${target.arch}${target.user ? `, user ${target.user}` : ""})`,
  );

  const ensured = await ensureAgentInWsl(config, target, opts);

  const rootPath = (config.path || target.home || "/").trim() || "/";
  await assertDirInWsl(config, target, rootPath);

  const started = await startCliAgentStdio(wslEnv(config, target), {
    binaryPath: ensured.binaryPath,
    rootPath,
    perm: config.perm,
    expectedVersion: ensured.version,
    onLog: opts.onLog,
    signal: opts.signal,
  });

  return {
    rpc: started.rpc,
    transport: started.transport,
    target,
    agentDir: ensured.agentDir,
    binaryPath: ensured.binaryPath,
    version: ensured.version,
    rootPath,
  };
}

// ── 供向导使用的辅助（测试连接 / 目录浏览） ──

/**
 * 发行版内目录浏览（向导第 2 步）。
 * 复用同一 POSIX browse 命令（ls -la + awk），经 `wsl.exe --exec sh -c` 执行。
 */
export async function browseWslPath(
  config: WslConnectionConfig,
  buildBrowseCommand: (dirPath: string) => string,
  parseBrowseOutput: (raw: string) => { path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] },
  dirPath: string,
  signal?: AbortSignal,
): Promise<{ path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] }> {
  const distroName = config.distro?.trim() || "默认发行版";
  return browseCliPath(
    wslBaseEnv(config, distroName),
    buildBrowseCommand,
    parseBrowseOutput,
    dirPath,
    signal,
  );
}

/** 连接测试（向导第 1 步）：探测 + 注入 + 校验工作目录 + 握手，随后关闭 */
export async function testWslConnection(
  config: WslConnectionConfig,
  opts: { downloadUrl?: string; latestVersionUrl?: string; signal?: AbortSignal } = {},
): Promise<{ success: boolean; error?: string; log?: string }> {
  const log: string[] = [];
  try {
    const conn = await connectWslAgent(config, { ...opts, onLog: (l) => log.push(l) });
    log.push("Connection OK (stdio agent handshake succeeded).");
    conn.rpc.close();
    return { success: true, log: log.join("\n") };
  } catch (err: any) {
    log.push(`Error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err), log: log.join("\n") };
  }
}

/** 部署验证（向导第 4 步）：注入 + 校验工作目录，等价 Docker 的 verifyAndDeployDockerAgent */
export async function verifyAndDeployWslAgent(
  config: WslConnectionConfig,
  downloadUrl: string,
  latestVersionUrl: string,
  onLog?: (line: string) => void,
  signal?: AbortSignal,
): Promise<{ success: boolean; installed: boolean; version: string; log: string[] }> {
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    onLog?.(line);
  };
  try {
    const target = await inspectWslTarget(config, signal);
    push(`WSL distro '${target.distro}' is available (${target.os}/${target.arch}, user ${target.user})`);
    const ensured = await ensureAgentInWsl(config, target, {
      downloadUrl,
      latestVersionUrl,
      onLog: onLog,
      signal,
    });
    push(`Agent v${ensured.version} ready at ${ensured.binaryPath}`);
    // 目录预校验：连接配置的 path 就是 agent 的 --root（与 SSH/Docker 部署验证一致）
    const rootPath = (config.path || target.home || "/").trim() || "/";
    await assertDirInWsl(config, target, rootPath);
    push(`Workspace path exists in distro: ${rootPath}`);
    return { success: true, installed: !ensured.injected, version: ensured.version, log };
  } catch (err: any) {
    push(`Deployment failed: ${String(err?.message || err).split("\n")[0]}`);
    return { success: false, installed: false, version: "", log };
  }
}
