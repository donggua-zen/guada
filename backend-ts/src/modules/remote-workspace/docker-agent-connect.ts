/**
 * Docker 容器工作区 — agent 注入与连接（与 agent-deploy.ts 的 SSH 链路平行）。
 *
 * 与 SSH 的差异（为什么不需要端口转发/sshd/token）：
 * - 传输：`docker exec -i <container> <agent> --stdio` 的 stdio 管道直连宿主后端
 *   （NDJSON JSON-RPC，实验已证 Windows 管道字节安全、大消息无损），无需容器端口映射；
 * - 注入：`docker cp` 静态二进制（linux/amd64、linux/arm64）+ `chmod`，等价 SSH 的 SFTP 上传；
 * - 生命周期：agent 随管道关闭自行退出（docker 守护进程在客户端断开时关闭 exec 流）；
 *   本模块绝不 stop/rm 用户容器，只在注入/重连时 pkill 残留 agent 进程。
 *
 * 边界（v1）：容器需有 `sh`（agent 的 execute 依赖 sh -c，镜像本身也需可用 shell 才能 mkdir 等）；
 * distroless/scratch 与只读 rootfs 不支持（报错明确）。
 */
import { spawn } from "child_process";
import { Logger } from "@nestjs/common";
import { RpcClient } from "./rpc";
import { StreamRpcTransport } from "./rpc-stream-transport";
import { ensureLocalBinary, fetchLatestVersion } from "./agent-deploy";

const logger = new Logger("DockerAgent");

/** agent 安装目录候选（按序探测可写/可执行；容器内 /tmp 常被 noexec 挂载时回退） */
export const DOCKER_AGENT_DIR_CANDIDATES = ["/tmp", "/var/tmp", "/dev/shm"];
const AGENT_SUBDIR = ".guada-agent";
const AGENT_BINARY = "guada-agent";
/** 单次 docker CLI 调用超时（注入/上传可能更大，单独放宽） */
const DOCKER_CMD_TIMEOUT_MS = 30_000;
const DOCKER_TRANSFER_TIMEOUT_MS = 120_000;

/**
 * 容器工作区所需的最低 agent 版本：0.6.0 起提供 `--stdio` 传输。
 * 低于该版本的 agent 无法在容器内工作（实测：旧版 agent 收到 --stdio 会打印
 * flag usage 并退出，握手静默失败）——因此 Docker 链路：
 * 1) 复用容器内既有 agent 前先校验版本满足下限；
 * 2) latest 接口返回的版本低于下限时忽略之（避免把"线上未更新的旧版"降级注入），
 *    退回本地缓存二进制；
 * 3) 注入后仍不满足下限则明确报错，而不是留下一个必然失败的连接。
 */
export const MIN_AGENT_VERSION_FOR_CONTAINER = "0.6.0";

/** 比较点分版本号：a >= b 返回 true（仅数字段，位数不同按 0 补齐） */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = String(a || "").trim().split(".").map((s) => parseInt(s, 10) || 0);
  const pb = String(b || "").trim().split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export interface DockerConnectionConfig {
  /** 连接类型判别字段（与 SSH 配置共同构成 RemoteConnectionConfig 联合类型） */
  kind: "docker";
  /** 容器名或 ID（运行中；GuaDa 不创建/不销毁容器） */
  container: string;
  /** 容器内工作目录（agent --root，命令与相对路径的基准）；缺省用容器 WorkingDir */
  path?: string;
  /** agent 权限模式：readonly | workspace | unrestricted（默认 workspace，容器内强制） */
  perm?: string;
  /** Docker 主机（docker -H，如 tcp://host:2375、ssh://user@host 或 context 名）；缺省本机 */
  dockerHost?: string;
}

export interface DockerRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 组装 docker CLI 参数（-H 覆盖 Docker 主机；缺省走本机默认上下文） */
export function buildDockerArgs(
  config: Pick<DockerConnectionConfig, "dockerHost">,
  args: string[],
): string[] {
  return config.dockerHost ? ["-H", config.dockerHost, ...args] : args;
}

