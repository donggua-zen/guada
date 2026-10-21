/**
 * BridgeClient —— 此前零测试。
 *
 * 策略：用 net.createServer 在真实临时路径上起一个「假 Electron Bridge 服务端」，
 * 而不是 mock net 模块。理由：分帧、鉴权握手、重连、孤儿自救这些行为只有在真实
 * socket 语义下才有意义（半包、ENOENT、close 事件）。
 *
 * 两个必须处理的坑：
 *  1. bridge-client.ts:174 有 process.exit(1)，必须 spy 掉，否则会杀掉 jest 进程。
 *  2. ORPHAN_EXIT_GRACE_MS 在模块加载时读 env（bridge-client.ts:29-34），
 *     想改它必须用 jest.isolateModules 重新 require 一份新副本。
 */
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { Logger } from "@nestjs/common";
import { BridgeClient } from "../../src/modules/bridge/bridge-client";

/** 每次用独立路径，避免并行/复用时的残留串味 */
function makePipePath(tag: string): string {
  const unique = `${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\guada-bridge-test-${unique}`
    : path.join(os.tmpdir(), `guada-bridge-test-${unique}.sock`);
}

interface FakeBridge {
  pipePath: string;
  /** 服务端收到的所有已解析消息（含首条 auth） */
  received: any[];
  /** 收到 socket 连接后回调（用于「连接即断开」类用例） */
  onConnection?: (socket: net.Socket) => void;
  /** 往所有已连接 socket 写原始文本（用于测分帧） */
  pushRaw(text: string): void;
  reply(msg: any): void;
  close(): Promise<void>;
}

