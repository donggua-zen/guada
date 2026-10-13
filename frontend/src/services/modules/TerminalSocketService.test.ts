import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 终端 WS 地址解析测试。
 *
 * 背景：Electron 打包版渲染进程由 file:// 加载，后端端口是**动态**的（随机分配；
 * 只有 dev 恰好固定 3000）。终端 WS 曾写死 ws://localhost:3000 —— dev 正常、打包版
 * 连不上（后端日志里连一条终端连接都没有）。这里钉住「必须复用 ApiService 已解析的
 * 动态端口，并且要等端口就绪再建连」。
 */

const apiServiceMock = vi.hoisted(() => ({
  baseURL: "http://localhost:3000/api/v1",
  ensureBackendUrlReady: vi.fn(async () => {}),
}));

vi.mock("@/services/ApiService", () => ({ apiService: apiServiceMock }));

import { TerminalSocketService } from "./TerminalSocketService";

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

interface WindowEnv {
  location: { protocol: string; href: string; host: string };
  electronAPI?: unknown;
}

const globalRef = globalThis as unknown as {
  window?: WindowEnv;
  WebSocket?: unknown;
};

/** 模拟渲染进程环境：file: = Electron（打包版）；http: = Web/dev */
function setWindowEnv(opts: {
  protocol: string;
  href: string;
  host?: string;
  electron?: boolean;
}): void {
  globalRef.window = {
    location: { protocol: opts.protocol, href: opts.href, host: opts.host ?? "" },
    electronAPI: opts.electron ? {} : undefined,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("TerminalSocketService WS 地址解析", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    globalRef.WebSocket = MockWebSocket;
    apiServiceMock.baseURL = "http://localhost:3000/api/v1";
    apiServiceMock.ensureBackendUrlReady.mockClear();
    apiServiceMock.ensureBackendUrlReady.mockImplementation(async () => {});
  });

  afterEach(() => {
    delete globalRef.window;
    delete globalRef.WebSocket;
  });

  it("Electron（file:）用 ApiService 的动态端口，而不是写死的 3000", async () => {
    setWindowEnv({
      protocol: "file:",
      href: "file:///Applications/GuaDa.app/Contents/Resources/frontend/dist/index.html",
      electron: true,
    });
    apiServiceMock.baseURL = "http://localhost:53211/api/v1";

    const svc = new TerminalSocketService();
    svc.connect("tok", "session-1", { cols: 80, rows: 24 });
    await flush();

    expect(apiServiceMock.ensureBackendUrlReady).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(
      "ws://localhost:53211/api/v1/terminal/ws?token=tok&sessionId=session-1&cols=80&rows=24",
    );
    svc.disconnect();
  });

  it("Electron 端口未就绪时退回默认 3000（由自动重连兜底）", async () => {
    setWindowEnv({ protocol: "file:", href: "file:///app/index.html", electron: true });

    const svc = new TerminalSocketService();
    svc.connect("tok", "session-1");
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url.startsWith("ws://localhost:3000/api/v1/terminal/ws")).toBe(
      true,
    );
    svc.disconnect();
  });

  it("Web/dev 用同源 window.location.host（走 Vite 代理）", async () => {
    setWindowEnv({ protocol: "http:", href: "http://localhost:5173/chat", host: "localhost:5173" });

    const svc = new TerminalSocketService();
    svc.connect("tok", "session-1");
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url.startsWith("ws://localhost:5173/api/v1/terminal/ws")).toBe(
      true,
    );
    svc.disconnect();
  });

  it("端口就绪前 disconnect 则不再建连", async () => {
    setWindowEnv({ protocol: "file:", href: "file:///app/index.html", electron: true });
    let resolveReady: () => void = () => {};
    apiServiceMock.ensureBackendUrlReady.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveReady = () => r();
        }),
    );

    const svc = new TerminalSocketService();
    svc.connect("tok", "session-1");
    svc.disconnect();
    resolveReady();
    await flush();

    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
