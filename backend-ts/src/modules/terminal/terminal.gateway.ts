import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "node:http";
import { TerminalService } from "./terminal.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { SessionService } from "../chat/session.service";
import { AccountFileStore } from "../auth/account-file.store";
import { ClientTerminalMessage, ServerTerminalMessage, PtyHandle } from "./types";

interface WsSession {
  ws: WebSocket;
  handle: PtyHandle;
  onData: (data: string) => void;
  onExit: (e: { exitCode: number }) => void;
}

/**
 * 终端 WebSocket 网关
 *
 * 挂载到同一 HTTP server（同端口升级），路径 /api/v1/terminal/ws。
 * 鉴权：query.token (JWT) 校验通过即放行（单账户，无归属校验）。
 *
 * 关键设计：
 *  - WS 断连（页面刷新/会话切换）不调 dispose → PTY 保留为 orphan
 *  - 前端重连时复用同 session 的 orphan PTY（回放 transcript）
 *  - 前端显式发 close 消息 → dispose PTY
 */
@Injectable()
export class TerminalGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TerminalGateway.name);
  private wss: WebSocketServer | null = null;
  /** WS 连接 → 终端映射 */
  private readonly wsSessions = new Map<WebSocket, WsSession>();

  constructor(
    private httpAdapterHost: HttpAdapterHost,
    private terminalService: TerminalService,
    private workspaceService: WorkspaceService,
    private sessionService: SessionService,
    private jwtService: JwtService,
    private accountStore: AccountFileStore,
    private configService: ConfigService,
  ) {}

  onModuleInit(): void {
    try {
      const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
      const path = "/api/v1/terminal/ws";
      this.wss = new WebSocketServer({ server: httpServer, path });
      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
      this.logger.log(`Terminal WebSocket ready at ${path}`);
    } catch (e: any) {
      this.logger.error(`TerminalGateway init failed: ${e?.message}`);
    }
  }

  onModuleDestroy(): void {
    this.wss?.close();
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    let user: any;
    let sessionId: string;
    let cwd: string;
    let handle: PtyHandle;

    try {
      const url = new URL(req.url || "", "http://localhost");
      const token = url.searchParams.get("token");
      const sessionIdRaw = url.searchParams.get("sessionId");
      const requestedTerminalId = url.searchParams.get("terminalId");
      if (!token) throw new Error("Missing token");
      if (!sessionIdRaw) throw new Error("Missing sessionId");

      await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      // 单账户：token 有效即代表本机唯一账户，无需再查库
      user = this.accountStore.getView();

      sessionId = sessionIdRaw;
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) throw new Error("Session not found");

      cwd = await this.workspaceService.resolveSessionWorkspaceDir(session);

      // 优先按标签保存的 terminalId 精确恢复；不存在 / 不属于本会话 / 已连接则新建
      if (requestedTerminalId) {
        try {
          const candidate = this.terminalService.get(requestedTerminalId);
          if (candidate.sessionId === sessionId && candidate.disconnectedAt) {
            handle = candidate;
            handle.disconnectedAt = undefined;
            this.logger.log(`Reusing terminal: ${handle.id}`);
          }
        } catch {
          // 终端不存在，走新建逻辑
        }
      }
      if (!handle) {
        const cols = Number(url.searchParams.get("cols")) || 80;
        const rows = Number(url.searchParams.get("rows")) || 24;
        handle = this.terminalService.createUiTerminal(sessionId, cwd, cols, rows);
      }

      // 将后端生成的稳定 ID 交给前端标签保存
      this.send(ws, { type: "ready", terminalId: handle.id });
    } catch (e: any) {
      this.logger.warn(`Terminal WS auth failed: ${e?.message}`);
      this.send(ws, { type: "error", message: e?.message || "Unauthorized" });
      ws.close(1011, "unauthorized");
      return;
    }

    // 回放 transcript（剥离 DA 握手序列，避免 xterm 对历史查询二次应答）
    if (handle.transcript) {
      this.send(ws, { type: "transcript", text: stripDaHandshake(handle.transcript) });
    }

    // 转发实时输出
    const onData = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) this.send(ws, { type: "output", text: data });
    };
    handle.pty.onData(onData);

    const onExit = (e: { exitCode: number }) => {
      if (ws.readyState === WebSocket.OPEN) this.send(ws, { type: "exit", code: e.exitCode });
    };
    handle.pty.onExit(onExit);

    // 记录 WS → 终端映射
    this.wsSessions.set(ws, { ws, handle, onData, onExit });

    // 消息处理
    ws.on("message", (raw) => {
      let msg: ClientTerminalMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "input":
          handle.pty.write(msg.text);
          break;
        case "resize":
          handle.pty.resize(Math.max(2, Math.floor(msg.cols)), Math.max(2, Math.floor(msg.rows)));
          break;
        case "close":
          // 显式关闭：销毁 PTY
          this.terminalService.dispose(handle.id);
          this.wsSessions.delete(ws);
          ws.close();
          break;
      }
    });

    ws.on("close", () => {
      // WS 断连：只移除监听 + 标记 orphan，不杀 PTY
      try {
        (handle.pty as any).removeListener("data", onData);
        (handle.pty as any).removeListener("exit", onExit);
      } catch {
        /* ignore */
      }
      this.wsSessions.delete(ws);
      this.terminalService.markDisconnected(handle.id);
    });
  }

  /** 查找同 session 的 orphan PTY */
  private findOrphan(sessionId: string): PtyHandle | undefined {
    for (const handle of this.terminalService.list(sessionId)) {
      if (handle.disconnectedAt) return handle;
    }
    return undefined;
  }

  private send(ws: WebSocket, msg: ServerTerminalMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

/** 剥离 transcript 回放中的 DA（Device Attributes）握手序列 */
function stripDaHandshake(text: string): string {
  return text
    // DA 查询 ESC[c / ESC[0c —— 回放会导致 xterm 二次应答
    .replace(/\x1b\[0?c/g, "")
    // DA 应答 ESC[?1;2c / ESC[?6c —— 历史回显残留
    .replace(/\x1b\[\?1;2c/g, "")
    .replace(/\x1b\[\?6c/g, "")
    // 已被回显成可见文本的形式（^[ = ESC 的显示转义）
    .replace(/\^\[\[\?1;2c/g, "")
    .replace(/\^\[\[\?6c/g, "");
}
