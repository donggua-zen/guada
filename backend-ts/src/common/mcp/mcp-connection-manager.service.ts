import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  McpCallOptions,
  McpServerConfig,
  McpTransportKind,
  resolveTransportKind,
} from "./mcp.types";
import {
  isProcessAlive,
  killProcessTree,
  killProcessTreeSyncBestEffort,
} from "../utils/process-tree.util";

/**
 * MCP 连接管理器（连接池 / 生命周期 / 进程回收）
 *
 * ## 为什么需要它
 *
 * 改造前 `McpClientService.withClient` 为**每次** `listTools`/`callTool` 新建 transport 与
 * Client、用完即关。三层代价：
 *
 * 1. **协议语义丢失**：`initialize` 是每连接一次的握手（协商版本与 capabilities），
 *    Streamable HTTP 更靠 `Mcp-Session-Id` 定义会话。每次调用重新握手，等于永远拿不到
 *    协商结果、会话身份，也无法接收服务器主动推送（progress / logging / list_changed）。
 * 2. **stdio 每次调用等于重启进程**：延迟（npx 类服务器可达秒级）+ 服务器内存状态全丢。
 * 3. **并发放大**：`ToolExecutor.executeBatch` 的 MAX_CONCURRENCY=10 是真并发，同一服务器的
 *    两个工具会各起一个进程 / 各建一个会话。
 *
 * ## 设计要点
 *
 * - **连接键含传输参数哈希**：配置一改键就变，旧连接自然淘汰，不依赖额外的失效通知路径。
 * - **single-flight 建连**：并发调用共享同一个 connecting promise，否则只解决了一半问题
 *   （进程数从「每次调用一个」变成「每次并发首连一个」）。
 * - **懒连接 + 空闲淘汰**：绝不在启动时预热，避免用户配了 10 个 stdio 服务器却从不用、
 *   开机就起 10 个进程；空闲超过 TTL 即回收。
 * - **恢复策略刻意克制**（对齐参考实现 zcode 的适配器）：只对 SDK 在**请求发出前**抛出的
 *   裸 `"Not connected"` 重连重试一次，无退避、无循环——避免把服务器故障放大成请求风暴。
 * - **管理面走短连接**：`listTools` / `ping` 是配置期操作，且可能面向正在编辑或有故障的
 *   服务器，池化会让这类连接白占 5 分钟，故走「连一次、用完即关」的短连接路径。
 */

/**
 * ping 探测的超时。
 *
 * 只用于 `checkHealth` 的第一步：ping 本该是瞬时的，给它 5s 足够。
 * 超时也不判死——会退到 `tools/list` 复核，所以这个值只会影响快慢，不影响结论。
 */
const PING_TIMEOUT_MS = 5_000;

/** 建连超时（含 initialize 握手） */
const CONNECT_TIMEOUT_MS = 10_000;

/** 池内连接的空闲存活时间 */
const DEFAULT_IDLE_TTL_MS = 5 * 60_000;

/** 空闲扫描间隔 */
const IDLE_SWEEP_INTERVAL_MS = 60_000;

/** 关闭阶段的整体预算，必须小于 main.ts 的 2s app.close() race */
const SHUTDOWN_DEADLINE_MS = 1_500;

/** stdio 服务器 stderr 保留的尾部行数（用于意外断连时的诊断） */
const STDERR_TAIL_LINES = 20;

type McpTransport =
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;

