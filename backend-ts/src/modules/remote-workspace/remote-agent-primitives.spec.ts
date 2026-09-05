import { WebSocketServer, WebSocket } from "ws";
import { RemoteAgent } from "./remote-workspace-agent-manager";
import { RpcClient } from "./rpc";

/**
 * RemoteAgent 原语层测试（真实 WebSocket 回环）：
 * - executeRaw/pollRaw/drainCompletedRaw 的 outputB64 解码（含 gbk）与旧版纯文本兼容
 * - readFileRangeRaw 主路径（readFileRange RPC）+ 旧版 agent 降级（downloadChunk）
 * - globRaw 透传
 */

/** "中文" 的 GBK 编码字节（D6 D0 CE C4）→ base64 */
const GBK_ZHONGWEN_B64 = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]).toString("base64");

describe("RemoteAgent 原语层", () => {
  let server: WebSocketServer;
  let port: number;
  /** 每个 handler 注册可覆盖的 RPC 响应逻辑 */
  let rpcHandler: (req: any, send: (resp: any) => void) => void;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    port = (server.address() as { port: number }).port;
    server.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const req = JSON.parse(raw.toString());
          rpcHandler(req, (resp) =>
            ws.send(JSON.stringify({ id: req.id, ...resp })),
          );
        } catch {
          /* ignore */
        }
      });
    });
  });

  afterAll(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const buildAgent = () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    return new Promise<RemoteAgent>((resolve, reject) => {
      ws.once("open", () => {
        const rpc = new RpcClient(ws);
        rpc.setConnected();
        resolve(new RemoteAgent(rpc, { path: "/remote/proj" }));
      });
      ws.once("error", reject);
    });
  };

  it("executeRaw：outputB64 → 按编码解码（gbk）", async () => {
    rpcHandler = (req, send) => {
      if (req.method === "execute") {
        expect(req.params.outputBase64).toBe(true);
        send({ result: { kind: "completed", outputB64: GBK_ZHONGWEN_B64, exitCode: 0, uptimeMs: 1 } });
        return;
      }
      send({ error: `unknown method: ${req.method}` });
    };
    const agent = await buildAgent();
    const r = await agent.executeRaw("cat gbk.txt", { encoding: "gbk" });
    expect(r.output).toBe("中文");
  });

  it("executeRaw：旧版 agent 纯文本 output 原样透传", async () => {
    rpcHandler = (req, send) => {
      if (req.method === "execute") {
        send({ result: { kind: "completed", output: "plain", exitCode: 0, uptimeMs: 1 } });
        return;
      }
      send({ error: `unknown method: ${req.method}` });
    };
    const agent = await buildAgent();
    const r = await agent.executeRaw("ls", {});
    expect(r.output).toBe("plain");
  });

  it("readFileRangeRaw：主路径 readFileRange RPC", async () => {
    rpcHandler = (req, send) => {
      if (req.method === "readFileRange") {
        expect(req.params).toMatchObject({ path: "/remote/proj/a.bin", offset: 10, length: 5 });
        send({
          result: {
            data: Buffer.from("hello").toString("base64"),
            bytesRead: 5,
          },
        });
        return;
      }
      send({ error: `unknown method: ${req.method}` });
    };
    const agent = await buildAgent();
    const buf = await agent.readFileRangeRaw("a.bin", 10, 5);
    expect(buf.toString()).toBe("hello");
  });

  it("readFileRangeRaw：旧版 agent 降级 downloadChunk", async () => {
    rpcHandler = (req, send) => {
      if (req.method === "readFileRange") {
        send({ error: "unknown method: readFileRange" });
        return;
      }
      if (req.method === "downloadStart") {
        send({ result: { downloadId: "d1", totalBytes: 100 } });
        return;
      }
      if (req.method === "downloadChunk") {
        expect(req.params).toMatchObject({ downloadId: "d1", offset: 10, size: 5 });
        send({ result: { data: Buffer.from("chunk").toString("base64"), isLast: "true" } });
        return;
      }
      if (req.method === "downloadEnd") {
        send({ result: { status: "ok" } });
        return;
      }
      send({ error: `unknown method: ${req.method}` });
    };
    const agent = await buildAgent();
    const buf = await agent.readFileRangeRaw("a.bin", 10, 5);
    expect(buf.toString()).toBe("chunk");
  });

  it("globRaw：透传 pattern/cwd/ignore/limit/deep", async () => {
    rpcHandler = (req, send) => {
      if (req.method === "glob") {
        expect(req.params).toMatchObject({
          pattern: "**/*.ts",
          cwd: "/remote/proj",
          ignore: ["**/node_modules/**"],
          limit: 5,
          deep: 2,
        });
        send({
          result: { files: [{ path: "a.ts", size: 3 }], hasMore: true },
        });
        return;
      }
      send({ error: `unknown method: ${req.method}` });
    };
    const agent = await buildAgent();
    const r = await agent.globRaw("**/*.ts", undefined, ["**/node_modules/**"], 5, 2);
    expect(r.files).toEqual([{ path: "a.ts", size: 3 }]);
    expect(r.hasMore).toBe(true);
  });
});
