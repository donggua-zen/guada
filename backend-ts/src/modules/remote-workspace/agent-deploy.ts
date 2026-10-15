/**
 * Agent 部署与 SSH 连接支撑 — 与 agent-version.ts / ssh-agent-connect.ts / ssh-stdio-transport.ts 配合。
 *
 * 本文件提供三块能力：
 * 1. **供给（provisionRemoteAgent）**：SSH 连接 → 探测可写安装目录 → 写入访问令牌 →
 *    版本检查（latest 低于 stdio 下限时忽略，绝不降级）→ 按需下载并上传二进制（SFTP，失败回退 exec 通道）。
 * 2. **legacy 起点（startLegacyWsAgent）**：nohup 启动 `agent --port 0` + SSH 端口转发 → `ws://127.0.0.1:<port>/ws`。
 *    仅用于 agent < 0.6.0（无 --stdio）与 devMode 调试；要求远端 sshd 允许端口转发。
 * 3. **部署验证（verifyAndDeployAgent）**：向导「部署验证」步骤，握手方式与实际连接链路一致
 *    （≥ 0.6.0 走 stdio，旧版走端口转发 + WS），避免"验证通过但实际连不上"。
 *
 * agent ≥ 0.6.0 的默认连接链路见 ssh-agent-connect.ts（ssh exec + stdio，无需端口转发）。
 */

import { Client, type ConnectConfig } from "ssh2";
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import * as https from "https";
import * as crypto from "crypto";
import type { ParsedWorkspaceUri } from "../../common/workspace/workspace-provider.interface";
import { RpcClient, WsRpcTransport } from "./rpc";
import { SshStdioTransport } from "./ssh-stdio-transport";
import { MIN_STDIO_AGENT_VERSION, selectSshAgentTransport, versionAtLeast } from "./agent-version";

const REMOTE_DIR = ".guada-agent";
const REMOTE_BINARY_NAME = "guada-agent";

/**
 * 远端 agent 安装根目录的候选(按序探测第一个可写的)。
 * 部分 NAS/精简系统(如群晖、QNAP)的账号 $HOME 指向并不存在的目录,
 * 且该账号无权创建(常见于「用户主目录」服务未启用),此时直接
 * mkdir -p $HOME/.guada-agent 会失败并中断整个部署;探测到可写目录后回退安装。
 */
const REMOTE_BASE_CANDIDATES = ["$HOME", "$PWD", "/tmp", "/var/tmp", "/dev/shm"];

/** agent 安装根目录探测结果标记 */
const BASE_HOME_MARK = "GUADA_BASE:HOME:";
const BASE_FALLBACK_MARK = "GUADA_BASE:FALLBACK:";

// 下载地址模板(任务#3 会改为从配置读取;{os}/{arch}/{version} 会被替换)
// 调试阶段不使用网络下载,二进制通过本地文件夹复制放入缓存目录。
// const AGENT_DOWNLOAD_URL = `https://.../guada-agent-{os}-{arch}`;

// 本地缓存目录: ~/.guada/agent/
function localCacheDir(): string {
  return path.join(os.homedir(), ".guada", "agent");
}

function localCachedBinary(osName: string, goArch: string, version?: string): string {
  // 带版本号的缓存文件(用于自动升级检测):guada-agent-<os>-<arch>-v<version>
  if (version) {
    return path.join(localCacheDir(), `guada-agent-${osName}-${goArch}-v${version}`);
  }
  // 无版本缓存(调试阶段手动复制):guada-agent-<os>-<arch>
  return path.join(localCacheDir(), `guada-agent-${osName}-${goArch}`);
}

// ── Agent access token ──
// 访问令牌持久化在本地缓存目录,首次生成后一直复用,保证多次部署/连接使用同一令牌。
// 部署时令牌写入远端 ~/.guada-agent/.token(chmod 600),agent 启动时通过 --token-file 读取,
// WebSocket 握手必须携带 Authorization: Bearer <token>,防止 guada 之外的进程连接 agent。

function localTokenFile(): string {
  return path.join(localCacheDir(), "token");
}

