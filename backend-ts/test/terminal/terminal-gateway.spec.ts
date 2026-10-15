/**
 * TerminalGateway —— 此前零测试。
 *
 * 两层：
 *  1. stripDaHandshake：transcript 回放前的纯文本清理（DA 握手序列会把 xterm 逼出二次应答）
 *  2. 真正的 WS 集成：在临时端口上起 http server + WebSocketServer，用真实 ws 客户端
 *     验证鉴权闸门（缺 token / 缺 sessionId / JWT 失败 / 会话不存在）与消息分派。
 *
 * 用真实的 TerminalService 替身（而非 mock 掉整个模块），是为了让「归属校验 + orphan 复用」
 * 这类跨层行为也一并被覆盖。
 */
import * as http from "node:http";
import { Logger } from "@nestjs/common";
import { WebSocket } from "ws";
import { TerminalGateway, stripDaHandshake } from "../../src/modules/terminal/terminal.gateway";

class FakePty {
  readonly written: string[] = [];
  readonly resized: Array<{ cols: number; rows: number }> = [];
  private dataHandlers: Array<(d: string) => void> = [];
  private exitHandlers: Array<(e: { exitCode: number }) => void> = [];
  onData(cb: (d: string) => void): void {
    this.dataHandlers.push(cb);
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitHandlers.push(cb);
  }
  write(d: string): void {
    this.written.push(d);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {}
  /** 让 gateway 注册的 onData 回调触发（用于验证 output 转发） */
  push(data: string): void {
    for (const h of this.dataHandlers) h(data);
  }
  removeListener(): void {}
}

interface FakeHandle {
  id: string;
  sessionId: string;
  cwd: string;
  pty: FakePty;
  transcript: string;
  exited: boolean;
  exitCode?: number;
  disconnectedAt?: number;
}

function makeHandle(id: string, sessionId: string, transcript = ""): FakeHandle {
  return { id, sessionId, cwd: "D:/ws", pty: new FakePty(), transcript, exited: false };
}

describe("stripDaHandshake", () => {
  it("剥离 DA 查询序列 ESC[c 与 ESC[0c", () => {
    expect(stripDaHandshake("a\x1b[cb\x1b[0cc")).toBe("abc");
  });

  it("剥离 DA 应答序列 ESC[?1;2c 与 ESC[?6c", () => {
    expect(stripDaHandshake("x\x1b[?1;2cy\x1b[?6cz")).toBe("xyz");
  });

  it("剥离已被回显成可见文本的形式（^[[?1;2c）", () => {
    expect(stripDaHandshake("prompt^[[?1;2c$ ")).toBe("prompt$ ");
  });

  it("不含 DA 序列时原样返回", () => {
    const text = "hello\r\nworld\u001b[31mred\u001b[0m";

    expect(stripDaHandshake(text)).toBe(text);
  });

  it("空字符串返回空字符串", () => {
    expect(stripDaHandshake("")).toBe("");
  });

  it("只剥 DA，不动其它 CSI 序列（如颜色/光标）", () => {
    expect(stripDaHandshake("\u001b[2J\u001b[H\x1b[?1;2c")).toBe("\u001b[2J\u001b[H");
  });
});

describe("TerminalGateway（WS 集成）", () => {
  let server: http.Server;
  let gateway: TerminalGateway;
  let port: number;
  let handles: Map<string, FakeHandle>;
  const openSockets: WebSocket[] = [];

  let jwtResolve: () => void;
  let sessionResult: any;
  const disposeMock = jest.fn();
  const markDisconnectedMock = jest.fn();

  function buildDeps() {
    handles = new Map();
    disposeMock.mockImplementation((id: string) => {
      handles.delete(id);
    });
    const terminalService = {
      get: (id: string) => {
        const h = handles.get(id);
        if (!h) throw new Error(`Terminal ${id} not found`);
        return h;
      },
      createUiTerminal: (sessionId: string, cwd: string) => {
        const h = makeHandle(`created-${handles.size + 1}`, sessionId);
        handles.set(h.id, h);
        return h;
      },
      dispose: disposeMock,
      markDisconnected: markDisconnectedMock,
      list: (sessionId: string) => [...handles.values()].filter((h) => h.sessionId === sessionId),
    };
    return {
      terminalService,
      workspaceService: { resolveSessionWorkspaceDir: async () => "D:/ws" },
      sessionService: { getSessionById: async () => sessionResult },
      jwtService: {
        verifyAsync: async () => {
          if (jwtResolve) return;
          throw new Error("invalid signature");
        },
      },
      accountStore: { getView: () => ({ username: "tester" }) },
    };
  }

  function buildGateway(overrides: Partial<ReturnType<typeof buildDeps>> = {}) {
    const deps = { ...buildDeps(), ...overrides };
    return new TerminalGateway(
      { httpAdapter: { getHttpServer: () => server } } as any,
      deps.terminalService as any,
      deps.workspaceService as any,
      deps.sessionService as any,
      deps.jwtService as any,
      deps.accountStore as any,
      {} as any,
    );
  }

  function openClient(path = "/api/v1/terminal/ws?token=t&sessionId=s1") {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    openSockets.push(ws);
    const messages: any[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on("error", () => {
      /* 服务端主动 close 时客户端可能伴随 error，测试只关心 close */
    });
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    const opened = new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    return { ws, messages, closed, opened };
  }

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jwtResolve = () => undefined; // 默认 JWT 通过
    sessionResult = { id: "s1" };
    disposeMock.mockReset();
    markDisconnectedMock.mockReset();

    server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as any).port;
    gateway = buildGateway();
    gateway.onModuleInit();
  });

