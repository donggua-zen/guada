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
import { deployAgent } from "./agent-deploy";
import { RpcClient } from "./rpc";
import { RemoteWorkspaceService, RemoteConnection } from "./remote-workspace.service";

interface CachedAgent {
  rpc: RpcClient;
  ws: WebSocket;
  sshClient: SshClient | null;
  busy: boolean;
}

export class RemoteAgentManager {
  private cache = new Map<string, CachedAgent>();

  constructor(private readonly service: RemoteWorkspaceService) {}

  /**
   * Get or create an agent connection by connection name.
   * Only connections bound to the given session (via attachments['ssh-connection'])
   * are considered available. Connection is identified by name only (not ID).
   */
  async getAgent(
    connectionName: string,
    sessionAttachments?: Record<string, string[]>,
  ): Promise<RemoteAgent> {
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
      throw new Error(
        `Connection '${connectionName}' is not bound to this session. Bound connections may differ.`,
      );
    }

    // Check cache
    const cached = this.cache.get(conn.name);
    if (cached && !cached.busy) {
      return new RemoteAgent(cached.rpc, conn.config);
    }

    // Deploy + connect
    const connInfo = await this.deployAndConnect(conn);
    const cached2: CachedAgent = {
      rpc: connInfo.rpc,
      ws: connInfo.ws,
      sshClient: connInfo.sshClient,
      busy: false,
    };
    this.cache.set(conn.name, cached2);
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
    if (config.authMethod === "privateKey" && config.privateKey) {
      params.set("privateKey", config.privateKey);
    }
    const query = params.toString();

    const connInfo = await deployAgent({
      scheme: "ssh",
      host: config.host,
      port: config.port || 22,
      username: config.username || "root",
      password: config.password,
      path: config.path || "/",
      query: query ? Object.fromEntries(params) : undefined,
    });

    const ws = new WebSocket(connInfo.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });

    const rpc = new RpcClient(ws);
    rpc.setConnected();

    // Verify connection
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

  async glob(pattern: string, directory?: string, limit = 100): Promise<string> {
    const cwd = directory
      ? directory.startsWith("/")
        ? directory
        : path.posix.join(this.basePath, directory)
      : this.basePath;
    const files = await this.rpc.call<{ path: string; size: number }[]>(
      "glob",
      { pattern, cwd, limit },
    );
    let output = `${files.length} files found:`;
    for (const f of files) {
      output += `\n${f.path} (${f.size} bytes)`;
    }
    return output;
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
      `[Command timed out after 60s but is still running on the remote server. Use ssh_bash to run 'ps -ef' or 'tail -f' to check progress.]`,
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