function getOrCreateToken(): string {
  const file = localTokenFile();
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf-8").trim();
    if (existing) return existing;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(localCacheDir(), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/** 将访问令牌写入远端目录(权限 600),供 agent --token-file 读取 */
async function writeRemoteToken(
  sshClient: Client,
  remoteDir: string,
  token: string,
): Promise<void> {
  await execCommand(
    sshClient,
    `printf '%s' '${token}' > ${remoteDir}/.token && chmod 600 ${remoteDir}/.token`,
  );
}

export interface RemoteBaseDir {
  /** 可用于安装 agent 的目录(空串表示所有候选都不可写) */
  path: string;
  /** 该目录是否为 $HOME(为 false 表示走了回退目录,通常是临时目录) */
  isHome: boolean;
}

/**
 * 构造探测命令:依次尝试候选目录,用「实际创建探针目录」确认可写 ——
 * 只看 [ -w ] 会漏掉只读挂载、配额耗尽等情况,而 mkdir 的成败就是最终判据。
 */
export function buildRemoteBaseCommand(): string {
  // 候选逐个加引号:未加引号的 $HOME 在 for 列表里会被再次分词,含空格的路径会断成两个
  const candidates = REMOTE_BASE_CANDIDATES.map((c) => `"${c}"`).join(" ");
  return (
    `for c in ${candidates}; do ` +
    `[ -n "$c" ] || continue; ` +
    `[ -d "$c" ] || mkdir -p "$c" 2>/dev/null || continue; ` +
    `mkdir -p "$c/.guada-probe-$$" 2>/dev/null || continue; ` +
    `rmdir "$c/.guada-probe-$$" 2>/dev/null; ` +
    `if [ "$c" = "$HOME" ]; then echo "${BASE_HOME_MARK}$c"; else echo "${BASE_FALLBACK_MARK}$c"; fi; ` +
    `break; ` +
    `done`
  );
}

/** 解析探测命令输出(纯函数,便于单测);未命中返回空 path */
export function parseRemoteBaseDir(raw: string): RemoteBaseDir {
  for (const line of raw.split("\n")) {
    if (line.startsWith(BASE_HOME_MARK)) {
      return { path: line.slice(BASE_HOME_MARK.length).trim(), isHome: true };
    }
    if (line.startsWith(BASE_FALLBACK_MARK)) {
      return { path: line.slice(BASE_FALLBACK_MARK.length).trim(), isHome: false };
    }
  }
  return { path: "", isHome: false };
}

/** 探测远端可写安装根目录 */
async function resolveRemoteBaseDir(sshClient: Client): Promise<RemoteBaseDir> {
  return parseRemoteBaseDir(await execCommand(sshClient, buildRemoteBaseCommand()));
}

export interface AgentConnectionInfo {
  wsUrl: string;
  localPort: number;
  sshClient: Client | null;
  /** 访问令牌,用于 WebSocket 握手鉴权(dev 模式为空字符串) */
  token: string;
}

/** 远端 agent 供给结果（部署 + 版本确认；连接方式由调用方按 `version` 选择） */
export interface RemoteAgentProvision {
  /** 已建立的 SSH 连接（由调用方负责在连接生命周期结束时 end） */
  sshClient: Client;
  sshConfig: ConnectConfig;
  /** 远端安装目录（`<可写根>/.guada-agent`） */
  remoteDir: string;
  /** 远端 agent 二进制绝对路径 */
  remoteBinary: string;
  /** 访问令牌（WS 链路鉴权用；stdio 链路不需要，但一并写入以便随时回退） */
  token: string;
  /** 远端当前 agent 版本（上传后以再查为准）；未安装且未部署成功时为空串 */
  version: string;
  /** 本次是否上传/覆盖了二进制 */
  uploaded: boolean;
  log: string[];
}

/**
 * 远端供给：连上 SSH → 解析安装目录 → 写入访问令牌 → 版本检查 → 按需下载并上传二进制。
 *
 * 两条链路共用（stdio 与 legacy WS），差别只在调用方随后如何启动/连接。
 *
 * 版本策略（与容器链路一致）：latest 接口返回的版本**低于 stdio 下限（0.6.0）时忽略**，
 * 退回本地缓存/已安装版本 —— 否则"跟随 latest"会把 0.6+ 的远端降级回旧版
 * （实测旧版 agent 收到 --stdio 会静默失败）；latest 不可达时容忍并照常继续。
 */
export async function provisionRemoteAgent(
  uri: ParsedWorkspaceUri,
  downloadUrl?: string,
  latestVersionUrl?: string,
  opts: {
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RemoteAgentProvision> {
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    opts.onLog?.(line);
  };
  const throwIfAborted = (): void => {
    if (opts.signal?.aborted) {
      const err = new Error("Deployment cancelled");
      (err as any).cancelled = true;
      throw err;
    }
  };

  const sshConfig = buildSshConfig(uri);
  const sshClient = await sshConnect(sshConfig);

  try {
    // Step 1: 确保远端安装目录（$HOME 可能不存在且不可创建：探测可写目录后回退）
    const remoteBase = await resolveRemoteBaseDir(sshClient);
    if (!remoteBase.path) {
      throw new Error(
        `远端未找到可用于安装 agent 的可写目录(已尝试 ${REMOTE_BASE_CANDIDATES.join("、")})。` +
          `请确认该账号有可写目录后再连接。`,
      );
    }
    const remoteDir = `${remoteBase.path}/${REMOTE_DIR}`;
    const remoteBinary = `${remoteDir}/${REMOTE_BINARY_NAME}`;
    await execCommand(sshClient, `mkdir -p ${remoteDir}`);
    if (!remoteBase.isHome) {
      push(
        `Home directory is missing or not writable on ${sshConfig.host}; ` +
          `installing the agent under ${remoteBase.path} instead — ` +
          `if that location is a temp filesystem, the agent is re-deployed after a reboot.`,
      );
    }

    // Step 1.5: 访问令牌（远端 600 权限；stdio 链路用不到，保留以便回退到 WS）
    throwIfAborted();
    const token = getOrCreateToken();
    await writeRemoteToken(sshClient, remoteDir, token);

    // Step 2: 远端版本
    throwIfAborted();
    const versionCheck = await execCommand(
      sshClient,
      `${remoteBinary} --version 2>/dev/null || echo "NOT_FOUND"`,
    );
    const installed = versionCheck.trim() === "NOT_FOUND" ? "" : versionCheck.trim().split("\n")[0].trim();

    // 期望版本：跟随 latest，但低于 stdio 下限的 latest 被忽略（绝不降级）
    let expectedVersion = "";
    if (latestVersionUrl) {
      throwIfAborted();
      try {
        const latest = (await fetchLatestVersion(latestVersionUrl)).version;
        if (versionAtLeast(latest, MIN_STDIO_AGENT_VERSION)) {
          expectedVersion = latest;
          push(`Latest agent version: v${expectedVersion}`);
        } else {
          push(
            `Latest published agent v${latest} is older than the stdio minimum v${MIN_STDIO_AGENT_VERSION}; ` +
              `keeping the installed/local binary (no downgrade).`,
          );
        }
      } catch (err: any) {
        push(`Latest version check failed (ignored): ${err?.message || err}`);
      }
    }

    const needDeploy = expectedVersion ? installed !== expectedVersion : !installed;
    if (!needDeploy) {
      push(`Agent already installed with matching version (v${installed})`);
      return { sshClient, sshConfig, remoteDir, remoteBinary, token, version: installed, uploaded: false, log };
    }

    // Step 3: 探测远端平台 → 取本地二进制（缓存优先/按需下载）
    throwIfAborted();
    const osRaw = (await execCommand(sshClient, "uname -s")).trim().toLowerCase();
    const archRaw = (await execCommand(sshClient, "uname -m")).trim();
    const osName = osRaw === "darwin" ? "darwin" : "linux";
    const goArch = (archRaw === "aarch64" || archRaw === "arm64") ? "arm64" : "amd64";
    push(`Remote platform: ${osName}/${goArch}`);

    const localBinary = await ensureLocalBinary(
      osName,
      goArch,
      downloadUrl,
      // 忽略旧版 latest 时不要把它透传给缓存/下载逻辑（否则会去找/下载那个旧版本）
      expectedVersion ? latestVersionUrl : undefined,
      // 下载进度：节流输出（每前进 ≥5% 且 ≥2MB 才一行），避免部署日志刷屏
      (() => {
        let lastPct = -1;
        let lastLoggedBytes = 0;
        return (downloaded: number, total: number) => {
          if (total > 0) {
            const pct = Math.min(100, Math.round((downloaded / total) * 100));
            if (pct >= lastPct + 5 && downloaded - lastLoggedBytes >= 2 * 1048576) {
              lastPct = pct;
              lastLoggedBytes = downloaded;
              push(
                `Downloading agent binary: ${(downloaded / 1048576).toFixed(1)}MB / ` +
                  `${(total / 1048576).toFixed(1)}MB (${pct}%)`,
              );
            }
          } else {
            push(`Downloading agent binary: ${(downloaded / 1048576).toFixed(1)}MB`);
          }
        };
      })(),
      opts.signal,
    );

    // Step 4: 清理旧进程（运行中的二进制被占用时 fastPut 覆盖会失败）→ 上传 → 授权
    throwIfAborted();
    await execCommand(sshClient, `pkill -f "${remoteBinary}" 2>/dev/null || true`);
    await uploadBinary(sshClient, localBinary, remoteBinary, push);
    await execCommand(sshClient, `chmod +x ${remoteBinary}`);

    // Step 5: 再查版本作为权威值（同时验证上传结果可执行）
    const after = (await execCommand(
      sshClient,
      `${remoteBinary} --version 2>/dev/null || echo "NOT_FOUND"`,
    )).trim();
    if (after === "NOT_FOUND") {
      throw new Error(
        `agent 上传后无法执行：${remoteBinary}（远端可能不允许在该目录执行，或上传被截断）`,
      );
    }
    push(`Agent v${after.split("\n")[0].trim()} installed at ${remoteBinary}`);

    return {
      sshClient,
      sshConfig,
      remoteDir,
      remoteBinary,
      token,
      version: after.split("\n")[0].trim(),
      uploaded: true,
      log,
    };
  } catch (err) {
    sshClient.end();
    throw err;
  }
}

/**
 * legacy 起点：在既有 SSH 连接上启动 `agent --port 0`（nohup 后台）并做端口转发，
 * 返回 `ws://127.0.0.1:<localPort>/ws`。
 *
 * 仅用于 agent < 0.6.0（无 stdio 能力）与 devMode 调试；该路径要求远端 sshd
 * 允许端口转发（AllowTcpForwarding），硬化环境请升级 agent 走 stdio。
 */
export async function startLegacyWsAgent(
  provision: RemoteAgentProvision,
  uri: ParsedWorkspaceUri,
): Promise<AgentConnectionInfo> {
  const { sshClient, remoteDir, remoteBinary, token } = provision;
  try {
    // 工作目录预校验：连接配置的 path 就是 agent 的 --root（命令默认 cwd）。
    // 路径不存在时 agent(0.5.1+) 会拒绝启动；这里提前给出明确原因，
    // 避免用户在执行命令时只看到 "fork/exec /bin/sh: no such file or directory" 这类间接报错。
    const workspacePath = uri.path || "/";
    const pathCheck = await execCommand(
      sshClient,
      `test -d '${workspacePath}' && echo OK || echo MISSING`,
    );
    if (!pathCheck.includes("OK")) {
      throw new Error(
        `远端工作目录不存在：${workspacePath} — 请回到「选择目录」重新选择一个已存在的目录` +
          `（macOS 的主目录在 /Users/<user> 下）。`,
      );
    }

    const remotePort = await ensureAgentRunning(
      sshClient,
      remoteBinary,
      `${remoteDir}/.token`,
      uri.path,
      uri.query?.perm,
    );

    // 先探测：被 sshd 拒绝端口转发时(AllowTcpForwarding no)提前报明确原因，
    // 否则上层只会看到 WS 的 socket hang up
    await probePortForward(sshClient, remotePort);
    const localPort = await setupPortForward(sshClient, remotePort);
    return {
      wsUrl: `ws://127.0.0.1:${localPort}/ws`,
      localPort,
      sshClient,
      token,
    };
  } catch (err) {
    sshClient.end();
    throw err;
  }
}

/**
 * @deprecated 生产链路请用 connectSshAgent（按版本自动选 stdio / legacy）。
 * 保留本入口用于：devMode 直连调试、SSH 传输形态对比基准（scripts/ssh-stdio-vs-forward-bench.ts）、
 * 以及 agent < 0.6.0 环境的显式回退。
 */
export async function deployAgent(
  uri: ParsedWorkspaceUri,
  downloadUrl?: string,
  latestVersionUrl?: string,
): Promise<AgentConnectionInfo> {
  // Dev mode: connect to manually started agent
  if (uri.query?.devMode === "1") {
    const port = parseInt(uri.query?.agentPort || "19876", 10);
    return { wsUrl: `ws://127.0.0.1:${port}/ws`, localPort: port, sshClient: null, token: "" };
  }
  const provision = await provisionRemoteAgent(uri, downloadUrl, latestVersionUrl);
  return startLegacyWsAgent(provision, uri);
}

export interface DeployResult {
  success: boolean;
  /** 远端是否已安装且版本匹配(无需重新部署) */
  installed: boolean;
  /** 远端 agent 版本(未安装时为 "") */
  version: string;
  /** 部署过程日志 */
  log: string[];
}

/**
 * 部署验证 — 检测远端是否已安装 agent 且版本匹配;
 * 不匹配则从本地缓存获取二进制并上传部署,启动后验证可运行。
 * 不建立 WebSocket 长连接,用于"保存连接前必须部署成功"的校验。
 * onLog 可选回调:各阶段实时推送日志行(前端轮询/流式展示用)。
 * signal 可选:调用方可在窗口关闭/组件卸载时中止部署(下载/上传/连接立即中断)。
 */
export async function verifyAndDeployAgent(
  uri: ParsedWorkspaceUri,
  downloadUrl?: string,
  latestVersionUrl?: string,
  onLog?: (line: string) => void,
  signal?: AbortSignal,
): Promise<DeployResult> {
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    onLog?.(line);
  };
  // 中止检查:已取消则抛出明确错误
  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      const err = new Error("Deployment cancelled");
      (err as any).cancelled = true;
      throw err;
    }
  };

  // dev 模式:跳过部署验证
  if (uri.query?.devMode === "1") {
    return { success: true, installed: true, version: "", log: ["dev mode, skipping deployment"] };
  }

  let sshClient: Client | null = null;
  // 中止时立即断开 SSH,使进行中的 exec/upload 快速失败
  const onAbort = () => {
    try {
      sshClient?.end();
    } catch {}
  };
  signal?.addEventListener("abort", onAbort);
  try {
    throwIfAborted();
    push("Connecting to remote server via SSH...");

    // 供给（连 SSH → 安装目录 → 令牌 → 版本检查 → 按需上传）；版本下限策略见 provisionRemoteAgent
    const provision = await provisionRemoteAgent(uri, downloadUrl, latestVersionUrl, {
      onLog: push,
      signal,
    });
    sshClient = provision.sshClient;
    const { sshConfig, remoteBinary } = provision;

    // 工作目录预校验:连接配置的 path 就是 agent 的 --root(命令默认 cwd)。
    // 路径不存在时 agent(0.5.1+)会拒绝启动;这里提前给出明确原因,
    // 避免用户在执行命令时只看到 "fork/exec /bin/sh: no such file or directory" 这类间接报错。
    // 向导中目录先于本步骤选定,因此这里通常不会触发;命中说明目录在选定后被删除/改名,
    // 提示用户回上一步重新选择即可。
    throwIfAborted();
    const workspacePath = uri.path || "/";
    push(`Checking remote workspace path: ${workspacePath}`);
    const pathCheck = await execCommand(
      sshClient,
      `test -d '${workspacePath}' && echo OK || echo MISSING`,
    );
    if (!pathCheck.includes("OK")) {
      push(
        `Remote workspace path does not exist on ${sshConfig.host}: ${workspacePath} — ` +
          `go back to "Select Directory" and pick an existing directory ` +
          `(on macOS home directories live under /Users/<user>).`,
      );
      return { success: false, installed: false, version: "", log };
    }
    push("Remote workspace path exists");

    // 握手验证：连接链路怎么连，这里就怎么验——避免"验证通过但实际连不上"。
    // agent >= 0.6.0 走 stdio（不需要端口转发；硬化 sshd 下同样可验证）；
    // 旧版 agent 回退端口转发 + WebSocket。
    throwIfAborted();
    const transportKind = selectSshAgentTransport(provision.version);
    if (transportKind === "stdio") {
      push("Verifying agent handshake over SSH stdio...");
      const transport = await SshStdioTransport.openAgent(sshClient, {
        binaryPath: remoteBinary,
        rootPath: uri.path,
        perm: uri.query?.perm,
      });
      const verifyRpc = new RpcClient(transport);
      verifyRpc.setConnected();
      try {
        const ping = await verifyRpc.call<{ pong: string }>("ping", undefined, signal, 20000);
        if (!ping.pong) throw new Error("Agent ping failed");
      } catch (err: any) {
        const tail = transport.getStderrTail();
        throw new Error(
          `Agent handshake failed: ${err?.message || err}` + (tail ? ` — ${tail.slice(-300)}` : ""),
        );
      } finally {
        // 关闭通道 → agent 读到 EOF 自行退出，不留残留进程
        verifyRpc.close();
      }
    } else {
      push("Verifying agent handshake over port forward...");
      // 旧版 agent 回退路径：启动 → 端口转发 → WS ping（agent 断开即退出）
      const connInfo = await startLegacyWsAgent(provision, uri);
      try {
        const verifyWs = new WebSocket(connInfo.wsUrl, {
          headers: connInfo.token ? { Authorization: `Bearer ${connInfo.token}` } : undefined,
        });
        await new Promise<void>((resolve, reject) => {
          verifyWs.once("open", () => resolve());
          verifyWs.once("error", (err) => reject(err));
        });
        const verifyRpc = new RpcClient(new WsRpcTransport(verifyWs));
        verifyRpc.setConnected();
        const ping = await verifyRpc.call<{ pong: string }>("ping");
        if (!ping.pong) throw new Error("Agent ping failed");
        verifyWs.close();
      } catch (err: any) {
        throw new Error(`Agent handshake failed: ${err?.message || err}`);
      }
    }
    push("Agent handshake verified");

    push("Deployment verified");
    return {
      success: true,
      installed: !provision.uploaded,
      version: provision.version,
      log,
    };
  } catch (err: any) {
    if (err?.cancelled) {
      push("Deployment cancelled");
    } else {
      // 多行错误(可能含 agent 原始输出,如 --root 校验失败原因)按行展开,前端逐行渲染更易读
      const lines = String(err?.message || err).split(/\r?\n/);
      push(`Deployment failed: ${lines[0]}`);
      for (const line of lines.slice(1)) push(`  | ${line}`);
    }
    return { success: false, installed: false, version: "", log };
  } finally {
    if (sshClient) sshClient.end();
    signal?.removeEventListener("abort", onAbort);
  }
}