  afterEach(async () => {
    for (const ws of openSockets.splice(0)) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    gateway.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  describe("鉴权闸门", () => {
    it("缺 token → 下发 error 并以 1011 关闭", async () => {
      const { messages, closed } = openClient("/api/v1/terminal/ws?sessionId=s1");

      expect(await closed).toBe(1011);
      expect(messages[0]).toMatchObject({ type: "error", message: "Missing token" });
    });

    it("缺 sessionId → 下发 error 并以 1011 关闭", async () => {
      const { messages, closed } = openClient("/api/v1/terminal/ws?token=t");

      expect(await closed).toBe(1011);
      expect(messages[0]).toMatchObject({ type: "error", message: "Missing sessionId" });
    });

    it("JWT 校验失败 → 下发 error 并关闭", async () => {
      jwtResolve = undefined as any; // 让 verifyAsync 抛错

      const { messages, closed } = openClient();

      expect(await closed).toBe(1011);
      expect(messages[0]).toMatchObject({ type: "error", message: "invalid signature" });
    });

    it("会话不存在 → 下发 error 并关闭", async () => {
      sessionResult = null;

      const { messages, closed } = openClient();

      expect(await closed).toBe(1011);
      expect(messages[0]).toMatchObject({ type: "error", message: "Session not found" });
    });

    it("鉴权失败时不创建任何 PTY", async () => {
      const { closed } = openClient("/api/v1/terminal/ws?sessionId=s1");

      await closed;

      expect(handles.size).toBe(0);
    });
  });

  describe("成功连接", () => {
    it("新建终端后下发 ready 携带后端生成的 terminalId", async () => {
      const { messages } = openClient();
      await new Promise((r) => setTimeout(r, 50));

      expect(messages[0]).toMatchObject({ type: "ready", terminalId: "created-1" });
    });

    it("回放 transcript 并剥离 DA 握手序列", async () => {
      const orphan = makeHandle("t-1", "s1", "old output\x1b[?1;2c");
      orphan.disconnectedAt = Date.now(); // 复用 orphan 才会回放 transcript
      handles.set("t-1", orphan);

      const { messages } = openClient("/api/v1/terminal/ws?token=t&sessionId=s1&terminalId=t-1");
      await new Promise((r) => setTimeout(r, 50));

      const transcript = messages.find((m) => m.type === "transcript");
      expect(transcript).toMatchObject({ type: "transcript", text: "old output" });
    });

    it("命中本会话的 orphan 终端 → 复用并清掉 disconnectedAt，不新建", async () => {
      const orphan = makeHandle("orphan-1", "s1");
      orphan.disconnectedAt = Date.now();
      handles.set("orphan-1", orphan);

      const { messages } = openClient("/api/v1/terminal/ws?token=t&sessionId=s1&terminalId=orphan-1");
      await new Promise((r) => setTimeout(r, 50));

      expect(messages[0]).toMatchObject({ type: "ready", terminalId: "orphan-1" });
      expect(handles.get("orphan-1")!.disconnectedAt).toBeUndefined();
      expect(handles.size).toBe(1); // 没有新建
    });

    it("terminalId 属于别的会话 → 不复用，新建终端", async () => {
      const foreign = makeHandle("foreign-1", "other-session");
      foreign.disconnectedAt = Date.now();
      handles.set("foreign-1", foreign);

      const { messages } = openClient("/api/v1/terminal/ws?token=t&sessionId=s1&terminalId=foreign-1");
      await new Promise((r) => setTimeout(r, 50));

      expect(messages[0].terminalId).toBe("created-2");
      expect(handles.get("foreign-1")!.disconnectedAt).toBeDefined(); // 未被碰过
    });
  });

  describe("消息分派", () => {
    async function connectAndGetHandle(id: string) {
      const handle = makeHandle(id, "s1");
      // 设为 orphan：前端重连复用已有终端的真实场景（复用要求 disconnectedAt 为真值）
      handle.disconnectedAt = Date.now();
      handles.set(id, handle);
      const client = openClient(`/api/v1/terminal/ws?token=t&sessionId=s1&terminalId=${id}`);
      await new Promise((r) => setTimeout(r, 50));
      return { handle, ...client };
    }

    it("input 消息写入 PTY", async () => {
      const { handle, ws } = await connectAndGetHandle("p-1");

      ws.send(JSON.stringify({ type: "input", text: "ls\r" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(handle.pty.written).toEqual(["ls\r"]);
    });

    it("resize 消息透传，并把 cols/rows 下限夹到 2", async () => {
      const { handle, ws } = await connectAndGetHandle("p-2");

      ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));
      ws.send(JSON.stringify({ type: "resize", cols: 0, rows: -5 }));
      await new Promise((r) => setTimeout(r, 50));

      expect(handle.pty.resized).toEqual([
        { cols: 100, rows: 40 },
        { cols: 2, rows: 2 },
      ]);
    });

    it("非法 JSON 消息被忽略且不断开连接", async () => {
      const { handle, ws } = await connectAndGetHandle("p-3");

      ws.send("not json at all");
      ws.send(JSON.stringify({ type: "input", text: "ok" }));
      await new Promise((r) => setTimeout(r, 50));

      expect(handle.pty.written).toEqual(["ok"]);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("close 消息 → 销毁 PTY 并关闭连接", async () => {
      const { ws, closed } = await connectAndGetHandle("p-4");

      ws.send(JSON.stringify({ type: "close" }));

      await closed;
      expect(disposeMock).toHaveBeenCalledWith("p-4");
    });

    it("PTY 输出转发为 output 消息", async () => {
      const { handle, messages } = await connectAndGetHandle("p-5");

      handle.pty.push("live data");
      await new Promise((r) => setTimeout(r, 50));

      expect(messages.find((m) => m.type === "output")).toMatchObject({ type: "output", text: "live data" });
    });

    it("WS 断连只标记 orphan，不销毁 PTY", async () => {
      const { ws } = await connectAndGetHandle("p-6");

      ws.terminate();
      await new Promise((r) => setTimeout(r, 100));

      expect(markDisconnectedMock).toHaveBeenCalledWith("p-6");
      expect(disposeMock).not.toHaveBeenCalled();
      expect(handles.has("p-6")).toBe(true);
    });
  });
});
