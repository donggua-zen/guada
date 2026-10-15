import { WebSocketServer, WebSocket } from "ws";
import { RemoteAgentManager } from "./remote-workspace-agent-manager";
import { RpcClient, WsRpcTransport } from "./rpc";

/**
 * 断线自动恢复测试:
 * 1. 首次 getAgent 建立连接(cache 写入);
 * 2. 服务端断开 → onDisconnect 触发 → manager 自动清理 cache;
 * 3. 再次 getAgent 必须重新建立连接(自动恢复),而非复用死连接。
 */
describe("RemoteAgentManager auto-reconnect on disconnect", () => {
  let server: WebSocketServer;
  let service: any;
  let manager: RemoteAgentManager;
  let deployAndConnectMock: jest.Mock;

  const conns = [
    {
      id: "c1",
      name: "conn1",
      config: { host: "x", port: 22, username: "root", authMethod: "password", path: "/tmp" },
    },
  ];

  beforeEach(() => {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(raw.toString());
          if (req.method === "ping") {
            ws.send(JSON.stringify({ id: req.id, result: { pong: "ok" } }));
          }
        } catch {
          /* ignore */
        }
      });
    });

    service = { getConnections: jest.fn().mockResolvedValue(conns) };
    manager = new RemoteAgentManager(service);

    // 替换 deployAndConnect:每次调用都建立一条真实 WS 连接(模拟新建 agent)
    deployAndConnectMock = jest.fn(async () => {
      const addr = server.address() as { port: number };
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", (e) => reject(e));
      });
      const rpc = new RpcClient(new WsRpcTransport(ws));
      rpc.setConnected();
      return { rpc, ws, sshClient: null as any };
    });
    (manager as any).deployAndConnect = deployAndConnectMock;
  });

  afterEach(async () => {
    manager.dispose();
    for (const c of server.clients) c.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  function attachments() {
    return { "ssh-connection": ["c1"] };
  }

  test("first getAgent establishes connection", async () => {
    const agent = await manager.getAgent("conn1", "sessA", attachments());
    expect(deployAndConnectMock).toHaveBeenCalledTimes(1);
    // 连接可用
    const rpc: any = (agent as any).rpc;
    const result = await rpc.call("ping");
    expect(result.pong).toBe("ok");
  });

  test("disconnect removes cache and next getAgent reconnects", async () => {
    await manager.getAgent("conn1", "sessA", attachments());
    expect(deployAndConnectMock).toHaveBeenCalledTimes(1);

    // 服务端断开所有连接
    for (const c of server.clients) c.terminate();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // 再次调用:必须重建(自动恢复),而非复用死连接
    const agent2 = await manager.getAgent("conn1", "sessA", attachments());
    expect(deployAndConnectMock).toHaveBeenCalledTimes(2);
    const rpc2: any = (agent2 as any).rpc;
    const result = await rpc2.call("ping");
    expect(result.pong).toBe("ok");
  });
});

/**
 * 命令失败文案分类(回归:远端报错曾被一律说成"未按时返回 + 去读日志",
 * 导致"工作目录不存在"被误读为"sh 缺失/超时")。
 * agent 明确拒绝 → 直接呈现原因;只有传输类失败才用"未按时返回"。
 */
describe("RemoteAgent.execute error wording", () => {
  let server: WebSocketServer;
  let manager: RemoteAgentManager;

  const conns = [
    {
      id: "c1",
      name: "conn1",
      config: { host: "x", port: 22, username: "root", authMethod: "password", path: "/home/donggua" },
    },
  ];

  beforeEach(() => {
    server = new WebSocketServer({ port: 0 });
    const service = { getConnections: jest.fn().mockResolvedValue(conns) };
    manager = new RemoteAgentManager(service as any);
    (manager as any).deployAndConnect = jest.fn(async () => {
      const addr = server.address() as { port: number };
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", (e) => reject(e));
      });
      const rpc = new RpcClient(new WsRpcTransport(ws));
      rpc.setConnected();
      return { rpc, ws, sshClient: null as any };
    });
  });

  afterEach(async () => {
    manager.dispose();
    for (const c of server.clients) c.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  test("agent 明确拒绝(带错误码) → 直接呈现原因,不提示读日志", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(raw.toString());
          ws.send(
            JSON.stringify({
              id: req.id,
              error: "working directory does not exist: '/home/donggua'",
              code: "invalid_cwd",
            }),
          );
        } catch {
          /* ignore */
        }
      });
    });

    const agent = await manager.getAgent("conn1", "sessA", { "ssh-connection": ["c1"] });
    const text = await agent.execute("echo hi");

    expect(text).toContain("Remote command failed");
    expect(text).toContain("working directory does not exist");
    expect(text).not.toContain("did not return in time");
  });

  test("传输类失败(断连) → 保留\"未按时返回\"提示", async () => {
    server.on("connection", () => {
      /* 静默:不回复,靠断连触发 */
    });

    const agent = await manager.getAgent("conn1", "sessA", { "ssh-connection": ["c1"] });
    const call = agent.execute("echo hi");
    for (const c of server.clients) c.terminate();
    const text = await call;

    expect(text).toContain("did not return in time");
  });
});
