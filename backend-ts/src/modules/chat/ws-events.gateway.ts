import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { WebSocket, WebSocketServer } from "ws";
import { verifyTokenToAccount } from "../auth/auth.guard";
import { AccountFileStore } from "../auth/account-file.store";
import { SessionEventsService, type EventConnection } from "./session-events.service";
import { SessionReplayService } from "./session-replay.service";
import { SessionService } from "./session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import {
  WorkspaceWatcherService,
  normalizeWatchScope,
  type FileChangeEvent,
} from "../../common/services/workspace-watcher.service";
import {
  WS_BEARER_PROTOCOL_PREFIX,
  WS_EVENTS_PATH,
  WS_EVENTS_PROTOCOL,
  type WsClientMessage,
  type WsServerMessage,
} from "./ws-events.types";

/** 服务端 ping 间隔；连续两个周期没有 pong 即判定半开并断开 */
const WS_HEARTBEAT_INTERVAL_MS = 30_000;

interface ConnectionState {
  connection: EventConnection;
  ws: WebSocket;
  alive: boolean;
  heartbeatTimer: ReturnType<typeof setInterval>;
  /** sessionId → 释放函数（workspace 监听 + scope） */
  workspaceReleases: Map<string, () => void>;
  closed: boolean;
}

/**
 * 实时事件网关：一条 WebSocket 承载会话流 + workspace 流。
 *
 * 用 raw `ws` 挂在现有 HTTP server 上（与 TerminalGateway 同模式），不引入
 * Nest WS adapter——避免改变现有全局 HTTP 管线。鉴权在握手阶段完成：
 * `Sec-WebSocket-Protocol: guada.events.v1, bearer.<token>`；代理剥离子协议时
 * 回退 `?token=`。
 */