/** 一次连接的载体（池内与短连接共用） */
interface ConnectionSlot {
  /** 日志标识 */
  label: string;
  /** 归属的配置行 id；无 id 时为连接键 */
  serverId: string;
  transportConfig: McpServerConfig;
  client: Client | null;
  transport: McpTransport | null;
  stdioPid: number | null;
  /** 主动关闭中：onclose 不应被判定为意外断连 */
  closing: boolean;
  stderrTail: string[];
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "failed";

interface PooledConnection extends ConnectionSlot {
  key: string;
  status: ConnectionStatus;
  /** single-flight：并发取用时共享同一次建连 */
  connecting: Promise<Client> | null;
  lastUsedAt: number;
  lastError?: string;
}

/**
 * 存活中的 stdio 子进程 pid（池内 + 短连接）。
 *
 * 放在模块级而非实例字段：`process.on('exit')` 的最后一道网需要在实例不可达时仍能下刀。
 */
const liveStdioPids = new Set<number>();
let exitHookRegistered = false;

function trackStdioPid(pid: number | null): void {
  if (!pid) return;
  liveStdioPids.add(pid);
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  // 退出阶段只做同步操作。正常路径已由 shutdown() 异步回收，这里兜的是
  // main.ts Bridge shutdown 的 2s 超时直接 process.exit(0)、异步清理来不及跑完的场景。
  process.on("exit", () => {
    for (const live of liveStdioPids) {
      if (isProcessAlive(live)) killProcessTreeSyncBestEffort(live);
    }
  });
}

function untrackStdioPid(pid: number | null): void {
  if (pid) liveStdioPids.delete(pid);
}

@Injectable()
export class McpConnectionManager implements OnApplicationShutdown {
  private readonly logger = new Logger(McpConnectionManager.name);
  private readonly pool = new Map<string, PooledConnection>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  // ============ 运行期路径（池化） ============

  /**
   * 在**池化**连接上执行操作：连接跨调用复用，供运行期工具调用使用。
   *
   * 刻意不接收取消信号——见下方 withEphemeralConnection 的说明：池化连接是共享的，
   * 请求级的取消由调用方直接传给 SDK 请求（McpClientService 的 callTool），
   * 而不是作用在共享的建连过程上。
   */
  async withPooledConnection<T>(
    config: McpServerConfig,
    serverId: string | undefined,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const key = buildConnectionKey(serverId, config);
    const client = await this.acquire(key, config, serverId);

    try {
      return await operation(client);
    } catch (error) {
      if (!isNotConnectedError(error)) throw error;
      // SDK 在 transport 缺失时、**请求发出前**抛出裸 "Not connected"
      // （@modelcontextprotocol/sdk/dist/esm/shared/protocol.js 的 Protocol.request earlyReject），
      // 因此重试不会造成服务端重复执行——这是「只重试一次」成立的前提。
      this.logger.warn(`MCP 连接已失效，重连后重试一次: ${key}`);
      const revived = await this.acquire(key, config, serverId, {
        forceReconnect: true,
      });
      return await operation(revived);
    }
  }

  /**
   * 在**短连接**上执行操作：连一次、用完即关，供配置期操作使用（抓工具、测试连接）。
   *
   * 不走池的两个理由：这类操作面向的服务器可能正在被编辑或已禁用（池化会让它白占 TTL）；
   * 且它们都带自己的超时兜底，复用带来的收益有限。
   *
   * 这里**可以**把信号绑到建连上：每次调用都是独占连接，不存在"某个调用方中断
   * 就把别人的共享建连掐掉"的问题。池化路径则不能，因为建连被并发调用共享。
   */
  async withEphemeralConnection<T>(
    config: McpServerConfig,
    serverId: string | undefined,
    operation: (client: Client) => Promise<T>,
    options: McpCallOptions = {},
  ): Promise<T> {
    const label = serverId || describeTransport(config);
    const slot: ConnectionSlot = {
      label: labelForLog(label),
      serverId: serverId ?? label,
      transportConfig: config,
      client: null,
      transport: null,
      stdioPid: null,
      closing: false,
      stderrTail: [],
    };

    try {
      const client = await this.openConnection(slot, undefined, options.signal);
      return await operation(client);
    } finally {
      await this.closeConnection(slot);
    }
  }

  // ============ 失效与关闭 ============

