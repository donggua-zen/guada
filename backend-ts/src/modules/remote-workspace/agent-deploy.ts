/**
 * Agent deployer — SSH 自动部署 Go Agent 二进制 + 端口转发 + WebSocket 连接
 *
 * 流程:
 * 1. SSH 连接到远端
 * 2. 检查 ~/.guada-agent/guada-agent 是否存在且版本匹配
 * 3. 不存在或版本不匹配 → 检测远端 OS+架构 → 下载对应二进制（GitHub Release）→ 上传到远端
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
import type { ParsedWorkspaceUri } from "../../common/workspace/workspace-provider.interface";

const AGENT_VERSION = "0.2.0";
const REMOTE_DIR = ".guada-agent";
const REMOTE_BINARY_NAME = "guada-agent";

// GitHub Release 下载地址模板
// 二进制单独维护在 https://github.com/donggua-sherlock/guada-agent
const GITHUB_RELEASE_URL = `https://github.com/donggua-sherlock/guada-agent/releases/download/v${AGENT_VERSION}/guada-agent-{os}-{arch}`;

// 本地缓存目录: ~/.guada/agent/
function localCacheDir(): string {
  return path.join(os.homedir(), ".guada", "agent");
}

function localCachedBinary(osName: string, goArch: string): string {
  return path.join(localCacheDir(), `guada-agent-${osName}-${goArch}`);
}

export interface AgentConnectionInfo {
  wsUrl: string;
  localPort: number;
  sshClient: Client | null;
}

export async function deployAgent(
  uri: ParsedWorkspaceUri,
): Promise<AgentConnectionInfo> {
  // Dev mode: connect to manually started agent
  if (uri.query?.devMode === "1") {
    const port = parseInt(uri.query?.agentPort || "19876", 10);
    return { wsUrl: `ws://127.0.0.1:${port}`, localPort: port, sshClient: null };
  }

  const sshConfig = buildSshConfig(uri);
  const sshClient = await sshConnect(sshConfig);

  try {
    // Step 1: ensure remote dir exists
    const remoteHome = (await execCommand(sshClient, "echo $HOME")).trim();
    const remoteDir = `${remoteHome}/${REMOTE_DIR}`;
    const remoteBinary = `${remoteDir}/${REMOTE_BINARY_NAME}`;
    await execCommand(sshClient, `mkdir -p ${remoteDir}`);

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

    // Step 4: check if agent is already running
    const runningCheck = await execCommand(
      sshClient,
      `pgrep -f "${remoteBinary}" > /dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"`,
    );

    let remotePort: number;

    if (runningCheck.trim() === "RUNNING") {
      remotePort = await findRunningAgentPort(sshClient, remoteBinary);
    } else {
      const startOutput = await startAgentBackground(sshClient, remoteBinary);
      const portMatch = startOutput.match(/listening on \S+:(\d+)/);
      if (!portMatch) {
        throw new Error(`Agent failed to start. Output: ${startOutput}`);
      }
      remotePort = parseInt(portMatch[1], 10);
    }

    // Step 5: port forward
    const localPort = await setupPortForward(sshClient, remotePort);

    return { wsUrl: `ws://127.0.0.1:${localPort}`, localPort, sshClient };
  } catch (err) {
    sshClient.end();
    throw err;
  }
}

// ── Binary download (GitHub Release → local cache) ──

/**
 * Ensure the agent binary for the given platform is in local cache.
 * Downloads from GitHub Release if not cached.
 */
async function ensureLocalBinary(osName: string, goArch: string): Promise<string> {
  const cached = localCachedBinary(osName, goArch);
  if (fs.existsSync(cached)) {
    return cached;
  }

  // Download
  fs.mkdirSync(localCacheDir(), { recursive: true });
  const url = GITHUB_RELEASE_URL
    .replace("{os}", osName)
    .replace("{arch}", goArch);

  await downloadFile(url, cached);
  return cached;
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

function startAgentBackground(client: Client, remoteBinary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Agent start timeout (10s)"));
    }, 10000);

    client.exec(
      `nohup ${remoteBinary} --port 0 2>&1 &`,
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
      client.forwardOut(
        "127.0.0.1",
        remotePort,
        "127.0.0.1",
        0,
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

async function findRunningAgentPort(client: Client, remoteBinary: string): Promise<number> {
  const commonPorts = [19876, 19877, 19878, 19879, 19880];
  for (const port of commonPorts) {
    const result = await execCommand(
      client,
      `curl -s --connect-timeout 1 http://127.0.0.1:${port}/health 2>/dev/null || true`,
    );
    if (result.includes('"status":"ok"')) {
      return port;
    }
  }

  const procCheck = await execCommand(
    client,
    `for pid in $(pgrep -f "${remoteBinary}"); do cat /proc/$pid/cmdline 2>/dev/null; echo; done`,
  );
  const portMatch = procCheck.match(/--port\s+(\d+)/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (port > 0) return port;
  }

  return 19876;
}
