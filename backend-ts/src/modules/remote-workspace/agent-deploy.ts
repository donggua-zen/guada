/**
 * Agent deployer — SSH 自动部署 Go Agent 二进制 + 端口转发 + WebSocket 连接
 *
 * 流程:
 * 1. SSH 连接到远端
 * 2. 检查 ~/.guada-agent/guada-agent 是否存在且版本匹配
 * 3. 不存在或版本不匹配 → 检测远端 OS+架构 → 获取对应二进制（调试阶段:本地缓存文件夹复制;TODO: 下载地址待配置）→ 上传到远端
 * 4. 启动 agent: ~/.guada-agent/guada-agent --port 0 (随机端口)
 * 5. 解析 stdout 获取 "listening on 127.0.0.1:PORT"
 * 6. SSH 端口转发: 本地随机端口 → 远端 127.0.0.1:PORT
 * 7. 返回本地 WebSocket URL
 *
 * dev 模式跳过部署，直接连接手动启动的 agent。
 */

import { Client, type ConnectConfig } from "ssh2";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import * as https from "https";
import * as crypto from "crypto";
import type { ParsedWorkspaceUri } from "../../common/workspace/workspace-provider.interface";

const REMOTE_DIR = ".guada-agent";
const REMOTE_BINARY_NAME = "guada-agent";

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