  /** 关闭某服务器在池中的所有连接（删除 / 禁用 / 配置变更时调用） */
  async invalidate(serverId: string): Promise<number> {
    // 池内条目只来自运行期工具调用，而它必定带 serverId，所以按 id 匹配即可
    const victims = Array.from(this.pool.values()).filter(
      (entry) => entry.serverId === serverId,
    );
    for (const entry of victims) {
      this.pool.delete(entry.key);
      await this.closeConnection(entry);
    }
    if (victims.length > 0) {
      this.logger.log(
        `已释放 MCP 服务器 ${serverId} 的 ${victims.length} 条连接`,
      );
      this.stopSweeperIfIdle();
    }
    return victims.length;
  }

  /** 关闭池中全部连接 */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopSweeper();
    const entries = Array.from(this.pool.values());
    this.pool.clear();
    if (entries.length > 0) {
      this.logger.log(`正在关闭 ${entries.length} 条 MCP 连接...`);
    }
    // 整体预算封顶：main.ts 的 Bridge shutdown 只给 app.close() 2s。
    // 计时器必须显式清除 + unref——关闭是退出路径，不能让兜底计时器反过来拖着进程不退出。
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled(entries.map((entry) => this.closeConnection(entry))),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, SHUTDOWN_DEADLINE_MS);
          deadline.unref?.();
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  /** 观测用：池内连接数与状态分布 */
  stats(): { active: number; connecting: number; stale: number } {
    let connecting = 0;
    let stale = 0;
    for (const entry of this.pool.values()) {
      if (entry.connecting) connecting += 1;
      if (entry.status === "disconnected" || entry.status === "failed") stale += 1;
    }
    return { active: this.pool.size, connecting, stale };
  }

  /**
   * 连通性检查（配置页「测试连接」用）。
   *
   * ## 为什么不能只看 ping
   *
   * MCP 规范里 `ping` 是**可选**方法，而 SDK 把它的返回值校验为
   * `EmptyResultSchema = ResultSchema.strict()`（见 @modelcontextprotocol/sdk 的 types.js），
   * 也就是**结果必须为空**。任何服务器只要回一个非空结果——哪怕只是 `{"status":"ok"}`
   * 这种完全无害的写法——SDK 就会抛 Zod 的 `unrecognized_keys` 错误。
   *
   * 关键在于这个错误**没有 JSON-RPC 错误码**，所以无法与「服务器没应答」区分：
   * 判成失败就会出现「刷新工具能列出工具、测试连接却失败」这种自相矛盾的结论
   * （实测 metaso：ping=false / tools/list 正常返回 6 个工具）。
   *
   * 所以策略是：ping 成功即通过（多数服务器一次轻量往返即可）；**ping 失败一律不判死**，
   * 改用服务器必须支持的 `tools/list` 复核。它同时也是「刷新工具」发的那一个请求，
   * 因此两个入口的结论天然一致。
   *
   * 顺带说明工具调用不受此问题影响：`CallToolResultSchema` 继承的是宽松的 `ResultSchema`。
   */
  async checkHealth(
    config: McpServerConfig,
    serverId?: string,
    options: McpCallOptions = {},
  ): Promise<boolean> {
    try {
      return await this.withEphemeralConnection(
        config,
        serverId,
        async (client) => {
          try {
            await client.ping({ timeout: PING_TIMEOUT_MS });
            return true;
          } catch (error: any) {
            // 不判死：见方法注释。这里只记诊断信息，结论交给下面的 tools/list。
            this.logger.debug(
              `ping 未通过（${describeErrorForLog(error)}），改用 tools/list 复核: ${serverId || describeTransport(config)}`,
            );
          }

          // 刻意与「刷新工具」用完全相同的超时（不传 = SDK 默认 60s）：
          // 若这里给个更短的预算，就会出现"刷新能成功、测试连接却失败"的矛盾结论，
          // 而那种不一致正是这次要消除的问题。
          await client.listTools(undefined, { signal: options.signal });
          return true;
        },
        { signal: options.signal },
      );
    } catch (error: any) {
      this.logger.warn(
        `MCP 连通性探测失败 ${serverId || describeTransport(config)}: ${describeErrorForLog(error)}`,
      );
      return false;
    }
  }

