/**
 * cli-agent-install.ts — 「类 POSIX CLI 目标」（Docker 容器 / WSL 发行版）内 agent 注入与连接的共享内核。
 *
 * Docker 与 WSL 的链路差异只有三处：命令执行前缀（`docker exec` / `wsl.exe --exec`）、
 * 二进制注入方式（`docker cp` / stdin 直传 + `/mnt` cp 兜底）、长连接 spawn 参数。
 * 其余流程——候选目录探测、stdio 版本下限门禁（≥0.6.0）、注入后复验、stdio 握手校验、
 * 失败聚合与 stderr 尾诊断——在此单点实现，避免两份实现日后漂移（见 docs/wsl工作区方案.md §复用边界）。
 */
import { Logger } from "@nestjs/common";
import { RpcClient } from "./rpc";
import { StreamRpcTransport } from "./rpc-stream-transport";
import { ensureLocalBinary, fetchLatestVersion } from "./agent-deploy";
import { MIN_STDIO_AGENT_VERSION, versionAtLeast } from "./agent-version";

const logger = new Logger("CliAgentInstall");

/** agent 安装子目录与文件名（容器与发行版内一致） */
export const AGENT_SUBDIR = ".guada-agent";
export const AGENT_BINARY = "guada-agent";

export interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 目标环境适配器：由 docker-agent-connect / wsl-agent-connect 各自实现 */
export interface CliAgentEnv {
  /** 目标名词（错误/日志文案用），如 `容器` / `WSL 发行版` */
  readonly noun: string;
  /** 目标引用（含引号），如 `'guada-dev'` / `'Ubuntu-22.04'` */
  readonly targetRef: string;
  /** 注入失败聚合错误的首行，如 `无法在容器 'x' 内安装 agent` */
  readonly installErrorPrefix: string;
  /** 注入失败聚合错误的末行提示（目标环境相关） */
  readonly unsupportedHint: string;
  /** 工作目录不存在时的提示（目标环境相关） */
  readonly dirMissingHint: string;
  /** 在目标内一次性执行命令（argv 直传；需 shell 语义时调用方显式传 sh -c） */
  exec(args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CliRunResult>;
  /** 目标内 agent 安装目录候选（绝对路径，按序探测） */
  agentDirCandidates(): string[];
  /** 注入本地二进制到目标路径（覆盖语义；调用方随后统一 chmod 755） */
  injectBinary(localPath: string, destPath: string, opts?: { signal?: AbortSignal }): Promise<void>;
  /** 可选：注入前清场残留 agent（Docker 用 pkill；WSL 以 tmp+mv 落位，无需清场） */
  killStaleAgents?(): Promise<void>;
  /** 打开 agent stdio 长连接（各适配器拼自己的 CLI 前缀与参数） */
  openAgentStdio(binaryPath: string, rootPath: string, perm: string): StreamRpcTransport;
}

/** 目标内 agent 版本输出解析（`<bin> --version` → "0.6.0"；异常输出视为不可用） */
export function parseAgentVersionOutput(raw: string): string {
  const v = (raw || "").trim();
  // 版本号形如 0.6.0；异常输出（如 shell 报错混入）视为不可用
  return /^\d+\.\d+\.\d+/.test(v) ? v.split("\n")[0].trim() : "";
}

/** 读取目标内 agent 版本；不存在/不可执行返回 ""（不抛错） */
export async function getAgentVersionInCliEnv(
  env: CliAgentEnv,
  binaryPath: string,
): Promise<string> {
  try {
    const r = await env.exec([binaryPath, "--version"], { timeoutMs: 15_000 });
    if (r.code !== 0) return "";
    return parseAgentVersionOutput(r.stdout);
  } catch {
    return "";
  }
}

export interface EnsureAgentResult {
  /** 目标内 agent 安装目录 */
  agentDir: string;
  /** 目标内 agent 二进制绝对路径 */
  binaryPath: string;
  /** 目标内 agent 版本 */
  version: string;
  /** 本次是否重新注入（false = 复用目标内已有二进制） */
  injected: boolean;
  /** 过程日志（部署向导逐行展示） */
  log: string[];
}

/**
 * 确保目标内存在与期望版本一致的 agent 二进制。
 *
 * 逐候选目录尝试：mkdir → 版本检查（满足下限且版本匹配则复用）
 * → 注入（适配器实现）+ chmod 755 → 再次版本检查（验证可执行）。全部候选失败时给出聚合错误。
 * 期望版本来自 latest 接口；接口不可达时容忍并回退为“缺失即注入”（不因离线阻塞连接）。
 */
export async function ensureAgentInCliEnv(
  env: CliAgentEnv,
  goArch: "amd64" | "arm64",
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<EnsureAgentResult> {
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    opts.onLog?.(line);
  };

  // 期望版本：配置了 latest 接口时用于升级判定；接口不可达时容忍（离线/内网也不阻塞连接）。
  // 特别注意：latest 指向的版本可能低于 stdio 下限（0.6.0）——此时忽略该版本，
  // 否则会按“升级”逻辑把旧版 agent 注入目标，连接必然失败（旧版无 --stdio）。
  let expectedVersion = "";
  if (opts.latestVersionUrl) {
    try {
      const latest = (await fetchLatestVersion(opts.latestVersionUrl)).version;
      if (versionAtLeast(latest, MIN_STDIO_AGENT_VERSION)) {
        expectedVersion = latest;
        push(`Expected agent version: ${expectedVersion}`);
      } else {
        push(
          `Published agent v${latest} is older than the required minimum v${MIN_STDIO_AGENT_VERSION}; ` +
            `using the local cached binary instead (publish a newer agent to upgrade).`,
        );
      }
    } catch (err: any) {
      push(`Latest version check failed (ignored): ${err?.message || err}`);
    }
  }

  const candidates = env.agentDirCandidates();
  const errors: string[] = [];
  for (const agentDir of candidates) {
    const binaryPath = `${agentDir}/${AGENT_BINARY}`;
    try {
      // 目录必须先存在：注入不会创建中间目录；只读 rootfs 在此失败
      const mk = await env.exec(["sh", "-c", `mkdir -p '${agentDir}'`], {
        signal: opts.signal,
      });
      if (mk.code !== 0) {
        errors.push(`${agentDir}: ${(mk.stderr || mk.stdout).trim().split("\n").slice(-1)[0] || "目录不可写"}`);
        continue;
      }

      // 快路径：目标内已有可用（且满足 stdio 版本下限）且版本匹配的二进制 → 直接复用
      const existing = await getAgentVersionInCliEnv(env, binaryPath);
      if (existing && !versionAtLeast(existing, MIN_STDIO_AGENT_VERSION)) {
        push(
          `Agent v${existing} in ${env.noun} predates stdio support (>= ${MIN_STDIO_AGENT_VERSION}); re-injecting.`,
        );
      } else if (existing && (!expectedVersion || existing === expectedVersion)) {
        push(`Agent v${existing} already present at ${binaryPath}`);
        return { agentDir, binaryPath, version: existing, injected: false, log };
      }

      // 注入：本地缓存（或下载）→ 适配器注入 → chmod。
      // 注意 expectedVersion 已在上面完成下限过滤：低于下限时以空值走“本地缓存优先”分支，
      // 避免把旧版 agent 从网络拉下来注入。
      const localBinary = await ensureLocalBinary(
        "linux",
        goArch,
        opts.downloadUrl,
        expectedVersion ? opts.latestVersionUrl : undefined,
        (downloaded, total) =>
          push(`Downloading agent binary... ${total ? Math.round((downloaded / total) * 100) + "%" : downloaded + "B"}`),
        opts.signal,
      );
      push(`Uploading ${AGENT_BINARY} (${goArch}) to ${env.noun} ${env.targetRef} → ${binaryPath}`);
      await env.killStaleAgents?.();
      await env.injectBinary(localBinary, binaryPath, { signal: opts.signal });
      // 权限位：注入方式（cp/写文件）的源模式在 Windows 宿主下不可靠 → 显式 chmod
      await env.exec(["chmod", "755", binaryPath], { timeoutMs: 15_000 });
      push(`Injected agent binary to ${binaryPath}`);

      const injected = await getAgentVersionInCliEnv(env, binaryPath);
      if (injected && !versionAtLeast(injected, MIN_STDIO_AGENT_VERSION)) {
        errors.push(
          `${agentDir}: 注入的 agent v${injected} 不支持 stdio 工作区（需要 >= ${MIN_STDIO_AGENT_VERSION}）——` +
            `本地缓存二进制过旧，请更新 ${opts.downloadUrl ? "下载地址配置" : "本地缓存 ~/.guada/agent/guada-agent-linux-" + goArch}`,
        );
        continue;
      }
      if (injected) {
        return { agentDir, binaryPath, version: injected, injected: true, log };
      }
      errors.push(
        `${agentDir}: 注入后无法执行（该目录可能以 noexec 挂载，或缺少可执行权限支持）`,
      );
    } catch (err: any) {
      errors.push(`${agentDir}: ${err?.message || err}`);
    }
  }

  throw new Error(
    `${env.installErrorPrefix}（已尝试 ${candidates.join("、")}）：\n` +
      errors.map((e) => `  - ${e}`).join("\n") +
      `\n${env.unsupportedHint}`,
  );
}

/** 校验目标内目录存在（path 配置的工作目录） */
export async function assertDirInCliEnv(env: CliAgentEnv, dir: string): Promise<void> {
  const r = await env.exec(
    ["sh", "-c", `test -d '${dir.replace(/'/g, "'\\''")}' && echo OK || echo MISSING`],
    { timeoutMs: 15_000 },
  );
  if (!r.stdout.includes("OK")) {
    throw new Error(`${env.noun}内工作目录不存在：${dir} — ${env.dirMissingHint}`);
  }
}

export interface StartedCliAgent {
  transport: StreamRpcTransport;
  rpc: RpcClient;
  /** ping 返回的版本（缺失时回退期望版本） */
  version: string;
  rootPath: string;
}

/**
 * 打开 stdio 长连接并完成握手（ping + root 校验）。
 * 返回的 RpcClient 与 SSH 链路语义完全一致（超时/心跳/cancel/shutdown 推送）。
 */
export async function startCliAgentStdio(
  env: CliAgentEnv,
  opts: {
    binaryPath: string;
    rootPath: string;
    perm?: string;
    expectedVersion?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
    handshakeTimeoutMs?: number;
  },
): Promise<StartedCliAgent> {
  const perm = opts.perm && opts.perm !== "workspace" ? opts.perm : "workspace";
  opts.onLog?.(`Starting agent (stdio): --root ${opts.rootPath} --perm ${perm}`);

  const transport = env.openAgentStdio(opts.binaryPath, opts.rootPath, perm);
  const rpc = new RpcClient(transport);
  rpc.setConnected();

  try {
    const pong = await rpc.call<{ pong: string; version?: string; root?: string }>(
      "ping",
      undefined,
      opts.signal,
      opts.handshakeTimeoutMs ?? 20_000,
    );
    if (!pong?.pong) throw new Error("agent ping 未返回预期响应");
    if (pong.root && pong.root.replace(/\/+$/, "") !== opts.rootPath.replace(/\/+$/, "")) {
      // 符号链接解析等可能导致轻微差异：仅告警，不阻断（与 SSH 链路一致不做强校验）
      logger.warn(
        `agent root mismatch: requested '${opts.rootPath}', agent reports '${pong.root}' (${env.noun} ${env.targetRef})`,
      );
    }
    opts.onLog?.(`Agent connected: v${pong.version || opts.expectedVersion || ""}, root ${pong.root || opts.rootPath}`);
    return {
      transport,
      rpc,
      version: pong.version || opts.expectedVersion || "",
      rootPath: opts.rootPath,
    };
  } catch (err: any) {
    transport.close();
    const stderrTail = transport.getStderrTail();
    throw new Error(
      `agent 握手失败：${err?.message || err}` + (stderrTail ? ` — ${stderrTail.slice(-300)}` : ""),
    );
  }
}

/**
 * 目标内目录浏览（向导第 2 步）。
 * 复用 SSH 链路的 POSIX browse 命令（ls -la + awk），经目标环境的 sh 执行。
 */
export async function browseCliPath(
  env: CliAgentEnv,
  buildBrowseCommand: (dirPath: string) => string,
  parseBrowseOutput: (raw: string) => { path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] },
  dirPath: string,
  signal?: AbortSignal,
): Promise<{ path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] }> {
  const r = await env.exec(["sh", "-c", buildBrowseCommand(dirPath)], {
    timeoutMs: 20_000,
    signal,
  });
  if (r.code !== 0 && !r.stdout.trim()) {
    throw new Error(
      `${env.noun}内目录浏览失败：${(r.stderr || "").trim().split("\n").slice(-1)[0] || "命令执行失败（环境可能缺少 ls/awk）"}`,
    );
  }
  return parseBrowseOutput(r.stdout);
}

/** 「类 POSIX 目标」的架构映射（agent 为 POSIX 静态二进制，仅 linux/amd64、linux/arm64） */
export function mapLinuxArch(
  arch: string,
): { ok: true; goArch: "amd64" | "arm64" } | { ok: false; reason: string } {
  if (arch === "amd64" || arch === "x86_64") return { ok: true, goArch: "amd64" };
  if (arch === "arm64" || arch === "aarch64") return { ok: true, goArch: "arm64" };
  return { ok: false, reason: `不支持架构 ${arch}（仅 linux/amd64、linux/arm64）` };
}