export interface AgentConnectionInfo {
  wsUrl: string;
  localPort: number;
  sshClient: Client | null;
  /** 访问令牌,用于 WebSocket 握手鉴权(dev 模式为空字符串) */
  token: string;
}

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

  const sshConfig = buildSshConfig(uri);
  const sshClient = await sshConnect(sshConfig);

  try {
    // Step 1: ensure remote dir exists
    const remoteHome = (await execCommand(sshClient, "echo $HOME")).trim();
    const remoteDir = `${remoteHome}/${REMOTE_DIR}`;
    const remoteBinary = `${remoteDir}/${REMOTE_BINARY_NAME}`;
    await execCommand(sshClient, `mkdir -p ${remoteDir}`);

    // Step 1.5: ensure access token file exists on remote (agent auth)
    const token = getOrCreateToken();
    await writeRemoteToken(sshClient, remoteDir, token);

    // Step 2: check if agent exists + version
    const versionCheck = await execCommand(
      sshClient,
      `${remoteBinary} --version 2>/dev/null || echo "NOT_FOUND"`,
    );
    const remoteVersion = versionCheck.trim();

    // 期望版本:配置了 latest 接口时取最新版本号,与远端严格比较;
    // 不一致(或未安装)即重新下载推送;未配置 latest 时按 NOT_FOUND 判断。
    const expectedVersion = latestVersionUrl
      ? (await fetchLatestVersion(latestVersionUrl)).version
      : "";
    const needDeploy = expectedVersion
      ? remoteVersion !== expectedVersion
      : remoteVersion === "NOT_FOUND";

    if (needDeploy) {
      // Step 3: detect remote OS + arch
      const osRaw = (await execCommand(sshClient, "uname -s")).trim().toLowerCase();
      const archRaw = (await execCommand(sshClient, "uname -m")).trim();

      const osName = osRaw === "darwin" ? "darwin" : "linux";
      const goArch = (archRaw === "aarch64" || archRaw === "arm64") ? "arm64" : "amd64";

      // Download binary to local cache (if not cached, and download URL configured)
      const localBinary = await ensureLocalBinary(osName, goArch, downloadUrl, latestVersionUrl);

      // 先清理远端旧 agent 进程:运行中的二进制被占用时,fastPut 覆盖会失败(ETXTBSY → code 4)
      await execCommand(sshClient, `pkill -f "${remoteBinary}" 2>/dev/null || true`);

      // Upload via SFTP
      await uploadFile(sshClient, localBinary, remoteBinary);
      await execCommand(sshClient, `chmod +x ${remoteBinary}`);
    }

    // Step 4: ensure agent is running on a known fixed port
    const remotePort = await ensureAgentRunning(
      sshClient,
      remoteBinary,
      `${remoteDir}/.token`,
      needDeploy,
      uri.path,
      uri.query?.perm,
      expectedVersion,
    );

    // Step 5: port forward
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

  const sshConfig = buildSshConfig(uri);
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
    sshClient = await sshConnect(sshConfig);
    throwIfAborted();
    const remoteHome = (await execCommand(sshClient, "echo $HOME")).trim();
    throwIfAborted();
    const remoteDir = `${remoteHome}/${REMOTE_DIR}`;
    const remoteBinary = `${remoteDir}/${REMOTE_BINARY_NAME}`;
    await execCommand(sshClient, `mkdir -p ${remoteDir}`);
    push(`Remote directory ready: ${remoteDir}`);

    // 确保访问令牌文件已写入远端(agent 鉴权)
    throwIfAborted();
    const token = getOrCreateToken();
    await writeRemoteToken(sshClient, remoteDir, token);
    push("Access token written to remote");

    // 检测是否已安装 + 版本
    throwIfAborted();
    push("Checking remote agent version...");
    const versionCheck = await execCommand(
      sshClient,
      `${remoteBinary} --version 2>/dev/null || echo "NOT_FOUND"`,
    );
    throwIfAborted();
    const remoteVersion = versionCheck.trim();
    push(remoteVersion === "NOT_FOUND" ? "Agent not installed on remote" : `Remote agent version: ${remoteVersion}`);

    // 期望版本:配置了 latest 接口时取最新版本号,与远端严格比较;
    // 一致则复用,不一致(或未安装)则重新下载推送。
    let expectedVersion = "";
    if (latestVersionUrl) {
      throwIfAborted();
      push("Checking for latest version...");
      expectedVersion = (await fetchLatestVersion(latestVersionUrl)).version;
      push(`Latest version: v${expectedVersion}`);
    }
    const needDeploy = expectedVersion
      ? remoteVersion !== expectedVersion
      : remoteVersion === "NOT_FOUND";

    if (!needDeploy) {
      push(`Agent already installed with matching version (v${remoteVersion})`);
      return { success: true, installed: true, version: remoteVersion, log };
    }

    push(
      remoteVersion === "NOT_FOUND"
        ? "Agent not installed, starting deployment"
        : `Remote version ${remoteVersion} differs from expected ${expectedVersion}, redeploying`,
    );

    // 检测远端 OS + 架构
    throwIfAborted();
    push("Detecting remote platform...");
    const osRaw = (await execCommand(sshClient, "uname -s")).trim().toLowerCase();
    const archRaw = (await execCommand(sshClient, "uname -m")).trim();
    const osName = osRaw === "darwin" ? "darwin" : "linux";
    const goArch = (archRaw === "aarch64" || archRaw === "arm64") ? "arm64" : "amd64";
    push(`Remote platform: ${osName}/${goArch}`);

    // 获取本地二进制(本地缓存优先;配置下载地址/latest 接口时自动获取最新版)
    throwIfAborted();
    push("Acquiring deployment resource (local cache / download)...");
    const localBinary = await ensureLocalBinary(
      osName,
      goArch,
      downloadUrl,
      latestVersionUrl,
      // 下载进度回调:格式化输出,避免用户觉得卡住
      (downloaded, total) => {
        if (total > 0) {
          const pct = Math.min(100, Math.round((downloaded / total) * 100));
          const mb = (downloaded / 1048576).toFixed(1);
          const totalMb = (total / 1048576).toFixed(1);
          push(`Downloading deployment resource: ${mb}MB / ${totalMb}MB (${pct}%)`);
        } else {
          push(`Downloading deployment resource: ${(downloaded / 1048576).toFixed(1)}MB`);
        }
      },
      signal,
    );
    throwIfAborted();
    push(`Using local binary: ${localBinary}`);

    // 先清理远端旧 agent 进程(避免运行中的二进制被占用,fastPut 覆盖失败)
    throwIfAborted();
    push("Stopping old agent processes on remote...");
    await execCommand(sshClient, `pkill -f "${remoteBinary}" 2>/dev/null || true`);

    // 上传 + 授权
    throwIfAborted();
    push("Uploading deployment resource...");
    await uploadFile(sshClient, localBinary, remoteBinary);
    throwIfAborted();
    await execCommand(sshClient, `chmod +x ${remoteBinary}`);
    push("Binary uploaded");

    // 启动验证(固定端口启动,保证后续连接可发现)
    throwIfAborted();
    push("Starting agent...");
    const remotePort = await ensureAgentRunning(
      sshClient,
      remoteBinary,
      `${remoteDir}/.token`,
      needDeploy,
      uri.path,
      uri.query?.perm,
      expectedVersion,
    );
    push(`Agent started successfully, listening on port ${remotePort}`);
    push("Deployment verified");

    return { success: true, installed: false, version: expectedVersion, log };
  } catch (err: any) {
    if (err?.cancelled) {
      push("Deployment cancelled");
    } else {
      push(`Deployment failed: ${err?.message || err}`);
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
function fetchLatestVersion(latestUrl: string): Promise<AgentLatestInfo> {
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
async function ensureLocalBinary(
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

      stream.on("data", (data: Buffer) => {
        output += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderrOutput += data.toString();
      });
      stream.on("close", () => {
        clearTimeout(timer);
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
    const timer = setTimeout(() => {
      reject(new Error("Agent start timeout (10s)"));
    }, 10000);

    // 权限参数:工作目录(--root)无论权限模式都必须传递,
    // 它是命令行/文件编辑的相对路径基准;权限模式默认为 workspace。
    const permArg = perm && perm !== "workspace" ? ` --perm ${perm}` : "";
    const rootArg = rootDir ? ` --root '${rootDir}'` : "";

    client.exec(
      `nohup ${remoteBinary} --port ${port} --token-file ${remoteTokenFile}${permArg}${rootArg} 2>&1 &`,
      (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(new Error(`Agent 启动命令执行失败: ${err.message || err}`));
          return;
        }

        let output = "";

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
            reject(new Error(`Agent didn't report listening. Output: ${output}`));
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

/** agent 固定监听端口池(避免随机端口导致后续连接无法发现) */
const AGENT_PORTS = [19876, 19877, 19878, 19879, 19880];

/** 检查远端端口上的 agent 是否健康且版本与期望一致(期望为空时仅检查健康) */
async function checkAgentHealth(
  client: Client,
  port: number,
  expectedVersion?: string,
): Promise<boolean> {
  const result = await execCommand(
    client,
    `curl -s --connect-timeout 1 http://127.0.0.1:${port}/health 2>/dev/null || true`,
  );
  if (!result.includes('"status":"ok"')) return false;
  // 有期望版本时要求严格一致,否则视为不可复用(需重启推送新版)
  if (expectedVersion) {
    return result.includes(`"version":"${expectedVersion}"`);
  }
  return true;
}

/** 挑选一个未被占用的固定端口 */
async function pickFreeAgentPort(client: Client): Promise<number> {
  for (const port of AGENT_PORTS) {
    const result = await execCommand(
      client,
      `ss -tln 2>/dev/null | grep -qE "[:.]${port} " && echo BUSY || echo FREE`,
    );
    if (result.trim() !== "BUSY") return port;
  }
  return AGENT_PORTS[0];
}

/**
 * 确保远端 agent 正在运行,返回其监听端口。
 * - 已有健康且版本匹配的 agent → 直接复用;
 * - restart=true(版本不匹配/重新部署后)或没有健康 agent → 清理残留进程,固定端口重启。
 */
async function ensureAgentRunning(
  client: Client,
  remoteBinary: string,
  remoteTokenFile: string,
  restart: boolean,
  rootDir?: string,
  perm?: string,
  expectedVersion?: string,
): Promise<number> {
  // 1) 复用已运行的健康 agent(版本与期望一致才复用,避免频繁重启)
  if (!restart) {
    for (const port of AGENT_PORTS) {
      if (await checkAgentHealth(client, port, expectedVersion)) {
        return port;
      }
    }
  }

  // 2) 清理残留进程(可能以 --port 0 随机端口启动的旧版本,无法被发现)
  await execCommand(client, `pkill -f "${remoteBinary}" 2>/dev/null || true`);

  // 3) 挑空闲固定端口并启动
  const port = await pickFreeAgentPort(client);
  const startOutput = await startAgentBackground(
    client,
    remoteBinary,
    remoteTokenFile,
    port,
    rootDir,
    perm,
  );
  const portMatch = startOutput.match(/listening on \S+:(\d+)/);
  if (!portMatch) {
    throw new Error(`Agent failed to start. Output: ${startOutput}`);
  }
  const actualPort = parseInt(portMatch[1], 10);
  if (actualPort !== port) {
    throw new Error(
      `Agent started on unexpected port ${actualPort}, expected ${port}`,
    );
  }
  return actualPort;
}