async function startFakeBridge(tag = "bridge", fixedPath?: string): Promise<FakeBridge> {
  const pipePath = fixedPath ?? makePipePath(tag);
  const sockets: net.Socket[] = [];
  const received: any[] = [];
  const state: { onConnection?: (socket: net.Socket) => void } = {};

  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          received.push(JSON.parse(line));
        } catch {
          /* 故意推的坏行，忽略 */
        }
      }
    });
    socket.on("error", () => {
      /* 客户端销毁时可能 EPIPE，测试不关心 */
    });
    state.onConnection?.(socket);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipePath, () => resolve());
  });

  return {
    get pipePath() {
      return pipePath;
    },
    received,
    set onConnection(fn) {
      state.onConnection = fn;
    },
    pushRaw: (text: string) => {
      for (const s of sockets) if (!s.destroyed) s.write(text);
    },
    reply: (msg: any) => {
      const text = JSON.stringify(msg) + "\n";
      for (const s of sockets) if (!s.destroyed) s.write(text);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil 超时");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("BridgeClient", () => {
  const clients: BridgeClient[] = [];
  let bridge: FakeBridge | undefined;
  const savedPath = process.env.GUADA_BRIDGE_PATH;
  const savedToken = process.env.GUADA_BRIDGE_TOKEN;

  /** 起服务端 → 造客户端 → 等到已连接 */
  async function connectClient(tag = "bridge"): Promise<BridgeClient> {
    bridge = await startFakeBridge(tag);
    process.env.GUADA_BRIDGE_PATH = bridge.pipePath;
    process.env.GUADA_BRIDGE_TOKEN = "test-token";
    const client = new BridgeClient();
    clients.push(client);
    client.onModuleInit();
    await client.ready; // 连接成功即 resolve（bridge-client.ts:118-122）
    return client;
  }

  beforeEach(() => {
    // BridgeClient 在连接/重连/失联路径上会大量打日志，静音以保持输出可读
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        c.onModuleDestroy();
      } catch {
        /* ignore */
      }
    }
    await bridge?.close();
    bridge = undefined;
    jest.restoreAllMocks();
    if (savedPath === undefined) delete process.env.GUADA_BRIDGE_PATH;
    else process.env.GUADA_BRIDGE_PATH = savedPath;
    if (savedToken === undefined) delete process.env.GUADA_BRIDGE_TOKEN;
    else process.env.GUADA_BRIDGE_TOKEN = savedToken;
  });

  describe("初始化与鉴权", () => {
    it("未设置 GUADA_BRIDGE_PATH 时禁用自身且 ready 仍 resolve", async () => {
      delete process.env.GUADA_BRIDGE_PATH;
      const client = new BridgeClient();
      clients.push(client);

      client.onModuleInit();

      await expect(client.ready).resolves.toBeUndefined();
      // 未连接 → request 直接拒绝
      await expect(client.request("m", {})).rejects.toThrow("Bridge not connected");
    });

    it("连接成功后立即发送 auth 消息，携带 env 里的 token", async () => {
      const client = await connectClient("auth");

      await waitUntil(() => bridge!.received.length >= 1);
      expect(bridge!.received[0]).toEqual({ type: "auth", token: "test-token" });

      // 已连接 → 请求能正常发出
      void client;
    });

    it("emit 在未连接时只告警不抛错", async () => {
      delete process.env.GUADA_BRIDGE_PATH;
      const client = new BridgeClient();
      clients.push(client);
      client.onModuleInit();

      expect(() => client.emit("port_ready", { port: 3000 })).not.toThrow();
    });

    it("isConnected 反映真实连接：连上为 true，宿主断开后回落 false", async () => {
      delete process.env.GUADA_BRIDGE_PATH;
      const disabled = new BridgeClient();
      clients.push(disabled);
      disabled.onModuleInit();
      await disabled.ready;
      expect(disabled.isConnected).toBe(false);

      const client = await connectClient("is-connected");
      expect(client.isConnected).toBe(true);

      await bridge!.close();
      bridge = undefined;
      await waitUntil(() => client.isConnected === false);
      // 周期性上报（keep-awake）据此跳过 emit，避免断线期间刷告警
      expect(client.isConnected).toBe(false);
    });
  });

  describe("request / response 配对", () => {
    it("按 id 配对请求与响应", async () => {
      const client = await connectClient("pair");

      const pending = client.request("browser_navigate", { url: "https://example.com" });
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));

      const req = bridge!.received.find((m) => m.type === "request");
      expect(req).toMatchObject({
        type: "request",
        id: "1",
        method: "browser_navigate",
        params: { url: "https://example.com" },
      });

      bridge!.reply({ type: "response", id: req.id, result: { ok: true } });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    it("并发请求各自按 id 拿到自己的响应（乱序也不串）", async () => {
      const client = await connectClient("concurrent");

      const first = client.request("m1", {});
      const second = client.request("m2", {});
      await waitUntil(() => bridge!.received.filter((m) => m.type === "request").length === 2);
      const [r1, r2] = bridge!.received.filter((m) => m.type === "request");

      // 故意乱序回复
      bridge!.reply({ type: "response", id: r2.id, result: "second" });
      bridge!.reply({ type: "response", id: r1.id, result: "first" });

      await expect(first).resolves.toBe("first");
      await expect(second).resolves.toBe("second");
    });

    it("响应带 error 字段时 reject", async () => {
      const client = await connectClient("error");

      const pending = client.request("m", {});
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));
      const req = bridge!.received.find((m) => m.type === "request");

      bridge!.reply({ type: "response", id: req.id, error: "宿主侧执行失败" });

      await expect(pending).rejects.toThrow("宿主侧执行失败");
    });

    it("结构化 error 对象保留 code/details", async () => {
      const client = await connectClient("error-structured");

      const pending = client.request("m", {});
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));
      const req = bridge!.received.find((m) => m.type === "request");

      bridge!.reply({
        type: "response",
        id: req.id,
        error: {
          code: "ELEMENT_NOT_FOUND",
          message: "missing",
          details: { selector: "#x" },
        },
      });

      await expect(pending).rejects.toMatchObject({
        code: "ELEMENT_NOT_FOUND",
        details: { selector: "#x" },
      });
    });

    it("未连接的 request 直接 reject（Bridge not connected）", async () => {
      delete process.env.GUADA_BRIDGE_PATH;
      const client = new BridgeClient();
      clients.push(client);
      client.onModuleInit();
      await client.ready;

      await expect(client.request("m", {})).rejects.toThrow("Bridge not connected");
    });

    it("已中止的 AbortSignal → 同步抛 Aborted", async () => {
      const client = await connectClient("abort-pre");
      const controller = new AbortController();
      controller.abort();

      await expect(client.request("m", {}, controller.signal)).rejects.toThrow("Aborted: m");
    });

    it("等待过程中 abort → reject Aborted", async () => {
      const client = await connectClient("abort-mid");
      const controller = new AbortController();

      const pending = client.request("slow", {}, controller.signal);
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));
      controller.abort();

      await expect(pending).rejects.toThrow("Aborted: slow");
    });

    it("120s 无响应 → 超时 reject 并清理 pending", async () => {
      const client = await connectClient("timeout");

      // 注意：request() 内部用 setTimeout 排超时，必须在「调用 request 之前」就切到假定时器，
      // 而 waitUntil 依赖真实 setTimeout —— 所以本用例不做 waitUntil，只用 advanceTimersByTime。
      // socket 内部依赖 nextTick/microtask，必须放行，否则真实写包会卡死。
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
      try {
        const pending = client.request("never-reply", {});

        jest.advanceTimersByTime(120_001);

        await expect(pending).rejects.toThrow("Bridge request timeout");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("消息分帧", () => {
    it("一次 data 含多条完整消息 + 半条：半条被缓冲，补齐后解析", async () => {
      const client = await connectClient("framing");

      const a = client.request("a", {});
      const b = client.request("b", {});
      const c = client.request("c", {});
      await waitUntil(() => bridge!.received.filter((m) => m.type === "request").length === 3);
      const [ra, rb, rc] = bridge!.received.filter((m) => m.type === "request");

      const lineC = JSON.stringify({ type: "response", id: rc.id, result: "C" });
      // 两条完整 + 第三条的前 12 个字符（半包）
      bridge!.pushRaw(
        JSON.stringify({ type: "response", id: ra.id, result: "A" }) +
          "\n" +
          JSON.stringify({ type: "response", id: rb.id, result: "B" }) +
          "\n" +
          lineC.slice(0, 12),
      );

      await expect(a).resolves.toBe("A");
      await expect(b).resolves.toBe("B");

      // 半包补齐
      bridge!.pushRaw(lineC.slice(12) + "\n");
      await expect(c).resolves.toBe("C");
    });

    it("坏 JSON 行被丢弃，不影响同一批次里的合法行", async () => {
      const client = await connectClient("badjson");

      const pending = client.request("m", {});
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));
      const req = bridge!.received.find((m) => m.type === "request");

      bridge!.pushRaw("this is not json\n");
      bridge!.pushRaw(JSON.stringify({ type: "response", id: req.id, result: "ok" }) + "\n");

      await expect(pending).resolves.toBe("ok");
    });

    it("空行被忽略", async () => {
      const client = await connectClient("blank");

      const pending = client.request("m", {});
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"));
      const req = bridge!.received.find((m) => m.type === "request");

      bridge!.pushRaw("\n\n" + JSON.stringify({ type: "response", id: req.id, result: "ok" }) + "\n\n");

      await expect(pending).resolves.toBe("ok");
    });
  });

  describe("事件通道", () => {
    it("服务端推 event → 客户端 on 的监听器收到 data", async () => {
      const client = await connectClient("event");
      // client.ready 在客户端 connect 事件就 resolve，此时服务端可能还没触发 connection
      // 回调（sockets 尚空，写包会丢）。先等 auth 到达，确保连接两端都已就绪。
      await waitUntil(() => bridge!.received.length >= 1);

      const received: any[] = [];
      client.on("port_ready", (data) => received.push(data));

      bridge!.pushRaw(JSON.stringify({ type: "event", event: "port_ready", data: { port: 3000 } }) + "\n");

      await waitUntil(() => received.length === 1);
      expect(received[0]).toEqual({ port: 3000 });
    });
  });

  describe("重连与孤儿自救", () => {
    it("服务端断开后客户端自动重连，重连后请求仍可用", async () => {
      bridge = await startFakeBridge("reconnect");
      const pipePath = bridge.pipePath;
      process.env.GUADA_BRIDGE_PATH = pipePath;
      process.env.GUADA_BRIDGE_TOKEN = "test-token";
      const client = new BridgeClient();
      clients.push(client);
      client.onModuleInit();
      await client.ready;

      // 关掉服务端 → 客户端收到 close → 排入重连（首次退避 1000ms）
      await bridge.close();
      bridge = undefined;

      // 在同一路径重建服务端（命名管道/unix socket 均可复用同名）
      bridge = await startFakeBridge("reconnect", pipePath);

      await waitUntil(() => bridge!.received.some((m) => m.type === "auth"), 8000);

      const pending = client.request("after-reconnect", {});
      await waitUntil(() => bridge!.received.some((m) => m.type === "request"), 4000);
      const req = bridge!.received.find((m) => m.type === "request");
      bridge!.reply({ type: "response", id: req.id, result: "back" });

      await expect(pending).resolves.toBe("back");
    }, 20000);

    it("宿主失联超过 grace 期 → 自行退出释放端口（孤儿自救）", async () => {
      const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as any);

      // ORPHAN_EXIT_GRACE_MS 在模块加载时求值，必须重新 require 一份新副本
      process.env.GUADA_BRIDGE_ORPHAN_EXIT_MS = "1";
      let FreshBridgeClient!: typeof BridgeClient;
      jest.isolateModules(() => {
        FreshBridgeClient = require("../../src/modules/bridge/bridge-client").BridgeClient;
      });
      delete process.env.GUADA_BRIDGE_ORPHAN_EXIT_MS;

      // 指向一个不存在的位置：连接必然 ENOENT → close → 记时并排重连
      process.env.GUADA_BRIDGE_PATH = makePipePath("nonexistent");
      const client = new FreshBridgeClient();
      clients.push(client as unknown as BridgeClient);
      client.onModuleInit();

      // 首次失败只记时（bridge-client.ts:163-166），第二次失败累计超 1ms 才 exit
      await waitUntil(() => exitSpy.mock.calls.length > 0, 8000);

      expect(exitSpy).toHaveBeenCalledWith(1);
    }, 20000);

    it("grace 设为 0 时关闭自救（不退出）", async () => {
      const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as any);

      process.env.GUADA_BRIDGE_ORPHAN_EXIT_MS = "0";
      let FreshBridgeClient!: typeof BridgeClient;
      jest.isolateModules(() => {
        FreshBridgeClient = require("../../src/modules/bridge/bridge-client").BridgeClient;
      });
      delete process.env.GUADA_BRIDGE_ORPHAN_EXIT_MS;

      process.env.GUADA_BRIDGE_PATH = makePipePath("nonexistent-disabled");
      const client = new FreshBridgeClient();
      clients.push(client as unknown as BridgeClient);
      client.onModuleInit();

      // 等到至少一次连接失败发生
      await new Promise((r) => setTimeout(r, 800));

      expect(exitSpy).not.toHaveBeenCalled();
    }, 20000);
  });

  describe("销毁", () => {
    it("onModuleDestroy 幂等且不抛错", async () => {
      const client = await connectClient("destroy");

      expect(() => {
        client.onModuleDestroy();
        client.onModuleDestroy();
      }).not.toThrow();
    });

    it("onModuleDestroy 之后不再重连（销毁即停，socket 不再复活）", async () => {
      const client = await connectClient("no-resurrect");
      await waitUntil(() => bridge!.received.length >= 1);
      const receivedBeforeDestroy = bridge!.received.length;

      client.onModuleDestroy();

      // 跨过一次完整退避窗口（首次 1000ms）。若销毁后仍重连，
      // 服务端会再收到一条 auth —— 那正是修复前 scheduleReconnect 缺 shuttingDown 保护的表现。
      await new Promise((r) => setTimeout(r, 1500));

      expect(bridge!.received.length).toBe(receivedBeforeDestroy);
    }, 15000);
  });
});
