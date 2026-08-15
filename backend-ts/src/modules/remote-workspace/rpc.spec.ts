import { WebSocketServer, WebSocket } from "ws";
import { RpcClient } from "./rpc";

/**
 * RpcClient 断线通知测试:
 * WebSocket 关闭时必须触发 onDisconnect 回调(供上层清理缓存 → 自动重建)。
 */
describe("RpcClient disconnect notification", () => {
  let server: WebSocketServer;

  beforeEach(() => {
    server = new WebSocketServer({ port: 0 });
  });

  afterEach(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function serverUrl(): string {
    const addr = server.address() as { port: number };
    return `ws://127.0.0.1:${addr.port}`;
  }

  /** 启动一个回显 RPC server:收到 {"id","method":"ping"} → 回 {"id","result":{"pong":"ok"}} */
  function startEchoServer() {
    server.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(raw.toString());
          if (req.method === "ping") {
            ws.send(JSON.stringify({ id: req.id, result: { pong: "ok" } }));
          } else {
            ws.send(JSON.stringify({ id: req.id, error: "unknown method" }));
          }
        } catch {
          /* ignore */
        }
      });
    });
  }

  test("onDisconnect fires when server closes the connection", async () => {
    startEchoServer();
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();

    const disconnected = jest.fn();
    rpc.onDisconnect(disconnected);

    // 正常调用可用
    const ping = await rpc.call<{ pong: string }>("ping");
    expect(ping.pong).toBe("ok");

    // 服务端主动断开 → 必须触发 onDisconnect
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(rpc.isConnected).toBe(false);
  });

  test("pending calls reject with WebSocket closed after disconnect", async () => {
    // 静默 server:收到消息但不回复,使请求一直挂起,断开时才会 reject
    server.on("connection", () => { /* ignore, no reply */ });
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();
    rpc.onDisconnect(() => {});

    const call = rpc.call("ping");
    for (const client of server.clients) client.terminate();

    await expect(call).rejects.toThrow("WebSocket closed");
  });
});
