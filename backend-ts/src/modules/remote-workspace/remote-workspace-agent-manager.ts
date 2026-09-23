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
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as iconv from "iconv-lite";
import { deployAgent } from "./agent-deploy";
import { RpcClient, isUnknownMethodError } from "./rpc";
import { RemoteWorkspaceService, RemoteConnection } from "./remote-workspace.service";
import { StreamingSanitizer } from "../shell/stream-sanitizer";
import type { FileStat, DirEntry } from "../../common/workspace/workspace-provider.interface";

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

@Injectable()
export class RemoteAgentManager implements OnModuleDestroy {
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

  /**
   * 收割某会话所有远程连接上已完成的后台进程输出（turn.stopping 续跑钩子用）。
   * 只触达活跃连接；单连接失败不阻塞其他连接。
   * 返回原始 outputB64（未解码），由调用方（WorkspaceToolRouter）按进程登记的
   * encoding 逐行解码。
   */
  async drainSessionProcesses(
    sessionId: string,
  ): Promise<
    { connectionName: string; processId: string; status: string; exitCode: number | null; outputB64: string; truncated: boolean; logFile: string }[]
  > {
    const prefix = `${sessionId}::`;
    const out: {
      connectionName: string;
      processId: string;
      status: string;
      exitCode: number | null;
      outputB64: string;
      truncated: boolean;
      logFile: string;
    }[] = [];
    for (const [key, cached] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      if (cached.ws.readyState !== WebSocket.OPEN) continue;
      const connectionName = key.slice(prefix.length);
      try {
        const rows = (await cached.rpc.call("drainCompleted", {
          outputBase64: true,
        })) || [];
        for (const r of rows) {
          out.push({
            connectionName,
            processId: r.processId,
            status: r.status,
            exitCode: r.exitCode,
            outputB64: r.outputB64 || "",
            truncated: !!r.truncated,
            logFile: r.logFile || "",
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `drainCompleted failed for '${connectionName}' (session ${sessionId}): ${err?.message || err}`,
        );
      }
    }
    return out;
  }

  /** 停止空闲扫描并关闭所有缓存连接（Nest 模块销毁时自动调用） */
  onModuleDestroy(): void {
    this.dispose();
  }

  /** 停止空闲扫描并关闭所有缓存连接 */
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
 * 解码 agent 输出：agent >= 0.5.0 在 outputBase64 标志下返回 outputB64（原始字节
 * base64），按 encoding 本地解码——gbk 等非 UTF-8 输出不失真；旧版 agent 忽略该
 * 标志返回纯文本 output，原样透传。
 */
function decodeAgentOutput<T extends Record<string, any>>(
  result: T,
  encoding?: string,
): T & { output: string } {
  if (result && typeof result.outputB64 === "string") {
    const buf = Buffer.from(result.outputB64, "base64");
    const enc = (encoding || "utf-8").toLowerCase();
    let text: string;
    try {
      text = iconv.decode(buf, enc === "utf8" ? "utf-8" : enc);
    } catch {
      text = buf.toString("utf-8");
    }
    const rest = { ...result } as any;
    delete rest.outputB64;
    return { ...rest, output: text };
  }
  return result as T & { output: string };
}

/**
 * RemoteAgent — wraps RPC client, provides high-level methods for tools.
 *
 * 两层方法：
 * - 原语层（*Raw / stat / readdir / ...）：透传 agent RPC，供 SshWorkspaceProvider
 *   （WorkspaceProvider 实现）与工具远程分支使用；
 * - 工具层（readFile/execute 等带输出加工）：供 legacy remote_* 工具使用。
 */
export class RemoteAgent {
  constructor(
    private rpc: RpcClient,
    private config: any,
  ) {}

  /** 连接的工作目录基准（相对路径解析用） */
  get basePath(): string {
    return this.config.path || "/";
  }

  /** 相对路径 → 远端绝对路径（posix 语义；绝对路径原样返回） */
  resolveRemotePath(p: string): string {
    return p.startsWith("/") ? p : path.posix.join(this.basePath, p);
  }

  // ── 原语层 ──

  /**
   * 读取远端文件原始内容。
   * utf-8 直接文本取回；其他编码按 base64 取回字节后用 iconv 本地解码
   * （agent 原语只产出 utf-8 文本或 base64 字节）。
   */
  async readFileRaw(
    filePath: string,
    encoding?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const absPath = this.resolveRemotePath(filePath);
    const enc = (encoding || "utf-8").toLowerCase();
    if (enc === "utf-8" || enc === "utf8") {
      const result = await this.rpc.call<{ data: string | number[] }>(
        "readFile",
        { path: absPath, encoding: "utf-8" },
        signal,
      );
      return typeof result.data === "string"
        ? result.data
        : Buffer.from(result.data as number[]).toString("utf-8");
    }
    const result = await this.rpc.call<{ data: string }>(
      "readFile",
      { path: absPath },
      signal,
    );
    const buf = Buffer.from(result.data, "base64");
    try {
      return iconv.decode(buf, enc);
    } catch {
      return buf.toString("utf-8");
    }
  }

  /**
   * 写入远端文件。utf-8 直接写；其他编码本地编码为字节后走分块上传（二进制安全，
   * agent 的 writeFile 原语只接受 UTF-8 文本）。
   */
  async writeFileRaw(
    filePath: string,
    content: string,
    encoding?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const absPath = this.resolveRemotePath(filePath);
    const enc = (encoding || "utf-8").toLowerCase();
    if (enc === "utf-8" || enc === "utf8") {
      await this.rpc.call("writeFile", { path: absPath, content }, signal);
      return;
    }
    const bytes = iconv.encode(content, enc);
    await this.uploadBuffer(absPath, bytes, signal);
  }

  /** 分块上传内存字节（1MB/块，内存恒定）；异常时通知远端清理半成品 */
  async uploadBuffer(
    remotePath: string,
    data: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    const start = await this.rpc.call<{ uploadId: string }>(
      "uploadStart",
      { remotePath, totalBytes: data.length },
      signal,
    );
    try {
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const end = Math.min(offset + CHUNK_SIZE, data.length);
        await this.rpc.call(
          "uploadChunk",
          { uploadId: start.uploadId, data: data.subarray(offset, end).toString("base64") },
          signal,
        );
      }
      await this.rpc.call("uploadEnd", { uploadId: start.uploadId }, signal);
    } catch (e) {
      try {
        await this.rpc.call("uploadAbort", { uploadId: start.uploadId });
      } catch {}
      throw e;
    }
  }

  /** 轮询远端后台进程；agent 端进程不存在时返回 null（对齐本地 poll 语义） */
  async pollRaw(
    processId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    encoding?: string,
  ): Promise<{
    processId: string;
    status: string;
    exitCode: number | null;
    output: string;
    uptimeMs: number;
    waitMs?: number;
    /** 输出超限被截断（完整内容在 logFile） */
    truncated?: boolean;
    logFile?: string;
  } | null> {
    try {
      const result = await this.rpc.call(
        "poll",
        { processId, timeout: timeoutMs, outputBase64: true },
        signal,
        timeoutMs + 10000,
      );
      return decodeAgentOutput(result, encoding);
    } catch (e: any) {
      if (String(e?.message || e).includes("not found")) return null;
      throw e;
    }
  }

  async writeStdinRaw(processId: string, text: string): Promise<void> {
    await this.rpc.call("writeStdin", { processId, input: text });
  }

  async killRaw(processId: string): Promise<{ status: string }> {
    return this.rpc.call("kill", { processId });
  }

  /** 收割远端已完成的后台进程（并从 agent 进程表移除）；encoding 用于 outputB64 解码 */
  async drainCompletedRaw(encoding?: string): Promise<
    {
      processId: string;
      status: string;
      exitCode: number | null;
      output: string;
      uptimeMs: number;
      truncated?: boolean;
      logFile?: string;
    }[]
  > {
    const rows = await this.rpc.call<
      Record<string, any>[] | undefined
    >("drainCompleted", { outputBase64: true });
    return (rows || []).map((r) =>
      decodeAgentOutput(r, encoding),
    ) as {
      processId: string;
      status: string;
      exitCode: number | null;
      output: string;
      uptimeMs: number;
    }[];
  }

  /** 读取远端文件字节区间（二进制安全）。主路径 readFileRange RPC；旧版 agent（< 0.5.0）降级 downloadChunk。 */
  async readFileRangeRaw(
    filePath: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const absPath = this.resolveRemotePath(filePath);
    try {
      const r = await this.rpc.call<{ data: string }>(
        "readFileRange",
        { path: absPath, offset, length },
        signal,
      );
      return Buffer.from(r.data, "base64");
    } catch (e: any) {
      if (!isUnknownMethodError(e)) throw e;
      // 旧版 agent：经 downloadChunk 变通（downloadStart 定位会话后单块读取）
      const start = await this.rpc.call<{ downloadId: string }>(
        "downloadStart",
        { remotePath: absPath },
        signal,
      );
      try {
        const chunk = await this.rpc.call<{ data: string }>(
          "downloadChunk",
          { downloadId: start.downloadId, offset, size: length },
          signal,
        );
        return Buffer.from(chunk.data, "base64");
      } finally {
        try {
          await this.rpc.call("downloadEnd", { downloadId: start.downloadId });
        } catch {}
      }
    }
  }

  /**
   * 原生 glob RPC（agent >= 0.5.0）：服务端模式匹配，返回相对 cwd 的文件清单。
   * 旧版 agent 抛 unknown method，由 SshWorkspaceProvider 降级到 find|wc 模拟。
   */
  async globRaw(
    pattern: string,
    cwd: string | undefined,
    ignore: string[] | undefined,
    limit: number,
    deep: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ files: { path: string; size: number }[]; hasMore: boolean }> {
    const r = await this.rpc.call<{
      files?: { path: string; size: number }[];
      hasMore?: boolean;
    }>(
      "glob",
      {
        pattern,
        cwd: cwd ? this.resolveRemotePath(cwd) : this.basePath,
        ignore: ignore || [],
        limit,
        deep,
      },
      signal,
    );
    return { files: r?.files ?? [], hasMore: !!r?.hasMore };
  }

  async stat(filePath: string, signal?: AbortSignal): Promise<FileStat> {
    const r = await this.rpc.call<{
      isFile: boolean;
      isDirectory: boolean;
      size: number;
      mtime: number;
    }>("stat", { path: this.resolveRemotePath(filePath) }, signal);
    return {
      isFile: r.isFile,
      isDirectory: r.isDirectory,
      size: r.size,
      mtime: new Date(r.mtime),
    };
  }

  async readdir(dirPath: string, signal?: AbortSignal): Promise<DirEntry[]> {
    const rows = await this.rpc.call<
      | { name: string; isDirectory: boolean; size: number; mtime: number }[]
      | undefined
    >("readdir", { path: this.resolveRemotePath(dirPath) }, signal);
    return (rows || []).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: e.size,
      mtime: new Date(e.mtime),
    }));
  }

  async mkdir(
    dirPath: string,
    opts?: { recursive?: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.rpc.call(
      "mkdir",
      { path: this.resolveRemotePath(dirPath), recursive: !!opts?.recursive },
      signal,
    );
  }

  async unlink(
    targetPath: string,
    opts?: { recursive?: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.rpc.call(
      "unlink",
      { path: this.resolveRemotePath(targetPath), recursive: !!opts?.recursive },
      signal,
    );
  }

  async rename(
    oldPath: string,
    newPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.rpc.call(
      "rename",
      {
        oldPath: this.resolveRemotePath(oldPath),
        newPath: this.resolveRemotePath(newPath),
      },
      signal,
    );
  }

  /**
   * 原始 grep：返回 agent grep RPC 的原始行（`path:line:content`，远端路径形态）。
   * smart-case 与 agent 端一致（全小写 → -i）。
   */
  async grepRaw(
    pattern: string,
    searchPath?: string,
    maxResults = 50,
    ignore?: string[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    const absPath = searchPath
      ? this.resolveRemotePath(searchPath)
      : this.basePath;
    const results = await this.rpc.call<string[]>(
      "grep",
      { pattern, path: absPath, maxResults, ignore: ignore || [] },
      signal,
    );
    return results || [];
  }

  /**
   * 原始命令执行（不加工输出）。超时转后台语义由 agent 端保证（60s 默认）；
   * RPC 兜底超时 = 命令超时 + 30s。失败（超时/断线/响应丢失）时在错误对象上
   * 携带 predictedLog（/tmp/guada-logs/<requestId>.out），调用方可据此提示 AI 读日志。
   */
  async executeRaw(
    command: string,
    opts?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /** true = 显式后台执行（agent 立即返回 processId，输出落日志文件） */
      background?: boolean;
      /** 输出编码（outputB64 原始字节的本地解码目标；缺省 utf-8） */
      encoding?: string;
    },
  ): Promise<{
    kind: string;
    output: string;
    exitCode: number | null;
    uptimeMs: number;
    processId?: string;
    logFile?: string;
    /** 输出超限被 head+tail 截断（完整内容在 logFile） */
    truncated?: boolean;
  }> {
    const timeoutMs = opts?.timeoutMs ?? 60000;
    const reqId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    try {
      const result = await this.rpc.call(
        "execute",
        {
          command,
          cwd: this.basePath,
          timeout: timeoutMs,
          background: opts?.background === true,
          // agent >= 0.5.0 返回 outputB64 原始字节；旧版忽略此标志返回纯文本 output
          outputBase64: true,
        },
        opts?.signal,
        timeoutMs + 30000,
        reqId,
      );
      return decodeAgentOutput(result, opts?.encoding);
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      e.predictedLog = `/tmp/guada-logs/${reqId}.out`;
      throw e;
    }
  }

  // ── 工具层（legacy remote_* 工具）──

  private sanitizeOutput(text: string): string {
    if (!text) return "";
    const s = new StreamingSanitizer();
    return s.feed(text) + s.flush();
  }

  /**
   * 清洗命令输出:复用 shell 插件的 StreamingSanitizer,
   * 擦除 ANSI 转义、归一化 \r\r\n/\r\n、折叠 \r 进度条帧(每行保留最后 \r 后内容)
   */

  async readFile(filePath: string, offset = 0, limit = 200, signal?: AbortSignal): Promise<string> {
    const content = await this.readFileRaw(filePath, "utf-8", signal);
    const lines = content.split("\n");
    const start = Math.min(offset, lines.length);
    const end = Math.min(start + limit, lines.length);
    const selected = lines.slice(start, end);
    const padWidth = String(end).length;
    const formatted = selected.map(
      (line, i) => `${String(start + i + 1).padStart(padWidth, " ")}\t${line}`,
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
    // 90s 超时兜底(> agent 60s 命令超时):executeRaw 内部已设置,
    // 失败时错误对象携带可预测的日志路径(/tmp/guada-logs/<requestId>.out),
    // 即使没拿到响应,也能直接给出日志路径供 AI 读取。
    let result: {
      kind: string;
      output: string;
      exitCode: number | null;
      uptimeMs: number;
      logFile?: string;
    };
    try {
      result = await this.executeRaw(command, { timeoutMs: 60000, signal });
    } catch (e: any) {
      // abort:原样抛出(由上层处理)
      if (e?.name === "AbortError") throw e;
      // 超时/断线/响应丢失:给出可预测的日志路径,AI 可自行读取
      const predictedLog = e?.predictedLog || "/tmp/guada-logs/";
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