// ── Binary acquisition (local cache + optional HTTP download) ──

export interface AgentLatestInfo {
  /** 最新版本号 */
  version: string;
  /** 可选:下载地址模板(含 {os}/{arch}/{version} 占位符);缺省时回退到配置的 downloadUrl */
  downloadUrl?: string;
}

/**
 * 从 latest 版本接口获取最新版本信息。
 * 支持两种响应格式:
 *   {"version":"0.4.1"}
 *   {"version":"0.4.1","downloadUrl":"https://.../guada-agent-{os}-{arch}-v{version}"}
 * 第二种格式可直接在检测接口中携带下载地址,无需单独配置。
 */
export function fetchLatestVersion(latestUrl: string): Promise<AgentLatestInfo> {
  return new Promise((resolve, reject) => {
    const req = https.get(latestUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 && res.headers.location) {
        fetchLatestVersion(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Latest version fetch failed: HTTP ${res.statusCode} from ${latestUrl}`));
        return;
      }
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const v = parsed?.version;
          if (typeof v === "string" && v) {
            const info: AgentLatestInfo = { version: v };
            if (typeof parsed.downloadUrl === "string" && parsed.downloadUrl) {
              info.downloadUrl = parsed.downloadUrl;
            }
            resolve(info);
          } else {
            reject(new Error(`Latest version response missing 'version' field: ${body.slice(0, 200)}`));
          }
        } catch (err) {
          reject(new Error(`Latest version response is not valid JSON: ${err}`));
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(15000, () => req.destroy(new Error("Latest version fetch timeout (15s)")));
  });
}

/**
 * Ensure the agent binary for the given platform is in local cache.
 *
 * 三种获取方式(按优先级):
 * 1. latestVersionUrl 已配置 → 拉取最新版本信息,检查带版本的缓存文件是否已存在;
 *    不存在则优先用 latest 返回的 downloadUrl({os}/{arch}/{version} 占位符)下载,
 *    latest 未携带时回退到配置的 downloadUrl — 本地缓存自动跟随最新版。
 * 2. 无 latest 配置 → 使用本地缓存;缓存缺失且配置了 downloadUrl → 下载。
 * 3. 均未配置 → 保持调试行为:报错提示手动复制二进制。
 */
export async function ensureLocalBinary(
  osName: string,
  goArch: string,
  downloadUrl?: string,
  latestVersionUrl?: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 方式1:配置了 latest 接口 → 自动升级检测
  if (latestVersionUrl) {
    const latest = await fetchLatestVersion(latestVersionUrl);
    const cached = localCachedBinary(osName, goArch, latest.version);
    if (fs.existsSync(cached)) {
      return cached;
    }
    // 优先使用 latest 接口携带的下载地址,其次回退到配置的 downloadUrl
    const effectiveUrl = latest.downloadUrl || downloadUrl;
    if (effectiveUrl) {
      const url = effectiveUrl
        .replace("{os}", osName)
        .replace("{arch}", goArch)
        .replace("{version}", latest.version);
      fs.mkdirSync(localCacheDir(), { recursive: true });
      await downloadFile(url, cached, onProgress, signal);
      return cached;
    }
    throw new Error(
      `agent 最新版 v${latest.version} 尚未缓存(${cached}),且未提供下载地址。` +
        `请在 latest 接口中返回 downloadUrl,或在设置中配置 agent 下载地址模板。`,
    );
  }

  // 方式2/3:本地缓存优先;缺失且有下载地址则下载;否则报错
  const cached = localCachedBinary(osName, goArch);
  if (fs.existsSync(cached)) {
    return cached;
  }

  if (downloadUrl) {
    const url = downloadUrl.replace("{os}", osName).replace("{arch}", goArch);
    fs.mkdirSync(localCacheDir(), { recursive: true });
    await downloadFile(url, cached, onProgress, signal);
    return cached;
  }

  // 未配置下载地址:调试阶段请将编译好的二进制复制到缓存目录:
  //   ~/.guada/agent/guada-agent-<os>-<arch>
  throw new Error(
    `本地缓存中未找到 agent 二进制: ${cached}\n` +
      `请先将二进制复制到该路径(调试阶段通过本地文件夹复制),或在设置中配置下载地址后重试。`,
  );
}

/** Download a file via HTTPS with redirect support; onProgress 提供下载进度(已下载/总字节); signal 可中止 */
function downloadFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      try {
        req.destroy(new Error("Download aborted"));
      } catch {}
    };
    signal?.addEventListener("abort", onAbort);

    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      // Follow redirects (GitHub releases return 302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location!, dest, onProgress, signal).then(
          (r) => {
            cleanup();
            resolve(r);
          },
          (e) => {
            cleanup();
            reject(e);
          },
        );
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        cleanup();
        reject(new Error(`Download failed: HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
      });
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        cleanup();
        resolve();
      });
      file.on("error", (err) => {
        cleanup();
        reject(err);
      });
    });
    req.on("error", (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      cleanup();
      reject(err);
    });
    req.setTimeout(60000, () => {
      req.destroy(new Error("Download timeout (60s)"));
    });
  });
}