  // ============ 池内部：取用 / 建连 / 回收 ============

  private async acquire(
    key: string,
    config: McpServerConfig,
    serverId: string | undefined,
    options: { forceReconnect?: boolean } = {},
  ): Promise<Client> {
    if (this.shuttingDown) {
      throw new Error("MCP 连接管理器正在关闭，拒绝新建连接");
    }

    let entry = this.pool.get(key);

    if (options.forceReconnect && entry) {
      this.pool.delete(key);
      await this.closeConnection(entry);
      entry = undefined;
    }

    if (entry) {
      // single-flight：并发取用共享同一次建连，避免 N 个调用各起一个 stdio 进程
      if (entry.connecting) {
        const client = await entry.connecting;
        entry.lastUsedAt = Date.now();
        return client;
      }
      if (entry.status === "connected" && entry.client) {
        entry.lastUsedAt = Date.now();
        return entry.client;
      }
    } else {
      entry = {
        key,
        label: labelForLog(serverId || describeTransport(config)),
        serverId: serverId ?? key,
        transportConfig: config,
        client: null,
        transport: null,
        stdioPid: null,
        closing: false,
        stderrTail: [],
        status: "connecting",
        connecting: null,
        lastUsedAt: Date.now(),
      };
      this.pool.set(key, entry);
    }

    // 首次建连，或断连/失败后的原地重建（键不变，保持既有归属）
    const attempt = (async () => {
      try {
        return await this.openConnection(entry!, () => {
          entry!.status = "disconnected";
        });
      } catch (error: any) {
        entry!.status = "failed";
        entry!.lastError = error?.message || String(error);
        throw error;
      } finally {
        entry!.connecting = null;
        entry!.lastUsedAt = Date.now();
      }
    })();

    entry.connecting = attempt;
    entry.status = "connecting";
    this.ensureSweeper();

    const client = await attempt;
    entry.status = "connected";
    entry.lastUsedAt = Date.now();
    return client;
  }

  /** 建立传输与 Client 并完成 initialize 握手 */
  private async openConnection(
    slot: ConnectionSlot,
    onUnexpectedClose?: () => void,
    connectSignal?: AbortSignal,
  ): Promise<Client> {
    const config = slot.transportConfig;
    const transport = this.createTransport(slot);
    const client = new Client(
      { name: "ts-backend", version: "1.0.0" },
      { capabilities: {} },
    );

    slot.closing = false;
    slot.client = client;
    slot.transport = transport;

    // 意外断连检测：主动关闭时 onclose 同样会触发，必须靠 closing 标志区分
    client.onclose = () => {
      if (slot.closing) return;
      if (slot.client !== client) return;
      this.logger.warn(
        `MCP 连接意外断开: ${slot.label}${formatStderrTail(slot)}`,
      );
      slot.client = null;
      untrackStdioPid(slot.stdioPid);
      slot.stdioPid = null;
      onUnexpectedClose?.();
    };

    try {
      await this.connectWithTimeout(client, transport, connectSignal);
    } catch (error: any) {
      // 超时不代表底层 connect 已停止：必须主动关闭，否则 stdio 子进程会留成孤儿
      await this.closeConnection(slot);
      const wrapped = new Error(
        `MCP connection failed: ${error?.message || error}`,
      );
      (wrapped as any).originalError = error;
      throw wrapped;
    }

    slot.stdioPid = readStdioPid(transport);
    trackStdioPid(slot.stdioPid);

    this.logger.debug(
      `已连接 MCP 服务器: ${slot.label} (${describeTransport(config)}` +
        `${slot.stdioPid ? `, pid=${slot.stdioPid}` : ""})`,
    );
    return client;
  }