/**
 * 运行一次性 docker 命令并捕获输出。
 * 超时/中止即杀本地客户端进程（容器内进程随后因流关闭自行退出）。
 */
export function runDocker(
  config: Pick<DockerConnectionConfig, "dockerHost">,
  args: string[],
  opts: { input?: string; timeoutMs?: number; signal?: AbortSignal; errorHint?: string } = {},
): Promise<DockerRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", buildDockerArgs(config, args), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(
        new Error(
          `docker ${args[0]} 超时(${opts.timeoutMs ?? DOCKER_CMD_TIMEOUT_MS}ms)` +
            (opts.errorHint ? ` — ${opts.errorHint}` : ""),
        ),
      );
    }, opts.timeoutMs ?? DOCKER_CMD_TIMEOUT_MS);
    timer.unref?.();

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("docker command aborted"));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (d) => (stdout += d.toString("utf-8")));
    child.stderr?.on("data", (d) => (stderr += d.toString("utf-8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`docker CLI 不可用（${err.message}）— 请确认已安装 Docker 且已启动`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    } else {
      child.stdin?.end();
    }
  });
}

// ── 容器/镜像信息（纯函数解析，便于单测） ──

export interface ContainerInfo {
  /** 容器名（不含 inspect 输出的前导 /） */
  name: string;
  running: boolean;
  /** 镜像 ID（sha256:...） */
  image: string;
  /** 容器默认工作目录（path 未配置时用作 --root） */
  workingDir: string;
  /** 镜像 OS（容器应为 linux） */
  os: string;
  /** 镜像 Architecture（amd64 / arm64 / ...） */
  arch: string;
}