// ── SSH helpers ──

function buildSshConfig(uri: ParsedWorkspaceUri): ConnectConfig {
  const config: ConnectConfig = {
    host: uri.host!,
    port: uri.port || 22,
    username: uri.username || "root",
  };

  const password = uri.password || uri.query?.password;
  if (password) {
    config.password = decodeURIComponent(password);
  }

  const privateKeyPath = uri.query?.privateKeyPath;
  if (privateKeyPath) {
    config.privateKey = fs.readFileSync(privateKeyPath);
  }

  const privateKeyContent = uri.query?.privateKey;
  if (privateKeyContent) {
    config.privateKey = decodeURIComponent(privateKeyContent);
  }

  return config;
}

function sshConnect(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect(config);
  });
}

function execCommand(
  client: Client,
  command: string,
  timeoutMs = 15000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        // ssh2 exec 失败时 message 可能为通用 "Failure",补全命令上下文
        reject(new Error(`SSH 执行失败: ${err.message || err} [command: ${command}]`));
        return;
      }

      let output = "";
      let stderrOutput = "";
      let exitCode: number | null = null;

      stream.on("data", (data: Buffer) => {
        output += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });
      stream.on("exit", (code: number | null) => {
        exitCode = code;
      });
      stream.on("close", () => {
        clearTimeout(timer);
        // 非零退出且无 stdout:失败原因在 stderr —— 必须按失败返回,
        // 否则 "mkdir -p"/"chmod" 之类失败会被当成正常输出吞掉
        if (exitCode !== null && exitCode !== 0 && !output) {
          reject(
            new Error(
              `SSH command failed (exit ${exitCode}): ${stderrOutput.trim() || "(no output)"} [command: ${command}]`,
            ),
          );
          return;
        }
        if (stderrOutput && !output) {
          resolve(stderrOutput);
        } else {
          resolve(output);
        }
      });
    });
  });
}

