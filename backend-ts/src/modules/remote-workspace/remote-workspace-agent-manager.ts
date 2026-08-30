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
import { StreamingSanitizer } from "../shell/stream-sanitizer";

interface CachedAgent {
  rpc: RpcClient;
  ws: WebSocket;
  sshClient: SshClient | null;
  busy: boolean;
  /** 最近一次被使用的时间戳(ms),用于空闲回收判断 */
  lastActive: number;
}

/** 分块传输块大小(与 agent 端 chunkSize 一致):1MB,内存恒定 */
const CHUNK_SIZE = 1024 * 1024;

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
    // 缓存命中但底层 WebSocket 已断开 → 视为失效,清理并重建
    if (cached && !cached.busy) {
      if (cached.ws.readyState !== WebSocket.OPEN) {
        this.logger.warn(
          `Agent connection '${cacheKey}' ws closed, reconnecting...`,
        );
        try {
          cached.ws.close();
        } catch {}
        try {
          cached.sshClient?.end();
        } catch {}
        this.cache.delete(cacheKey);
      } else {
        cached.lastActive = Date.now();
        return new RemoteAgent(cached.rpc, conn.config);
      }
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
    // 断线时自动清理该缓存,使下次调用走重建路径(自动恢复)
    connInfo.rpc.onDisconnect(() => {
      if (this.cache.get(cacheKey) === cached2) {
        this.logger.warn(
          `Agent connection '${cacheKey}' disconnected, removing from cache`,
        );
        this.cache.delete(cacheKey);
      }
    });
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

  /**
   * 清洗命令输出:复用 shell 插件的 StreamingSanitizer,
   * 擦除 ANSI 转义、归一化 \r\r\n/\r\n、折叠 \r 进度条帧(每行保留最后 \r 后内容)
   */
  private sanitizeOutput(text: string): string {
    if (!text) return "";
    const s = new StreamingSanitizer();
    return s.feed(text) + s.flush();
  }

  async readFile(filePath: string, offset = 0, limit = 200, signal?: AbortSignal): Promise<string> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    const result = await this.rpc.call<{
      data: string | number[];
      encoding?: string;
    }>("readFile", { path: absPath, encoding: "utf-8" }, signal);
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

  async writeFile(filePath: string, content: string, signal?: AbortSignal): Promise<void> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    await this.rpc.call("writeFile", { path: absPath, content }, signal);
  }

  async replaceInFile(
    filePath: string,
    oldText: string,
    newText: string,
    signal?: AbortSignal,
  ): Promise<{ matched: boolean; count: number }> {
    const absPath = filePath.startsWith("/")
      ? filePath
      : path.posix.join(this.basePath, filePath);
    return this.rpc.call("replaceInFile", {
      path: absPath,
      oldText,
      newText,
    }, signal);
  }

  async grep(pattern: string, searchPath?: string, maxResults = 50, signal?: AbortSignal): Promise<string> {
    const absPath = searchPath
      ? searchPath.startsWith("/")
        ? searchPath
        : path.posix.join(this.basePath, searchPath)
      : this.basePath;
    const results = await this.rpc.call<string[]>("grep", {
      pattern,
      path: absPath,
      maxResults,
    }, signal);
    if (results.length === 0) return "No matches found.";
    return results.join("\n");
  }

  async execute(command: string, signal?: AbortSignal): Promise<string> {
    // 90s 超时兜底(> agent 60s 命令超时):即使响应丢失/延迟也不无限挂起。
    // requestId 可预测:agent 端日志文件按 requestId 命名(/tmp/guada-logs/<requestId>.out),
    // abort/超时后即使没拿到响应,也能直接给出日志路径供 AI 读取。
    const reqId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const predictedLog = `/tmp/guada-logs/${reqId}.out`;
    let result: {
      kind: string;
      output: string;
      exitCode: number | null;
      uptimeMs: number;
      logFile?: string;
    };
    try {
      result = await this.rpc.call(
        "execute",
        { command, cwd: this.basePath, timeout: 60000, background: false },
        signal,
        90000,
        reqId,
      );
    } catch (e: any) {
      // abort:原样抛出(由上层处理)
      if (e?.name === "AbortError") throw e;
      // 超时/断线/响应丢失:给出可预测的日志路径,AI 可自行读取
      return (
        `[Command did not return in time (${e?.message || e}). ` +
        `It may still be running in the background on the remote server. ` +
        `Read its log file with remote_read (file_path: "${predictedLog}") ` +
        `or check with remote_bash ('ls -la ${predictedLog}' / 'tail -f ${predictedLog}').]`
      );
    }

    if (result.kind === "completed") {
      const parts: string[] = [];
      if (result.output) parts.push(`Output:\n---\n${this.sanitizeOutput(result.output)}\n---`);
      parts.push(`[exit code: ${result.exitCode}, uptime: ${Math.round(result.uptimeMs / 1000)}s]`);
      return parts.join("\n\n");
    }
    // 超时转后台 / background:进程仍在远端运行,输出写入远端日志文件,
    // 不阻塞后续命令;AI 用 remote_read 读日志文件监控进度
    const parts: string[] = [];
    if (result.output) parts.push(`Partial output:\n---\n${this.sanitizeOutput(result.output)}\n---`);
    if (result.logFile) {
      parts.push(
        `[Command is still running in the background on the remote server. Output is being written to log file: ${result.logFile}. ` +
          `Use remote_read (file_path: "${result.logFile}") or remote_bash ('tail -f ${result.logFile}') to read the log. ` +
          `Other commands are not blocked and can be executed normally.]`,
      );
    } else {
      parts.push(
        `[Command is still running in the background on the remote server. Use remote_bash to run 'ps -ef' or 'tail -f' to check progress.]`,
      );
    }
    return parts.join("\n\n");
  }

  async upload(localPath: string, remotePath: string, signal?: AbortSignal): Promise<string> {
    const absRemote = remotePath.startsWith("/")
      ? remotePath
      : path.posix.join(this.basePath, remotePath);
    // 分块上传:本地文件分块读(1MB),逐块发送,内存恒定,避免大文件 OOM
    const handle = await fs.promises.open(localPath, "r");
    try {
      const stat = await handle.stat();
      const start = await this.rpc.call<{ uploadId: string }>(
        "uploadStart",
        { remotePath: absRemote, totalBytes: stat.size },
        signal,
      );
      const uploadId = start.uploadId;
      const buf = Buffer.alloc(CHUNK_SIZE);
      let position = 0;
      try {
        while (position < stat.size) {
          const { bytesRead } = await handle.read(buf, 0, CHUNK_SIZE, position);
          if (bytesRead <= 0) break;
          const chunk = buf.subarray(0, bytesRead);
          await this.rpc.call(
            "uploadChunk",
            { uploadId, data: chunk.toString("base64") },
            signal,
          );
          position += bytesRead;
        }
        const end = await this.rpc.call<{ bytes: number }>("uploadEnd", { uploadId }, signal);
        return `Uploaded: ${localPath} → ${absRemote} (${end.bytes} bytes)`;
      } catch (e) {
        // 异常/中止:通知远端清理半成品
        try {
          await this.rpc.call("uploadAbort", { uploadId });
        } catch {}
        throw e;
      }
    } finally {
      await handle.close();
    }
  }

  async download(remotePath: string, localPath: string, signal?: AbortSignal): Promise<string> {
    const absRemote = remotePath.startsWith("/")
      ? remotePath
      : path.posix.join(this.basePath, remotePath);
    // 分块下载:逐块拉取并写入本地文件(1MB),内存恒定,避免大文件 OOM
    const start = await this.rpc.call<{ downloadId: string; totalBytes: number }>(
      "downloadStart",
      { remotePath: absRemote },
      signal,
    );
    const downloadId = start.downloadId;
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    const handle = await fs.promises.open(localPath, "w");
    try {
      let offset = 0;
      let received = 0;
      while (true) {
        const chunk = await this.rpc.call<{ data: string; isLast: string }>(
          "downloadChunk",
          { downloadId, offset, size: CHUNK_SIZE },
          signal,
        );
        const buf = Buffer.from(chunk.data, "base64");
        if (buf.length === 0) break;
        await handle.write(buf, 0, buf.length, received);
        received += buf.length;
        offset += buf.length;
        if (chunk.isLast === "true") break;
      }
      await this.rpc.call("downloadEnd", { downloadId }, signal);
      return `Downloaded: ${absRemote} → ${localPath} (${received} bytes)`;
    } catch (e) {
      // 异常/中止:通知远端释放会话
      try {
        await this.rpc.call("downloadEnd", { downloadId });
      } catch {}
      throw e;
    } finally {
      await handle.close();
    }
  }
}