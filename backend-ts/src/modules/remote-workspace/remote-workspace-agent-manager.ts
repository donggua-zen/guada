/**
 * RemoteAgentManager — maps connection names to RemoteAgentProvider instances.
 *
 * Resolves connection config from RemoteSshService (DB/settings storage),
 * deploys/connects the Go agent via SSH, and caches active connections.
 */

import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";
import { Client as SshClient } from "ssh2";
import { Logger } from "@nestjs/common";
import { deployAgent } from "./agent-deploy";
import { RpcClient } from "./rpc";
import { RemoteWorkspaceService, RemoteConnection } from "./remote-workspace.service";

interface CachedAgent {
  rpc: RpcClient;
  ws: WebSocket;
  sshClient: SshClient | null;
  busy: boolean;
  /** 最近一次被使用的时间戳(ms),用于空闲回收判断 */
  lastActive: number;
}

export class RemoteAgentManager {
  private cache = new Map<string, CachedAgent>();

  /** 空闲回收阈值:连接超过该时长未被使用则主动关闭(默认 2 小时) */
  private static readonly IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
  /** 空闲扫描间隔(1 分钟) */
  private static readonly SCAN_INTERVAL_MS = 60 * 1000;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly service: RemoteWorkspaceService) {
    // 启动空闲回收定时器:周期扫描缓存,关闭并清理长期未使用的连接
    this.scanTimer = setInterval(() => {
      this.reapIdleConnections();
    }, RemoteAgentManager.SCAN_INTERVAL_MS);
    this.scanTimer.unref?.();
  }

  /** 扫描并回收空闲超时的连接(关闭 ws/ssh 并从缓存移除) */
  private reapIdleConnections(): void {
    const now = Date.now();
    for (const [name, cached] of this.cache) {
      if (now - cached.lastActive >= RemoteAgentManager.IDLE_TIMEOUT_MS) {
        this.logger.log(
          `Recycling idle agent connection '${name}' (idle > 2h)`,
        );
        try {
          cached.ws.close();
        } catch {}
        try {
          cached.sshClient?.end();
        } catch {}
        this.cache.delete(name);
      }
    }
  }

  /** 停止空闲扫描并关闭所有缓存连接(模块销毁时调用) */
  dispose(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const [name, cached] of this.cache) {
      try {
        cached.ws.close();
      } catch {}
      try {
        cached.sshClient?.end();
      } catch {}
    }
    this.cache.clear();
    this.logger.log("RemoteAgentManager disposed: all cached connections closed");
  }

  private readonly logger = new Logger(RemoteAgentManager.name);

  /**
   * Get or create an agent connection for the given session + connection name.
   * 会话级隔离:每个 sessionId+连接名 独立缓存/独立进程,互不复用。
   * Only connections bound to the given session (via attachments['ssh-connection'])
   * are considered available. Connection is identified by name only (not ID).
   */
  async getAgent(
    connectionName: string,
    sessionId: string,
    sessionAttachments?: Record<string, string[]>,
  ): Promise<RemoteAgent> {
    const cacheKey = `${sessionId}::${connectionName}`;
    // Find connection config from session attachments
    const connectionIds: string[] = sessionAttachments?.["ssh-connection"] || [];
    if (connectionIds.length === 0) {
      throw new Error(
        "No SSH connections bound to this session. Use the + button to add a remote connection.",
      );
    }

    // Load all connections from service
    const allConnections = await this.service.getConnections();
    // Match by name only
    const conn = allConnections.find((c) => c.name === connectionName);
    if (!conn) {
      // List available connection names for the error message
      const available = allConnections
        .filter((c) => connectionIds.includes(c.id))
        .map((c) => c.name);
      throw new Error(
        `Connection '${connectionName}' not found. Available: ${available.join(", ") || "none"}`,
      );
    }

    // Verify this connection is bound to the session
    if (!connectionIds.includes(conn.id)) {
      // 用户已取消勾选该连接:关闭并清理该会话的缓存,防止任何残留路径继续访问
      const stale = this.cache.get(cacheKey);
      if (stale) {
        this.cache.delete(cacheKey);
        try {
          stale.ws.close();
        } catch {}
      }
      throw new Error(
        `Connection '${connectionName}' is not bound to this session. ` +
          `Please re-select it in the connection picker if you want to use it.`,
      );
    }

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && !cached.busy) {
      cached.lastActive = Date.now();
      return new RemoteAgent(cached.rpc, conn.config);
    }

    // Deploy + connect
    const connInfo = await this.deployAndConnect(conn);
    const cached2: CachedAgent = {
      rpc: connInfo.rpc,
      ws: connInfo.ws,
      sshClient: connInfo.sshClient,
      busy: false,
      lastActive: Date.now(),
    };
    this.cache.set(cacheKey, cached2);
    return new RemoteAgent(cached2.rpc, conn.config);
  }

  private async deployAndConnect(conn: RemoteConnection): Promise<{
    rpc: RpcClient;
    ws: WebSocket;
    sshClient: SshClient | null;
  }> {
    const config = conn.config;
    const params = new URLSearchParams();
    if (config.authMethod === "password" && config.password) {
      params.set("password", config.password);
    }
    if (config.authMethod === "privateKey" && config.privateKeyPath) {
      params.set("privateKeyPath", config.privateKeyPath);
    }
    if (config.perm && config.perm !== "workspace") {
      params.set("perm", config.perm);
    }
    const query = params.toString();

    // 从 settings 读取 agent 下载地址模板与最新版本接口(未配置时为空,走本地缓存)
    const downloadUrl = await this.service.getAgentDownloadUrl();
    const latestVersionUrl = await this.service.getAgentLatestVersionUrl();

    const connInfo = await deployAgent(
      {
        scheme: "ssh",
        host: config.host,
        port: config.port || 22,
        username: config.username || "root",
        password: config.password,
        path: config.path || "/",
        query: query ? Object.fromEntries(params) : undefined,
      },
      downloadUrl,
      latestVersionUrl,
    );

    // 使用 agent 访问令牌进行 WebSocket 握手鉴权(dev 模式 token 为空则不携带)
    const ws = new WebSocket(connInfo.wsUrl, {
      headers: connInfo.token
        ? { Authorization: `Bearer ${connInfo.token}` }
        : undefined,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });

    const rpc = new RpcClient(ws);
    rpc.setConnected();

    // Verify connection(版本一致性由部署链路保证:不一致会自动重新下载推送)
    try {
      const result = await rpc.call<{ pong: string }>("ping");
      if (!result.pong) throw new Error("Agent ping failed");
    } catch (err) {
      ws.close();
      throw new Error(`Agent handshake failed: ${err}`);
    }

    return { rpc, ws, sshClient: connInfo.sshClient };
  }
}