function startAgentBackground(
  client: Client,
  remoteBinary: string,
  remoteTokenFile: string,
  port: number,
  rootDir?: string,
  perm?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // agent 启动失败的原因写在它自己的 stderr 里(如 "--root '/home/donggua' does not exist").
    // 必须原样带进错误信息:否则用户只看到 "Agent didn't report listening",无从排查。
    let output = "";
    const fail = (message: string) => {
      const trimmed = output.trim();
      reject(new Error(trimmed ? `${message}\nAgent output:\n${trimmed}` : message));
    };

    const timer = setTimeout(() => fail("Agent start timeout (10s)"), 10000);

    // 权限参数:工作目录(--root)无论权限模式都必须传递,
    // 它是命令行/文件编辑的相对路径基准;权限模式默认为 workspace。
    const permArg = perm && perm !== "workspace" ? ` --perm ${perm}` : "";
    const rootArg = rootDir ? ` --root '${rootDir}'` : "";

    client.exec(
      `nohup ${remoteBinary} --port ${port} --token-file ${remoteTokenFile}${permArg}${rootArg} 2>&1 &`,
      (err, stream) => {
        if (err) {
          clearTimeout(timer);
          fail(`Agent 启动命令执行失败: ${err.message || err}`);
          return;
        }

        stream.on("data", (data: Buffer) => {
          output += data.toString();
          if (output.includes("listening on")) {
            clearTimeout(timer);
            resolve(output);
          }
        });
        stream.on("close", () => {
          clearTimeout(timer);
          if (output.includes("listening on")) {
            resolve(output);
          } else {
            fail("Agent didn't report listening.");
          }
        });
      },
    );
  });
}

