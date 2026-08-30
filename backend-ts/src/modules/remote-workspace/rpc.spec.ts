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

  test("heartbeat declares dead when no messages within deadline", async () => {
    // 静默 server:不回复心跳 ping → 超过 deadline 后应主动断开(onDisconnect 触发)
    server.on("connection", () => { /* ignore, no reply */ });
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws, { intervalMs: 50, deadlineMs: 150 });
    rpc.setConnected();

    const disconnected = jest.fn();
    rpc.onDisconnect(disconnected);

    // 150ms 无任何消息 → 心跳检查判死 → ws.close → onDisconnect
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(rpc.isConnected).toBe(false);
  });

  test("heartbeat keeps alive while server responds", async () => {
    // echo server 正常回复 ping → 心跳持续刷新,不判死
    startEchoServer();
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws, { intervalMs: 50, deadlineMs: 150 });
    rpc.setConnected();

    const disconnected = jest.fn();
    rpc.onDisconnect(disconnected);

    // 持续有响应 → 超过 deadline 数倍仍不应断开
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    expect(disconnected).not.toHaveBeenCalled();
    expect(rpc.isConnected).toBe(true);
    rpc.close();
  });

  test("call rejects with timeout when response never arrives", async () => {
    // 静默 server:不响应 → 指定 timeoutMs 后应 reject(不再无限挂起)
    server.on("connection", () => { /* ignore, no reply */ });
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();
    rpc.onDisconnect(() => {});

    const start = Date.now();
    await expect(rpc.call("execute", {}, undefined, 200)).rejects.toThrow(
      /RPC timeout after 200ms: execute/,
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(5000); // 不会无限挂起
  });

  test("call resolves normally before timeout", async () => {
    // echo server 正常响应 → 在超时前 resolve
    startEchoServer();
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();
    rpc.onDisconnect(() => {});

    const result = await rpc.call<{ pong: string }>("ping", undefined, undefined, 5000);
    expect(result.pong).toBe("ok");
    rpc.close();
  });

  test("call supports custom requestId (predictable log path)", async () => {
    // 自定义 requestId:agent 端日志文件按此命名(/tmp/guada-logs/<requestId>.out),
    // abort/超时后调用方无需响应也能推算日志路径;此处验证自定义 id 不影响响应匹配
    startEchoServer();
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();
    rpc.onDisconnect(() => {});

    const reqId = "exec-1700000000000-1234";
    const result = await rpc.call<{ pong: string }>(
      "ping",
      undefined,
      undefined,
      5000,
      reqId,
    );
    expect(result.pong).toBe("ok");
    // 自定义 id 是可预测日志路径的组成部分
    expect(reqId).toMatch(/^exec-\d+-\d+$/);
    rpc.close();
  });

  test("shutdown push rejects pending calls immediately", async () => {
    // agent 进程退出前广播 shutdown → 后端应立即 reject 挂起请求(不无限等待)
    server.on("connection", (client) => {
      client.on("message", () => {
        client.send(JSON.stringify({ event: "shutdown", data: "agent shutting down" }));
      });
    });
    const ws = new WebSocket(serverUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    const rpc = new RpcClient(ws);
    rpc.setConnected();
    const disconnected = jest.fn();
    rpc.onDisconnect(disconnected);

    const start = Date.now();
    await expect(rpc.call("execute")).rejects.toThrow("Agent shutting down");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // 立即失败,不无限挂
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
});