  /**
   * `client.connect` 叠加超时。
   *
   * SDK 自带 initialize 超时，但不能替代这里：SDK 的超时只让 promise 失败，不会回收
   * 已经 spawn 出来的子进程，所以超时后仍必须由调用方关 transport（见 openConnection）。
   */
  private async connectWithTimeout(
    client: Client,
    transport: McpTransport,
    signal?: AbortSignal,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS / 1000}s`),
              ),
            CONNECT_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 关闭连接：先收子进程树，再关 Client/transport */
  private async closeConnection(slot: ConnectionSlot): Promise<void> {
    slot.closing = true;
    const { client, transport, stdioPid } = slot;

    // 顺序要紧：先摘掉 onclose，避免主动关闭被记成「意外断连」
    if (client) {
      client.onclose = undefined;
    }

    // stdio 的真实服务器常是包装命令的孙进程，SDK 的 close() 只杀直接子进程，
    // 所以先按 pid 整树下刀，再让 SDK 走它自己的优雅关闭。
    if (stdioPid) {
      await killProcessTree(stdioPid);
      untrackStdioPid(stdioPid);
    }

    if (client) {
      try {
        await client.close();
      } catch (error: any) {
        this.logger.debug(
          `关闭 MCP Client 失败 ${slot.label}: ${error?.message || error}`,
        );
      }
    }
    if (transport) {
      try {
        await transport.close();
      } catch (error: any) {
        this.logger.debug(
          `关闭 MCP transport 失败 ${slot.label}: ${error?.message || error}`,
        );
      }
    }

    slot.client = null;
    slot.transport = null;
    slot.stdioPid = null;
  }

  // ============ 传输构建 ============

  private createTransport(slot: ConnectionSlot): McpTransport {
    const config = slot.transportConfig;
    const kind = resolveTransportKind(config);

    if (kind === "stdio") {
      if (!config.command) {
        throw new Error("Stdio protocol requires 'command' parameter in config");
      }
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env },
        cwd: config.cwd,
        // 默认的 'inherit' 会把服务器 stderr 直接灌进后端 stderr，并混入 Electron 的
        // 崩溃诊断缓冲（electron/main.ts 收集）。改为 pipe 后按行转发到日志，同时留尾部
        // 供意外断连时归因。
        stderr: "pipe",
      });
      this.attachStderrForwarder(slot, transport);
      return transport;
    }

    if (!config.url) {
      throw new Error(
        `${kind === "sse" ? "SSE" : "Streamable HTTP"} protocol requires 'url' parameter in config`,
      );
    }

    if (kind === "sse") {
      // SSE：SDK 自动处理 Accept/Content-Type，只传用户自定义 headers
      return new SSEClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers ? { ...config.headers } : undefined,
        },
      });
    }

    const requestHeaders = { ...(config.headers || {}) };
    if (!requestHeaders["Content-Type"]) {
      requestHeaders["Content-Type"] = "application/json";
    }
    if (!requestHeaders["Accept"]) {
      requestHeaders["Accept"] = "application/json, text/event-stream";
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: requestHeaders },
    });
  }

  /** 把子进程 stderr 按行转发到日志，并保留尾部若干行 */
  private attachStderrForwarder(
    slot: ConnectionSlot,
    transport: StdioClientTransport,
  ): void {
    // stderr 声明为 pipe 时，SDK 在 start() 之前就返回可挂监听的 PassThrough，
    // 因此这里能拿到启动早期的报错输出。
    const stream = transport.stderr;
    if (!stream) return;

    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      // 最后一段可能是不完整行，留在缓冲里等下一次
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        slot.stderrTail.push(line);
        if (slot.stderrTail.length > STDERR_TAIL_LINES) {
          slot.stderrTail.shift();
        }
        this.logger.debug(`[mcp:${slot.label}] ${line}`);
      }
    });
    // 读错误不能冒泡成未捕获异常（服务器退出时常见）
    stream.on("error", () => undefined);
  }

  // ============ 空闲淘汰 ============

  private ensureSweeper(): void {
    if (this.sweepTimer || this.shuttingDown) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepIdleConnections();
    }, IDLE_SWEEP_INTERVAL_MS);
    // 不阻止进程退出
    this.sweepTimer.unref?.();
  }

  private stopSweeper(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private stopSweeperIfIdle(): void {
    if (this.pool.size === 0) this.stopSweeper();
  }

  private async sweepIdleConnections(
    ttlMs: number = DEFAULT_IDLE_TTL_MS,
  ): Promise<void> {
    const now = Date.now();
    const expired: PooledConnection[] = [];

    for (const entry of this.pool.values()) {
      // 建连中的不淘汰：它刚被取用，lastUsedAt 的语义还没写回
      if (entry.connecting) continue;
      if (now - entry.lastUsedAt < ttlMs) continue;
      expired.push(entry);
    }

    for (const entry of expired) {
      this.pool.delete(entry.key);
      await this.closeConnection(entry);
    }

    if (expired.length > 0) {
      this.logger.log(
        `已回收 ${expired.length} 条空闲 MCP 连接（剩余 ${this.pool.size} 条）`,
      );
    }
    this.stopSweeperIfIdle();
  }

  /** 测试用：立即按给定 TTL 扫描一次闲置连接 */
  async sweepIdleNow(ttlMs = DEFAULT_IDLE_TTL_MS): Promise<void> {
    await this.sweepIdleConnections(ttlMs);
  }
}

// ============ 模块级工具 ============

/**
 * 连接键 = 归属 id + 传输参数稳定哈希。
 *
 * 含哈希是关键：配置一改（换 URL、改命令、改环境变量）键就变，旧连接自然失去引用被淘汰，
 * 不需要任何额外的失效通知路径——这也保住了改造前「配置改动立即生效」的特性。
 */
export function buildConnectionKey(
  serverId: string | undefined,
  config: McpServerConfig,
): string {
  const scope = serverId?.trim() || "<anonymous>";
  return `${scope}::${stableStringify({
    kind: resolveTransportKind(config),
    url: config.url ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    env: config.env ?? null,
    cwd: config.cwd ?? null,
    headers: config.headers ?? null,
  })}`;
}

/** 键排序后的稳定序列化：同一份配置必须得到同一个键 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/**
 * 只认 SDK 的裸 `"Not connected"`。
 *
 * 该错误来自 Protocol.request 的 `earlyReject`（transport 为空，**请求尚未发出**），
 * 所以重试不会造成服务端重复执行。其它错误——包括各供应商自造的相似文案——一律原样上抛，
 * 避免把「请求可能已执行」的失败也重试一遍。
 */
export function isNotConnectedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Not connected";
}

function readStdioPid(transport: McpTransport): number | null {
  return transport instanceof StdioClientTransport ? (transport.pid ?? null) : null;
}

/**
 * 把错误压成一行可读诊断。
 *
 * Zod 校验失败抛的是 **issue 数组**（没有 message 字段），直接塞进模板字符串会打出
 * 一段多行 JSON；SDK 对 ping 结果的严格校验正好走这条路，所以这里必须单独处理。
 */
function describeErrorForLog(error: any): string {
  if (Array.isArray(error)) {
    return error
      .map((issue) => issue?.message ?? JSON.stringify(issue))
      .join("; ");
  }
  return error?.message || String(error);
}

function describeTransport(config: McpServerConfig): string {
  return `${resolveTransportKind(config)}:${config.command || config.url || "?"}`;
}

/** 日志标识：服务器名可能带空格/中文，统一加方括号便于检索 */
function labelForLog(label: string): string {
  return label.length > 60 ? `${label.slice(0, 57)}...` : label;
}

function formatStderrTail(slot: ConnectionSlot): string {
  if (slot.stderrTail.length === 0) return "";
  return `\n最近 stderr:\n${slot.stderrTail.map((l) => `  ${l}`).join("\n")}`;
}