function uploadFile(
  client: Client,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 上传前校验本地文件存在(给出明确错误而非 ssh2 的通用 Failure)
    if (!fs.existsSync(localPath)) {
      reject(
        new Error(
          `SFTP 上传失败: 本地文件不存在 ${localPath}(请检查 agent 二进制是否已放入缓存目录)`,
        ),
      );
      return;
    }
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SFTP 会话建立失败: ${err.message || err}`));
        return;
      }
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) {
          // ssh2 的 fastPut 失败时 message 常为通用的 "Failure",需补全上下文
          const errCode = (err as NodeJS.ErrnoException)?.code;
          reject(
            new Error(
              `SFTP 上传失败(本地: ${localPath} → 远端: ${remotePath}): ${err.message || err}` +
                `${errCode ? ` [code: ${errCode}]` : ""} — ` +
                `请检查远端磁盘空间/目录权限,以及远端目录是否可写`,
            ),
          );
        } else {
          resolve();
        }
      });
    });
  });
}

/** 单引号包裹 shell 参数(POSIX 方式转义内嵌单引号) */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 经 exec 通道上传文件(cat > 远端路径),作为 SFTP 不可用时的回退。
 *
 * 部分 NAS 的 SFTP 子系统被 chroot 到共享目录视图,与实际文件系统不是同一命名空间:
 * 同一路径在 exec 下存在、在 SFTP 下却报 No such file,导致 fastPut 必然失败。
 * exec 看到的是真实文件系统(与 mkdir/test -d 一致),因此回退到 exec 上传。
 * 二进制必须按原始字节写入,不做 base64/文本转换。
 */
function uploadViaExec(client: Client, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = fs.readFileSync(localPath);
    client.exec(`cat > ${shQuote(remotePath)}`, (err, stream) => {
      if (err) {
        reject(new Error(`exec 通道上传失败: ${err.message || err}`));
        return;
      }
      let stderr = "";
      let exitCode: number | null = null;
      stream.on("data", () => { /* 上传无输出 */ });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("exit", (code: number | null) => { exitCode = code; });
      stream.on("close", () => {
        if (exitCode !== null && exitCode !== 0) {
          reject(new Error(`exec 通道上传失败(exit ${exitCode}): ${stderr.trim() || "(no output)"}`));
          return;
        }
        resolve();
      });
      // 分块写入并处理背压:一次性 end() 整个二进制会在慢链路上堆积在内存里
      const CHUNK = 512 * 1024;
      let offset = 0;
      const writeNext = (): void => {
        while (offset < data.length) {
          const chunk = data.subarray(offset, offset + CHUNK);
          offset += chunk.length;
          if (!stream.write(chunk)) {
            stream.once("drain", writeNext);
            return;
          }
        }
        stream.end();
      };
      writeNext();
    });
  });
}

/**
 * 上传 agent 二进制:优先 SFTP,失败则回退 exec 通道并校验字节数。
 * 回退命中通常意味着该主机 SFTP 视图与实际文件系统不一致(NAS 常见),
 * 需要把原因写进日志,否则用户只看到一句无上下文的 SFTP 报错。
 */
export async function uploadBinary(
  client: Client,
  localPath: string,
  remotePath: string,
  onWarn?: (line: string) => void,
): Promise<void> {
  try {
    await uploadFile(client, localPath, remotePath);
    return;
  } catch (sftpErr: unknown) {
    const reason = sftpErr instanceof Error ? sftpErr.message : String(sftpErr);
    onWarn?.(`SFTP upload failed (${reason}); retrying over the SSH channel`);
  }

  await uploadViaExec(client, localPath, remotePath);
  // 校验远端字节数:字节流被截断/转换时能立刻发现,而不是等到 agent 启动才报奇怪错误
  const expected = fs.statSync(localPath).size;
  const raw = await execCommand(client, `wc -c < ${shQuote(remotePath)}`);
  const actual = parseInt(raw.trim(), 10);
  if (!Number.isFinite(actual) || actual !== expected) {
    throw new Error(
      `Uploaded binary size mismatch (local ${expected} bytes, remote ${actual} bytes)`,
    );
  }
  onWarn?.(`Uploaded ${expected} bytes over the SSH channel`);
}

/**
 * 把 direct-tcpip 打开失败翻译成可操作的原因。
 * ssh2 把服务端 reason 码放在 err.reason:
 *   1 = ADMINISTRATIVELY_PROHIBITED(sshd 关闭了 TCP 转发)
 *   2 = CONNECT_FAILED(转发通道建好但目标端口连不上)
 * 纯函数,便于单测。
 */
export function forwardFailureMessage(
  reason: number | string | undefined,
  remotePort: number,
  rawMessage: string,
): string {
  if (reason === 1) {
    return (
      `端口转发被服务器拒绝(sshd AllowTcpForwarding 已关闭)。` +
      `远程工作区依赖 SSH 端口转发访问 Agent 的本地端口,` +
      `请在服务器 sshd 配置中开启 AllowTcpForwarding(NAS 上通常在 SSH 设置里允许端口转发)后重试。`
    );
  }
  if (reason === 2) {
    return `端口转发通道已建立,但远端 127.0.0.1:${remotePort} 不可达(Agent 未在监听或已退出)。`;
  }
  return `端口转发失败: ${rawMessage}`;
}

/**
 * 探测 direct-tcpip 端口转发是否可用:通道能打开即说明转发被允许且远端端口可达。
 * 部分主机(尤其 NAS)的 sshd 关闭了 TCP 转发,此时 WS 只会报 "socket hang up",
 * 看不出原因;这里提前给出明确判断,避免用户对着无上下文的报错排查。
 */
function probePortForward(client: Client, remotePort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (err, channel) => {
      if (!err) {
        channel.close();
        resolve();
        return;
      }
      const reason = (err as Error & { reason?: number | string }).reason;
      reject(new Error(forwardFailureMessage(reason, remotePort, err.message || String(err))));
    });
  });
}

function setupPortForward(client: Client, remotePort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((localSocket) => {
      // ssh2 forwardOut(srcIP, srcPort, dstIP, dstPort) — 将本地连接转发到远端 127.0.0.1:remotePort
      client.forwardOut(
        "127.0.0.1",
        0,
        "127.0.0.1",
        remotePort,
        (err, channel) => {
          if (err) {
            localSocket.destroy();
            return;
          }
          channel.pipe(localSocket);
          localSocket.pipe(channel);
          channel.on("close", () => localSocket.destroy());
        },
      );
    });

    server.listen(0, "127.0.0.1", () => {
      const localPort = (server.address() as net.AddressInfo).port;
      resolve(localPort);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * 启动远端 agent 进程,返回其监听端口。
 * 架构为"会话级独立进程"(无复用):每次调用都启动一个新 agent 进程(--port 0 随机端口),
 * 连接断开后 agent 自行退出,下次使用重新拉起 — 无需端口池/健康探测/复用。
 */
async function ensureAgentRunning(
  client: Client,
  remoteBinary: string,
  remoteTokenFile: string,
  rootDir?: string,
  perm?: string,
): Promise<number> {
  // 会话级独立进程架构:每次连接启动独立 agent(随机端口)。
  // 注意:不能 pkill 该二进制 —— 同一服务器可能有多会话 agent 实例在运行,
  // pkill -f 会误杀其他会话正在执行的命令(导致响应丢失、"命令卡住")。
  // 二进制更新由部署链路(needDeploy)统一处理,此处只负责启动新实例。

  // 随机端口启动(--port 0),从输出解析实际监听端口
  const startOutput = await startAgentBackground(
    client,
    remoteBinary,
    remoteTokenFile,
    0,
    rootDir,
    perm,
  );
  const portMatch = startOutput.match(/listening on \S+:(\d+)/);
  if (!portMatch) {
    throw new Error(
      `Agent failed to start (root: ${rootDir || "(unset)"}, perm: ${perm || "workspace"}). ` +
        `Output: ${startOutput}`,
    );
  }
  const actualPort = parseInt(portMatch[1], 10);
  return actualPort;
}