/** `docker inspect --format '{{.State.Running}}|{{.Image}}|{{.Config.WorkingDir}}|{{.Name}}'` 的解析 */
export function parseContainerInspect(raw: string): {
  running: boolean;
  image: string;
  workingDir: string;
  name: string;
} {
  const line = raw.trim().split("\n")[0] || "";
  const parts = line.split("|");
  const [running, image, workingDir, name] = [
    parts[0] ?? "",
    parts[1] ?? "",
    parts[2] ?? "",
    parts[3] ?? "",
  ];
  return {
    running: running.trim() === "true",
    image: image.trim(),
    workingDir: workingDir.trim() || "/",
    name: name.trim().replace(/^\//, ""),
  };
}

/** `docker image inspect --format '{{.Os}}|{{.Architecture}}'` 的解析 */
export function parseImageInspect(raw: string): { os: string; arch: string } {
  const line = raw.trim().split("\n")[0] || "";
  const [os, arch] = line.split("|");
  return { os: (os || "").trim().toLowerCase(), arch: (arch || "").trim().toLowerCase() };
}

/**
 * 容器镜像平台 → agent 二进制平台。
 * agent 为 POSIX 静态二进制，只提供 linux/amd64 与 linux/arm64。
 */
export function mapContainerPlatform(
  os: string,
  arch: string,
): { ok: true; goArch: "amd64" | "arm64" } | { ok: false; reason: string } {
  if (os !== "linux") {
    return { ok: false, reason: `不支持 ${os} 容器（guada-agent 为 Linux 二进制，Windows 容器请改用 SSH 工作区）` };
  }
  if (arch === "amd64" || arch === "x86_64") return { ok: true, goArch: "amd64" };
  if (arch === "arm64" || arch === "aarch64") return { ok: true, goArch: "arm64" };
  return { ok: false, reason: `不支持容器架构 ${arch}（仅 linux/amd64、linux/arm64）` };
}

/**
 * 探测容器：运行状态 + 镜像平台 + 默认工作目录。
 * 一次 docker inspect + 一次 docker image inspect（不经容器内任何可执行文件）。
 */
export async function inspectContainer(
  config: DockerConnectionConfig,
  signal?: AbortSignal,
): Promise<ContainerInfo> {
  const container = config.container?.trim();
  if (!container) throw new Error("未配置容器名（container）");
  const inspect = await runDocker(
    config,
    [
      "inspect",
      "--format",
      "{{.State.Running}}|{{.Image}}|{{.Config.WorkingDir}}|{{.Name}}",
      container,
    ],
    { signal, errorHint: `容器 '${container}' 不存在或 Docker 不可用` },
  );
  if (inspect.code !== 0) {
    const detail = (inspect.stderr || inspect.stdout).trim().split("\n").slice(-1)[0] || "";
    throw new Error(`无法读取容器 '${container}'：${detail || "docker inspect 失败"}`);
  }
  const base = parseContainerInspect(inspect.stdout);
  if (!base.running) {
    throw new Error(`容器 '${base.name || container}' 未在运行，请先启动容器（docker start）后重试`);
  }
  const imgInspect = await runDocker(
    config,
    ["image", "inspect", "--format", "{{.Os}}|{{.Architecture}}", base.image],
    { signal, errorHint: `镜像 ${base.image} 未找到` },
  );
  if (imgInspect.code !== 0) {
    throw new Error(
      `无法读取容器镜像平台信息：${(imgInspect.stderr || "").trim().split("\n").slice(-1)[0] || "docker image inspect 失败"}`,
    );
  }
  const img = parseImageInspect(imgInspect.stdout);
  return { ...base, os: img.os, arch: img.arch };
}

// ── agent 注入 ──

/** docker exec 一次性执行（不经 shell 时的命令同样支持；需 shell 语义时显式传 sh -c） */
async function dockerExec(
  config: DockerConnectionConfig,
  container: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DockerRunResult> {
  return runDocker(config, ["exec", container, ...args], opts);
}

/** 读取容器内 agent 版本；不存在/不可执行返回 ""（不抛错） */
async function getAgentVersion(
  config: DockerConnectionConfig,
  container: string,
  binaryPath: string,
): Promise<string> {
  try {
    const r = await dockerExec(config, container, [binaryPath, "--version"], { timeoutMs: 15_000 });
    if (r.code !== 0) return "";
    const v = r.stdout.trim();
    // 版本号形如 0.6.0；异常输出（如 shell 报错混入）视为不可用
    return /^\d+\.\d+\.\d+/.test(v) ? v.split("\n")[0].trim() : "";
  } catch {
    return "";
  }
}

/** 终止容器内残留 agent（best-effort；容器可能无 pkill/coreutils） */
export async function killAgentInContainer(
  config: DockerConnectionConfig,
  container: string,
): Promise<void> {
  try {
    await dockerExec(config, container, ["sh", "-c", "pkill -f guada-agent 2>/dev/null || true"], {
      timeoutMs: 15_000,
    });
  } catch {
    /* best-effort */
  }
}

export interface EnsureAgentResult {
  /** 容器内 agent 安装目录 */
  agentDir: string;
  /** 容器内 agent 二进制绝对路径 */
  binaryPath: string;
  /** 容器内 agent 版本 */
  version: string;
  /** 本次是否重新注入（false = 复用容器内已有二进制） */
  injected: boolean;
  /** 过程日志（部署向导逐行展示） */
  log: string[];
}

/**
 * 确保容器内存在与期望版本一致的 agent 二进制。
 *
 * 逐候选目录（/tmp → /var/tmp → /dev/shm）尝试：mkdir → 版本检查（复用则直接返回）
 * → docker cp 注入 + chmod → 再次版本检查（验证可执行）。全部候选失败时给出聚合错误。
 * 期望版本来自 latest 接口；接口不可达时容忍并回退为"缺失即注入"（不因离线阻塞连接）。
 */
export async function ensureAgentInContainer(
  config: DockerConnectionConfig,
  container: ContainerInfo,
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<EnsureAgentResult> {
  const platform = mapContainerPlatform(container.os, container.arch);
  // 注：项目 tsconfig 为 strictNullChecks:false，布尔判别式需用 === 显式比较才收窄
  if (platform.ok === false) throw new Error(platform.reason);

  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    opts.onLog?.(line);
  };

  // 期望版本：配置了 latest 接口时用于升级判定；接口不可达时容忍（离线/内网也不阻塞连接）。
  // 特别注意：latest 指向的版本可能低于容器所需下限（0.6.0）——此时忽略该版本，
  // 否则会按"升级"逻辑把旧版 agent 注入容器，连接必然失败（旧版无 --stdio）。
  let expectedVersion = "";
  if (opts.latestVersionUrl) {
    try {
      const latest = (await fetchLatestVersion(opts.latestVersionUrl)).version;
      if (versionAtLeast(latest, MIN_AGENT_VERSION_FOR_CONTAINER)) {
        expectedVersion = latest;
        push(`Expected agent version: ${expectedVersion}`);
      } else {
        push(
          `Published agent v${latest} is older than the container minimum v${MIN_AGENT_VERSION_FOR_CONTAINER}; ` +
            `using the local cached binary instead (publish a newer agent to upgrade).`,
        );
      }
    } catch (err: any) {
      push(`Latest version check failed (ignored): ${err?.message || err}`);
    }
  }

  const errors: string[] = [];
  for (const base of DOCKER_AGENT_DIR_CANDIDATES) {
    const agentDir = `${base}/${AGENT_SUBDIR}`;
    const binaryPath = `${agentDir}/${AGENT_BINARY}`;
    try {
      // 目录必须先存在：docker cp 不会创建中间目录；只读 rootfs 在此失败
      const mk = await dockerExec(config, container.name, ["sh", "-c", `mkdir -p '${agentDir}'`], {
        signal: opts.signal,
      });
      if (mk.code !== 0) {
        errors.push(`${agentDir}: ${(mk.stderr || mk.stdout).trim().split("\n").slice(-1)[0] || "目录不可写"}`);
        continue;
      }

      // 快路径：容器内已有可用（且满足 stdio 版本下限）且版本匹配的二进制 → 直接复用
      const existing = await getAgentVersion(config, container.name, binaryPath);
      if (existing && !versionAtLeast(existing, MIN_AGENT_VERSION_FOR_CONTAINER)) {
        push(
          `Container has agent v${existing} which predates container support (>= ${MIN_AGENT_VERSION_FOR_CONTAINER}); re-injecting.`,
        );
      } else if (existing && (!expectedVersion || existing === expectedVersion)) {
        push(`Agent v${existing} already present at ${binaryPath}`);
        return { agentDir, binaryPath, version: existing, injected: false, log };
      }

      // 注入：本地缓存（或下载）→ docker cp → chmod。
      // 注意 expectedVersion 已在上面完成下限过滤：低于下限时以空值走"本地缓存优先"分支，
      // 避免把旧版 agent 从网络拉下来注入。
      const localBinary = await ensureLocalBinary(
        "linux",
        platform.goArch,
        opts.downloadUrl,
        expectedVersion ? opts.latestVersionUrl : undefined,
        (downloaded, total) =>
          push(`Downloading agent binary... ${total ? Math.round((downloaded / total) * 100) + "%" : downloaded + "B"}`),
        opts.signal,
      );
      push(`Uploading ${AGENT_BINARY} (${platform.goArch}) to container ${container.name}:${binaryPath}`);
      await killAgentInContainer(config, container.name);
      const cp = await runDocker(
        config,
        ["cp", localBinary, `${container.name}:${binaryPath}`],
        { signal: opts.signal, timeoutMs: DOCKER_TRANSFER_TIMEOUT_MS },
      );
      if (cp.code !== 0) {
        errors.push(`${agentDir}: docker cp 失败 — ${(cp.stderr || "").trim().split("\n").slice(-1)[0]}`);
        continue;
      }
      // 权限位：docker cp 保留源文件模式，但 Windows 宿主下不可靠 → 显式 chmod（无 chmod 的镜像靠 cp 自身的模式位）
      await dockerExec(config, container.name, ["chmod", "755", binaryPath], { timeoutMs: 15_000 });
      push(`Injected agent binary to ${binaryPath}`);

      const injected = await getAgentVersion(config, container.name, binaryPath);
      if (injected && !versionAtLeast(injected, MIN_AGENT_VERSION_FOR_CONTAINER)) {
        errors.push(
          `${agentDir}: 注入的 agent v${injected} 不支持容器工作区（需要 >= ${MIN_AGENT_VERSION_FOR_CONTAINER}）——` +
            `本地缓存二进制过旧，请更新 ${opts.downloadUrl ? "下载地址配置" : "本地缓存 ~/.guada/agent/guada-agent-linux-" + platform.goArch}`,
        );
        continue;
      }
      if (injected) {
        return { agentDir, binaryPath, version: injected, injected: true, log };
      }
      errors.push(
        `${agentDir}: 注入后无法执行（该目录可能以 noexec 挂载，或镜像缺少可执行权限支持）`,
      );
    } catch (err: any) {
      errors.push(`${agentDir}: ${err?.message || err}`);
    }
  }

  throw new Error(
    `无法在容器 '${container.name}' 内安装 agent（已尝试 ${DOCKER_AGENT_DIR_CANDIDATES.join("、")}）：\n` +
      errors.map((e) => `  - ${e}`).join("\n") +
      `\n请确认容器可写（rootfs 非只读）且不限制 /tmp 执行；distroless 等无 shell 镜像暂不支持。`,
  );
}

/** 校验容器内目录存在（path 配置的工作目录） */
export async function assertDirInContainer(
  config: DockerConnectionConfig,
  container: string,
  dir: string,
): Promise<void> {
  const r = await dockerExec(config, container, ["sh", "-c", `test -d '${dir.replace(/'/g, "'\\''")}' && echo OK || echo MISSING`], {
    timeoutMs: 15_000,
  });
  if (!r.stdout.includes("OK")) {
    throw new Error(
      `容器内工作目录不存在：${dir} — 请在连接配置中改选一个已存在的目录（容器内路径，如 /app、/workspace）`,
    );
  }
}

// ── 连接 ──

export interface DockerAgentConnectResult {
  rpc: RpcClient;
  transport: StreamRpcTransport;
  container: ContainerInfo;
  agentDir: string;
  binaryPath: string;
  version: string;
  /** 生效的工作目录基准（path 未配置时取容器 WorkingDir） */
  rootPath: string;
}

/**
 * 部署（如需）+ 建立 stdio 长连接。
 * 返回的 RpcClient 与 SSH 链路语义完全一致（超时/心跳/cancel/shutdown 推送）。
 */
export async function connectDockerAgent(
  config: DockerConnectionConfig,
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<DockerAgentConnectResult> {
  const container = await inspectContainer(config, opts.signal);
  opts.onLog?.(`Container '${container.name}' is running (${container.os}/${container.arch})`);

  const ensured = await ensureAgentInContainer(config, container, opts);

  const rootPath = (config.path || container.workingDir || "/").trim() || "/";
  await assertDirInContainer(config, container.name, rootPath);

  const perm = config.perm && config.perm !== "workspace" ? config.perm : "workspace";
  const execArgs = [
    "exec",
    "-i",
    container.name,
    ensured.binaryPath,
    "--stdio",
    "--root",
    rootPath,
    "--perm",
    perm,
  ];
  opts.onLog?.(`Starting agent (stdio): --root ${rootPath} --perm ${perm}`);

  const transport = StreamRpcTransport.spawn("docker", buildDockerArgs(config, execArgs), {
    label: "stdio pipe",
  });
  const rpc = new RpcClient(transport);
  rpc.setConnected();

  try {
    const pong = await rpc.call<{ pong: string; version?: string; root?: string }>(
      "ping",
      undefined,
      opts.signal,
      20_000,
    );
    if (!pong?.pong) throw new Error("agent ping 未返回预期响应");
    if (pong.root && pong.root.replace(/\/+$/, "") !== rootPath.replace(/\/+$/, "")) {
      // 符号链接解析等可能导致轻微差异：仅告警，不阻断（与 SSH 链路一致不做强校验）
      logger.warn(
        `agent root mismatch: requested '${rootPath}', agent reports '${pong.root}' (container ${container.name})`,
      );
    }
    opts.onLog?.(`Agent connected: v${pong.version || ensured.version}, root ${pong.root || rootPath}`);
  } catch (err: any) {
    transport.close();
    const stderrTail = transport.getStderrTail();
    throw new Error(
      `agent 握手失败：${err?.message || err}` + (stderrTail ? ` — ${stderrTail.slice(-300)}` : ""),
    );
  }

  return {
    rpc,
    transport,
    container,
    agentDir: ensured.agentDir,
    binaryPath: ensured.binaryPath,
    version: ensured.version,
    rootPath,
  };
}

// ── 供向导使用的辅助（测试连接 / 目录浏览 / 容器列表） ──

/** 容器列表（运行中），供前端连接向导选择 */
export async function listDockerContainers(
  config: Pick<DockerConnectionConfig, "dockerHost">,
  signal?: AbortSignal,
): Promise<{ name: string; image: string; status: string }[]> {
  const r = await runDocker(
    config,
    ["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"],
    { signal, errorHint: "Docker 未运行或不可访问" },
  );
  if (r.code !== 0) {
    throw new Error(
      `无法列出容器：${(r.stderr || "").trim().split("\n").slice(-1)[0] || "docker ps 失败"}（请确认 Docker 已启动）`,
    );
  }
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, image, status] = line.split("\t");
      return { name: name || "", image: image || "", status: status || "" };
    })
    .filter((c) => c.name);
}