@Injectable()
export class WsEventsGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WsEventsGateway.name);
  private server?: WebSocketServer;
  private upgradeHandler?: (
    req: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => void;
  private readonly states = new Map<WebSocket, ConnectionState>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwtService: JwtService,
    private readonly accountStore: AccountFileStore,
    private readonly sessionEvents: SessionEventsService,
    private readonly replayService: SessionReplayService,
    private readonly sessionService: SessionService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWatcher: WorkspaceWatcherService,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (!httpServer) {
      this.logger.warn("[ws-events] HTTP server unavailable, gateway disabled");
      return;
    }
    // 同一 HTTP server 上可能还有别的 ws 实例（终端网关）。带 path 的 ws 会对
    // 不匹配的升级请求直接 abort(400)，两个实例会互相打 400；必须 noServer +
    // 各自按 pathname 接管。
    this.server = new WebSocketServer({
      noServer: true,
      // 代理可能剥离子协议：此时不选协议照常握手（鉴权回退 query token）；
      // 客户端明确提供了其它协议但不含我们的 → 拒绝。
      handleProtocols: (protocols) =>
        protocols.size === 0
          ? (undefined as unknown as string)
          : protocols.has(WS_EVENTS_PROTOCOL)
            ? WS_EVENTS_PROTOCOL
            : false,
    });
    this.server.on("connection", (ws, req) => {
      void this.handleConnection(ws, req);
    });
    this.upgradeHandler = (req, socket, head) => {
      if (pathnameOf(req.url) !== WS_EVENTS_PATH) return;
      this.server?.handleUpgrade(req, socket, head, (ws) => {
        this.server?.emit("connection", ws, req);
      });
    };
    httpServer.on("upgrade", this.upgradeHandler);
    this.logger.log(`[ws-events] listening on ${WS_EVENTS_PATH}`);
  }

  onModuleDestroy(): void {
    for (const state of this.states.values()) {
      state.closed = true;
      clearInterval(state.heartbeatTimer);
      this.releaseWorkspace(state);
      try {
        state.ws.terminate();
      } catch {
        /* 已断开 */
      }
    }
    this.states.clear();
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (httpServer && this.upgradeHandler) {
      httpServer.off("upgrade", this.upgradeHandler);
    }
    this.upgradeHandler = undefined;
    this.server?.close();
    this.server = undefined;
  }

  // ── 握手 ──

  private async handleConnection(ws: WebSocket, req: any): Promise<void> {
    const clientId = this.parseClientId(req);
    const token = this.parseToken(req);
    const account = await this.authenticate(token);
    if (!account) {
      this.logger.warn(`[ws-events] unauthorized connection from ${clientId}`);
      ws.close(4401, "unauthorized");
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;

    const connectionId = this.sessionEvents.createConnectionId();
    const connection = this.sessionEvents.registerConnection(
      clientId,
      connectionId,
      (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
    );

    const state: ConnectionState = {
      connection,
      ws,
      alive: true,
      heartbeatTimer: setInterval(() => this.heartbeat(state), WS_HEARTBEAT_INTERVAL_MS),
      workspaceReleases: new Map(),
      closed: false,
    };
    this.states.set(ws, state);

    this.send(ws, { kind: "ready", connectionId, protocol: WS_EVENTS_PROTOCOL });

    ws.on("pong", () => {
      state.alive = true;
    });
    ws.on("message", (raw) => {
      state.alive = true;
      void this.handleMessage(state, raw);
    });
    ws.on("close", () => this.handleClose(state));
    ws.on("error", (error) => {
      this.logger.debug(`[ws-events] socket error: ${String(error)}`);
    });
  }

  private parseToken(req: any): string | undefined {
    const protocols = String(req?.headers?.["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p: string) => p.trim());
    const bearer = protocols.find((p: string) =>
      p.startsWith(WS_BEARER_PROTOCOL_PREFIX),
    );
    if (bearer) {
      return bearer.slice(WS_BEARER_PROTOCOL_PREFIX.length) || undefined;
    }
    // 代理剥离子协议时的回退：query token（与 AuthGuard 的 ?token= 同语义）
    try {
      const url = new URL(req?.url ?? "", "http://localhost");
      return url.searchParams.get("token") || undefined;
    } catch {
      return undefined;
    }
  }

  private parseClientId(req: any): string {
    try {
      const url = new URL(req?.url ?? "", "http://localhost");
      return url.searchParams.get("clientId") || `ws_${Date.now()}`;
    } catch {
      return `ws_${Date.now()}`;
    }
  }

  private async authenticate(token?: string): Promise<boolean> {
    await this.accountStore.ensureReady();
    if (!token) {
      // 未设密码 → 免登录直通（与 AuthGuard 同语义）
      return !this.accountStore.isPasswordSet();
    }
    const account = await verifyTokenToAccount(
      this.jwtService,
      this.accountStore,
      token,
    );
    return account !== null;
  }

  private heartbeat(state: ConnectionState): void {
    if (state.closed) return;
    if (!state.alive) {
      this.logger.debug(
        `[ws-events] heartbeat timeout for ${state.connection.clientId}`,
      );
      state.ws.terminate();
      return;
    }
    state.alive = false;
    try {
      state.ws.ping();
    } catch {
      state.ws.terminate();
    }
  }

  private handleClose(state: ConnectionState): void {
    if (state.closed) return;
    state.closed = true;
    clearInterval(state.heartbeatTimer);
    this.releaseWorkspace(state);
    this.sessionEvents.unsubscribe(state.connection);
    this.states.delete(state.ws);
  }

  private releaseWorkspace(state: ConnectionState): void {
    for (const release of state.workspaceReleases.values()) {
      try {
        release();
      } catch {
        /* 忽略释放失败 */
      }
    }
    state.workspaceReleases.clear();
  }

  private send(ws: WebSocket, message: WsServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  // ── 消息 ──

  private async handleMessage(state: ConnectionState, raw: unknown): Promise<void> {
    let message: WsClientMessage;
    try {
      message = JSON.parse(String(raw)) as WsClientMessage;
    } catch {
      return;
    }
    if (!message || typeof message.kind !== "string") return;

    try {
      await this.dispatchMessage(state, message);
    } catch (error) {
      this.logger.warn(
        `[ws-events] message failed (${message.kind}): ${String(error)}`,
      );
    }
  }

  private async dispatchMessage(
    state: ConnectionState,
    message: WsClientMessage,
  ): Promise<void> {
    switch (message.kind) {
      case "watch":
        this.sessionEvents.watchSessions(
          state.connection,
          asSessionIds(message.sessionIds),
        );
        return;
      case "unwatch":
        this.sessionEvents.unwatchSessions(
          state.connection,
          asSessionIds(message.sessionIds),
        );
        return;
      case "ping":
        this.send(state.ws, { kind: "pong", ts: message.ts });
        return;
      case "open":
        await this.handleOpen(state, message);
        return;
      case "workspace/watch":
        await this.handleWorkspaceWatch(state, message);
        return;
      default:
        return;
    }
  }

  private async handleOpen(
    state: ConnectionState,
    message: Extract<WsClientMessage, { kind: "open" }>,
  ): Promise<void> {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    if (!requestId || !sessionId) {
      this.send(state.ws, {
        kind: "ack",
        requestId,
        ok: false,
        reason: "bad-request",
      });
      return;
    }
    const turns = Math.min(Math.max(1, Number(message.turns) || 30), 100);
    const beforeSeq =
      typeof message.beforeSeq === "number" && Number.isFinite(message.beforeSeq)
        ? message.beforeSeq
        : undefined;

    const result = await this.sessionEvents.openSnapshot(
      state.connection,
      sessionId,
      requestId,
      () => this.replayService.getEventPage(sessionId, { turns, beforeSeq }),
    );
    this.send(state.ws, {
      kind: "ack",
      requestId,
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  private async handleWorkspaceWatch(
    state: ConnectionState,
    message: Extract<WsClientMessage, { kind: "workspace/watch" }>,
  ): Promise<void> {
    const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
    if (!sessionId || state.closed) return;

    if (!state.workspaceReleases.has(sessionId)) {
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) return;
      const workspacePath =
        await this.workspaceService.resolveSessionWorkspaceDir(session);
      const releaseWatching = this.workspaceWatcher.startWatching(
        sessionId,
        workspacePath,
        state.connection.clientId,
        () => state.ws.close(4408, "workspace closed"),
      );
      const unsubscribe = this.workspaceWatcher.onFileChange(
        sessionId,
        (event: FileChangeEvent) => {
          if (state.closed || state.ws.readyState !== WebSocket.OPEN) return;
          state.ws.send(JSON.stringify({ kind: "workspace", data: event }));
        },
      );
      state.workspaceReleases.set(sessionId, () => {
        unsubscribe();
        releaseWatching();
      });
    }

    for (const rawScope of asScopes(message.scopes)) {
      const scope = normalizeWatchScope(rawScope);
      if (!scope) continue;
      this.workspaceWatcher.setWatchScope(
        sessionId,
        state.connection.clientId,
        scope,
        message.enabled !== false,
      );
    }
  }
}

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? "", "http://localhost").pathname;
  } catch {
    return "";
  }
}

function asSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function asScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