/**
 * RemoteAgent — wraps RPC client, provides high-level methods for tools.
 */
export class RemoteAgent {
  constructor(
    private rpc: RpcClient,
    private config: any,
  ) {}

  private get basePath(): string {
    return this.config.path || "/";
  }

  async readFile(filePath: string, offset = 0, limit = 200): Promise<string> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    const result = await this.rpc.call<{
      data: string | number[];
      encoding?: string;
    }>("readFile", { path: absPath, encoding: "utf-8" });
    const content =
      typeof result.data === "string"
        ? result.data
        : Buffer.from(result.data as number[]).toString("utf-8");
    const lines = content.split("\n");
    const start = Math.min(offset, lines.length);
    const end = Math.min(start + limit, lines.length);
    const selected = lines.slice(start, end);
    const padWidth = String(end).length;
    const formatted = selected.map(
      (line, i) => `${String(start + i + 1).padStart(padWidth, " ")}\t|${line}`,
    );
    let result2 = formatted.join("\n");
    if (end < lines.length) {
      result2 += `\n(${lines.length - end} more lines remain. To continue: offset=${end}, limit=${limit})`;
    }
    return result2;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    await this.rpc.call("writeFile", { path: absPath, content });
  }

  async replaceInFile(
    filePath: string,
    oldText: string,
    newText: string,
  ): Promise<{ matched: boolean; count: number }> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    return this.rpc.call("replaceInFile", {
      path: absPath,
      oldText,
      newText,
    });
  }

  async grep(pattern: string, searchPath?: string, maxResults = 50): Promise<string> {
    const absPath = searchPath
      ? searchPath.startsWith("/")
        ? searchPath
        : path.posix.join(this.basePath, searchPath)
      : this.basePath;
    const results = await this.rpc.call<string[]>("grep", {
      pattern,
      path: absPath,
      maxResults,
    });
    if (results.length === 0) return "No matches found.";
    return results.join("\n");
  }

  async execute(command: string): Promise<string> {
    const result = await this.rpc.call<{
      kind: string;
      output: string;
      exitCode: number | null;
      uptimeMs: number;
    }>("execute", { command, cwd: this.basePath, timeout: 60000, background: false });

    if (result.kind === "completed") {
      const parts: string[] = [];
      if (result.output) parts.push(`Output:\n---\n${result.output}\n---`);
      parts.push(`[exit code: ${result.exitCode}, uptime: ${Math.round(result.uptimeMs / 1000)}s]`);
      return parts.join("\n\n");
    }
    const parts: string[] = [];
    if (result.output) parts.push(`Partial output:\n---\n${result.output}\n---`);
    parts.push(
      `[Command timed out after 60s but is still running on the remote server. Use remote_bash to run 'ps -ef' or 'tail -f' to check progress.]`,
    );
    return parts.join("\n\n");
  }

  async upload(localPath: string, remotePath: string): Promise<string> {
    const content = await fs.promises.readFile(localPath);
    const base64 = content.toString("base64");
    const absRemote = remotePath.startsWith("/")
      ? remotePath
      : path.posix.join(this.basePath, remotePath);
    await this.rpc.call("upload", { remotePath: absRemote, content: base64 });
    return `Uploaded: ${localPath} → ${absRemote} (${content.length} bytes)`;
  }

  async download(remotePath: string, localPath: string): Promise<string> {
    const absRemote = remotePath.startsWith("/")
      ? remotePath
      : path.posix.join(this.basePath, remotePath);
    const result = await this.rpc.call<{ data: string }>("download", {
      remotePath: absRemote,
    });
    const buf = Buffer.from(result.data, "base64");
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, buf);
    return `Downloaded: ${absRemote} → ${localPath} (${buf.length} bytes)`;
  }
}