/**
 * 容器内目录浏览（向导第 2 步）。
 * 复用 SSH 链路的 POSIX browse 命令（ls -la + awk），经 docker exec sh -c 执行。
 */
export async function browseDockerPath(
  config: DockerConnectionConfig,
  buildBrowseCommand: (dirPath: string) => string,
  parseBrowseOutput: (raw: string) => { path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] },
  dirPath: string,
  signal?: AbortSignal,
): Promise<{ path: string; exists: boolean; entries: { name: string; isDirectory: boolean; size: number }[] }> {
  const r = await dockerExec(
    config,
    config.container,
    ["sh", "-c", buildBrowseCommand(dirPath)],
    { timeoutMs: 20_000, signal },
  );
  if (r.code !== 0 && !r.stdout.trim()) {
    throw new Error(
      `容器内目录浏览失败：${(r.stderr || "").trim().split("\n").slice(-1)[0] || "命令执行失败（镜像可能缺少 ls/awk）"}`,
    );
  }
  return parseBrowseOutput(r.stdout);
}

/** 连接测试（向导第 1 步）：inspect + 注入 + 校验工作目录 + 握手，随后关闭 */
export async function testDockerConnection(
  config: DockerConnectionConfig,
  opts: { downloadUrl?: string; latestVersionUrl?: string; signal?: AbortSignal } = {},
): Promise<{ success: boolean; error?: string; log?: string }> {
  const log: string[] = [];
  try {
    const conn = await connectDockerAgent(config, { ...opts, onLog: (l) => log.push(l) });
    log.push("Connection OK (stdio agent handshake succeeded).");
    conn.rpc.close();
    return { success: true, log: log.join("\n") };
  } catch (err: any) {
    log.push(`Error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err), log: log.join("\n") };
  }
}

/** 部署验证（向导第 4 步）：注入 + 起一次短连接验证，等价 SSH 的 verifyAndDeployAgent */
export async function verifyAndDeployDockerAgent(
  config: DockerConnectionConfig,
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
    const container = await inspectContainer(config, signal);
    push(`Container '${container.name}' is running (${container.os}/${container.arch})`);
    const ensured = await ensureAgentInContainer(config, container, {
      downloadUrl,
      latestVersionUrl,
      onLog: onLog,
      signal,
    });
    push(`Agent v${ensured.version} ready at ${ensured.binaryPath}`);
    // 目录预校验：连接配置的 path 就是 agent 的 --root（与 SSH 部署验证一致）
    const rootPath = (config.path || container.workingDir || "/").trim() || "/";
    await assertDirInContainer(config, container.name, rootPath);
    push(`Workspace path exists in container: ${rootPath}`);
    return { success: true, installed: !ensured.injected, version: ensured.version, log };
  } catch (err: any) {
    push(`Deployment failed: ${String(err?.message || err).split("\n")[0]}`);
    return { success: false, installed: false, version: "", log };
  }
}
