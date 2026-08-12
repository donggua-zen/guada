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

const AGENT_VERSION = "0.3.0";
const REMOTE_DIR = ".guada-agent";
const REMOTE_BINARY_NAME = "guada-agent";

// TODO: 下载地址模板待配置(后续支持自建服务器/自定义地址)。
// 调试阶段不使用网络下载,二进制通过本地文件夹复制放入缓存目录。
// const GITHUB_RELEASE_URL = `https://github.com/.../releases/download/v${AGENT_VERSION}/guada-agent-{os}-{arch}`;

// 本地缓存目录: ~/.guada/agent/
function localCacheDir(): string {
  return path.join(os.homedir(), ".guada", "agent");
}

function localCachedBinary(osName: string, goArch: string): string {
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

    if (remoteVersion !== AGENT_VERSION) {
      // Step 3: detect remote OS + arch
      const osRaw = (await execCommand(sshClient, "uname -s")).trim().toLowerCase();
      const archRaw = (await execCommand(sshClient, "uname -m")).trim();

      const osName = osRaw === "darwin" ? "darwin" : "linux";
      const goArch = (archRaw === "aarch64" || archRaw === "arm64") ? "arm64" : "amd64";

      // Download binary to local cache (if not cached)
      const localBinary = await ensureLocalBinary(osName, goArch);

      // Upload via SFTP
      await uploadFile(sshClient, localBinary, remoteBinary);
      await execCommand(sshClient, `chmod +x ${remoteBinary}`);
    }

    // Step 4: ensure agent is running on a known fixed port
    const remotePort = await ensureAgentRunning(
      sshClient,
      remoteBinary,
      `${remoteDir}/.token`,
      remoteVersion !== AGENT_VERSION,
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
 */
export async function verifyAndDeployAgent(
  uri: ParsedWorkspaceUri,
): Promise<DeployResult> {
  const log: string[] = [];

  // dev 模式:跳过部署验证
  if (uri.query?.devMode === "1") {
    return { success: true, installed: true, version: "", log: ["dev 模式,跳过部署验证"] };
  }

  const sshConfig = buildSshConfig(uri);
  let sshClient: Client | null = null;
  try {
    sshClient = await sshConnect(sshConfig);
    const remoteHome = (await execCommand(sshClient, "echo $HOME")).trim();
    const remoteDir = `${remoteHome}/${REMOTE_DIR}`;
    const remoteBinary = `${remoteDir}/${REMOTE_BINARY_NAME}`;
    await execCommand(sshClient, `mkdir -p ${remoteDir}`);
    log.push(`远端目录就绪: ${remoteDir}`);

    // 确保访问令牌文件已写入远端(agent 鉴权)
    const token = getOrCreateToken();
    await writeRemoteToken(sshClient, remoteDir, token);

    // 检测是否已安装 + 版本
    const versionCheck = await execCommand(
      sshClient,
      `${remoteBinary} --version 2>/dev/null || echo "NOT_FOUND"`,
    );
    const remoteVersion = versionCheck.trim();
    if (remoteVersion === AGENT_VERSION) {
      log.push(`agent 已安装且版本匹配 (v${remoteVersion})`);
      return { success: true, installed: true, version: remoteVersion, log };
    }

    log.push(
      remoteVersion === "NOT_FOUND"
        ? "远端未安装 agent,开始部署"
        : `远端版本 ${remoteVersion} 与期望 ${AGENT_VERSION} 不匹配,开始重新部署`,
    );

    // 检测远端 OS + 架构
    const osRaw = (await execCommand(sshClient, "uname -s")).trim().toLowerCase();
    const archRaw = (await execCommand(sshClient, "uname -m")).trim();
    const osName = osRaw === "darwin" ? "darwin" : "linux";
    const goArch = (archRaw === "aarch64" || archRaw === "arm64") ? "arm64" : "amd64";
    log.push(`远端平台: ${osName}/${goArch}`);

    // 获取本地二进制(调试阶段:本地缓存文件夹;TODO: HTTP 下载)
    const localBinary = await ensureLocalBinary(osName, goArch);
    log.push(`使用本地二进制: ${localBinary}`);

    // 上传 + 授权
    await uploadFile(sshClient, localBinary, remoteBinary);
    await execCommand(sshClient, `chmod +x ${remoteBinary}`);
    log.push("二进制上传完成");

    // 启动验证(固定端口启动,保证后续连接可发现)
    const remotePort = await ensureAgentRunning(
      sshClient,
      remoteBinary,
      `${remoteDir}/.token`,
      remoteVersion !== AGENT_VERSION,
    );
    log.push(`Agent 启动成功,监听端口 ${remotePort}`);
    log.push("部署验证通过");

    return { success: true, installed: false, version: AGENT_VERSION, log };
  } catch (err: any) {
    log.push(`部署失败: ${err?.message || err}`);
    return { success: false, installed: false, version: "", log };
  } finally {
    if (sshClient) sshClient.end();
  }
}

// ── Binary acquisition (local cache; TODO: HTTP download) ──

/**
 * Ensure the agent binary for the given platform is in local cache.
 *
 * 调试阶段:二进制通过本地文件夹复制方式放入缓存目录(见 localCacheDir),
 * 不执行网络下载。若缓存缺失则直接报错,提示手动放置。
 * TODO: 下载地址待配置,启用后在此处实现从 HTTP 下载到缓存。
 */
async function ensureLocalBinary(osName: string, goArch: string): Promise<string> {
  const cached = localCachedBinary(osName, goArch);
  if (fs.existsSync(cached)) {
    return cached;
  }

  // TODO: 下载地址暂未配置,调试阶段请将编译好的二进制复制到缓存目录:
  //   ~/.guada/agent/guada-agent-<os>-<arch>
  throw new Error(
    `本地缓存中未找到 agent 二进制: ${cached}\n` +
      `请先将二进制复制到该路径(调试阶段通过本地文件夹复制),或配置下载地址后重试。`,
  );
}

/** Download a file via HTTPS with redirect support */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      // Follow redirects (GitHub releases return 302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location!, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed: HTTP ${res.statusCode} from ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });
    req.on("error", (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
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
        reject(err);
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
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Agent start timeout (10s)"));
    }, 10000);

    client.exec(
      `nohup ${remoteBinary} --port ${port} --token-file ${remoteTokenFile} 2>&1 &`,
      (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
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
    client.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) {
          reject(err);
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

/** 检查远端端口上的 agent 是否健康且版本匹配 */
async function checkAgentHealth(client: Client, port: number): Promise<boolean> {
  const result = await execCommand(
    client,
    `curl -s --connect-timeout 1 http://127.0.0.1:${port}/health 2>/dev/null || true`,
  );
  return (
    result.includes('"status":"ok"') &&
    result.includes(`"version":"${AGENT_VERSION}"`)
  );
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
): Promise<number> {
  // 1) 复用已运行的健康 agent(避免频繁重启)
  if (!restart) {
    for (const port of AGENT_PORTS) {
      if (await checkAgentHealth(client, port)) {
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
