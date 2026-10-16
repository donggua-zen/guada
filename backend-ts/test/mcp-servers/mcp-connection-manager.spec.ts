import { Logger } from "@nestjs/common";
import {
  buildConnectionKey,
  isNotConnectedError,
  McpConnectionManager,
} from "../../src/common/mcp/mcp-connection-manager.service";
import { resolveTransportKind } from "../../src/common/mcp/mcp.types";

/**
 * McpConnectionManager 的连接复用与生命周期。
 *
 * SDK 的 Client 与 transport 全部替身化：这里验证的是管理器自己的策略
 * （single-flight 建连、按配置换代、空闲回收、克制重试），不是协议实现。
 *
 * 注意 jest.mock 的工厂会被提升到文件顶部，工厂内引用的外部变量必须带 `mock` 前缀，
 * 因此替身类声明在工厂内部、通过 mock 前缀的注册表把实例交回测试。
 */

/** 替身实例注册表 + 故障注入开关（供 jest.mock 工厂与断言共用） */
const mockRegistry: { clients: any[]; transports: any[] } = {
  clients: [],
  transports: [],
};
let mockConnectFailure: Error | null = null;
let mockPingFailure: any = null;
let mockListToolsFailure: any = null;
const mockKillProcessTree = jest.fn(
  (_pid: number, _opts?: any): Promise<boolean> => Promise.resolve(true),
);

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class Client {
    onclose?: () => void;
    connect = jest.fn(async () => {
      if (mockConnectFailure) {
        const failure = mockConnectFailure;
        mockConnectFailure = null;
        throw failure;
      }
    });
    // 真实 SDK 的 close() 会触发 onclose，替身照做——否则「主动关闭先摘 onclose」
    // 这条顺序就失去了被测对象
    close = jest.fn(async () => {
      this.onclose?.();
    });
    listTools = jest.fn(async () => {
      if (mockListToolsFailure) throw mockListToolsFailure;
      return { tools: [] };
    });
    callTool = jest.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    ping = jest.fn(async () => {
      if (mockPingFailure) throw mockPingFailure;
      return {};
    });

    constructor() {
      mockRegistry.clients.push(this);
    }
  }
  return { Client };
});

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  class StdioClientTransport {
    pid: number | null = 4242;
    stderr: any = null;
    close = jest.fn(async () => undefined);
    constructor(public params: any) {
      mockRegistry.transports.push(this);
    }
  }
  return { StdioClientTransport };
});

jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class StreamableHTTPClientTransport {
    close = jest.fn(async () => undefined);
    constructor(public url: any, public opts: any) {
      mockRegistry.transports.push(this);
    }
  }
  return { StreamableHTTPClientTransport };
});

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  class SSEClientTransport {
    close = jest.fn(async () => undefined);
    constructor(public url: any, public opts: any) {
      mockRegistry.transports.push(this);
    }
  }
  return { SSEClientTransport };
});

// 真正下刀去杀 pid 会 spawn taskkill：一律替身化，只验证「有没有调用回收」
jest.mock("../../src/common/utils/process-tree.util", () => ({
  isProcessAlive: jest.fn(() => false),
  killProcessTree: (pid: number, opts?: any) => mockKillProcessTree(pid, opts),
  killProcessTreeSyncBestEffort: jest.fn(),
}));

const STDIO_CONFIG = {
  type: "stdio" as const,
  command: "node",
  args: ["srv.js"],
};

let warnSpy: jest.SpyInstance;

/** 测试期间创建的 manager，afterEach 统一关闭（不留空闲扫描定时器） */
const liveManagers: McpConnectionManager[] = [];

/** 建一个 manager 并登记，避免用例结束时仍有扫描定时器在跑 */
function buildManager(): McpConnectionManager {
  const manager = new McpConnectionManager();
  liveManagers.push(manager);
  return manager;
}

/** 进程树回收是否以该 pid 被调用过 */
function killedPidAt(index = 0): number | undefined {
  return mockKillProcessTree.mock.calls[index]?.[0];
}

beforeEach(() => {
  mockRegistry.clients.length = 0;
  mockRegistry.transports.length = 0;
  mockConnectFailure = null;
  mockPingFailure = null;
  mockListToolsFailure = null;
  mockKillProcessTree.mockClear();
  warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(liveManagers.map((manager) => manager.shutdown()));
  liveManagers.length = 0;
  warnSpy.mockRestore();
});

/** 日志里是否出现过"意外断开" */
function sawUnexpectedDisconnect(): boolean {
  return warnSpy.mock.calls.some((call) =>
    String(call[0]).includes("意外断开"),
  );
}

// ---------- 传输归一 ----------

describe("resolveTransportKind", () => {
  it("把各种写法折叠为三种真实协议", () => {
    expect(resolveTransportKind({ type: "stdio" })).toBe("stdio");
    expect(resolveTransportKind({ type: "sse" })).toBe("sse");
    expect(resolveTransportKind({ type: "streamableHttp" })).toBe("streamableHttp");
    // 下划线变体：历史配置与前端注释里出现过 streamable_http
    expect(resolveTransportKind({ type: "streamable_http" })).toBe("streamableHttp");
    expect(resolveTransportKind({ type: "STREAMABLEHTTP" })).toBe("streamableHttp");
  });

  it("缺省 type 时按 command 推断，否则走 HTTP", () => {
    expect(resolveTransportKind({ command: "node" })).toBe("stdio");
    expect(resolveTransportKind({ url: "http://x/mcp" })).toBe("streamableHttp");
  });
});

// ---------- 连接键 ----------

describe("buildConnectionKey", () => {
  it("同一份配置得到同一个键（与字段书写顺序无关）", () => {
    expect(
      buildConnectionKey("srv1", {
        type: "stdio",
        command: "node",
        args: ["a.js"],
        env: { B: "2", A: "1" },
      }),
    ).toBe(
      buildConnectionKey("srv1", {
        env: { A: "1", B: "2" },
        args: ["a.js"],
        command: "node",
        type: "stdio",
      }),
    );
  });

  it("配置任一处变化都会换代（保住「配置改动立即生效」）", () => {
    const base = buildConnectionKey("srv1", STDIO_CONFIG);
    expect(
      buildConnectionKey("srv1", { ...STDIO_CONFIG, command: "python" }),
    ).not.toBe(base);
    expect(
      buildConnectionKey("srv1", { ...STDIO_CONFIG, args: ["other.js"] }),
    ).not.toBe(base);
    expect(buildConnectionKey("srv1", { ...STDIO_CONFIG, cwd: "/tmp" })).not.toBe(
      base,
    );
    expect(
      buildConnectionKey("srv1", { ...STDIO_CONFIG, env: { TOKEN: "x" } }),
    ).not.toBe(base);
  });

  it("不同服务器即使配置完全相同也不共享连接", () => {
    expect(buildConnectionKey("srv1", STDIO_CONFIG)).not.toBe(
      buildConnectionKey("srv2", STDIO_CONFIG),
    );
  });

  it("等价写法不换代：type 缺省与显式 stdio 同键", () => {
    expect(buildConnectionKey("s", { command: "node", args: ["a"] })).toBe(
      buildConnectionKey("s", { type: "stdio", command: "node", args: ["a"] }),
    );
  });
});

// ---------- 错误判定 ----------

describe("isNotConnectedError", () => {
  it("只认 SDK 的裸文案", () => {
    expect(isNotConnectedError(new Error("Not connected"))).toBe(true);
    expect(isNotConnectedError(new Error("not connected"))).toBe(false);
    expect(isNotConnectedError(new Error("Not connected: transport closed"))).toBe(
      false,
    );
    expect(isNotConnectedError("Not connected")).toBe(false);
  });
});

// ---------- 池化连接 ----------

describe("McpConnectionManager 连接复用", () => {
  it("连续调用复用同一条连接，不再每次重建", async () => {
    const manager = buildManager();

    for (let i = 0; i < 3; i += 1) {
      await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (client) => {
        await client.ping();
      });
    }

    expect(mockRegistry.clients).toHaveLength(1);
    expect(mockRegistry.clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it("并发调用只建一次连（single-flight）", async () => {
    const manager = buildManager();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        manager.withPooledConnection(STDIO_CONFIG, "srv1", async (client) => {
          await client.ping();
        }),
      ),
    );

    // 没有 single-flight 时这里会是 10 个 Client / 10 个子进程
    expect(mockRegistry.clients).toHaveLength(1);
    expect(manager.stats().active).toBe(1);
  });

  it("配置变化后使用新连接", async () => {
    const manager = buildManager();

    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());
    await manager.withPooledConnection(
      { ...STDIO_CONFIG, args: ["changed.js"] },
      "srv1",
      async (c) => c.ping(),
    );

    expect(mockRegistry.clients).toHaveLength(2);
  });

  it("stdio 子进程的 stderr 声明为 pipe（不再默认 inherit 污染后端 stderr）", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());

    expect(mockRegistry.transports[0].params.stderr).toBe("pipe");
  });
});

// ---------- 意外断连与重试 ----------

describe("McpConnectionManager 断连恢复", () => {
  it("transport 断开后的下一次取用会重连", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());

    // 模拟服务器进程死亡：SDK 会触发 onclose
    mockRegistry.clients[0].onclose?.();

    expect(sawUnexpectedDisconnect()).toBe(true);
    expect(manager.stats().stale).toBe(1);

    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());

    expect(mockRegistry.clients).toHaveLength(2);
  });

  it("调用中遇到裸 Not connected：重连并重试一次", async () => {
    const manager = buildManager();

    const operation = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("Not connected");
      })
      .mockImplementationOnce(async (client: any) => {
        await client.ping();
        return "done";
      });

    await expect(
      manager.withPooledConnection(STDIO_CONFIG, "srv1", operation),
    ).resolves.toBe("done");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(mockRegistry.clients).toHaveLength(2);
  });

  it("重试只做一次：再次 Not connected 直接上抛", async () => {
    const manager = buildManager();

    const operation = jest.fn().mockImplementation(async () => {
      throw new Error("Not connected");
    });

    await expect(
      manager.withPooledConnection(STDIO_CONFIG, "srv1", operation),
    ).rejects.toThrow("Not connected");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("其它错误不重试（无法确定请求是否已到达服务器）", async () => {
    const manager = buildManager();

    const operation = jest.fn().mockImplementation(async () => {
      throw new Error("tool blew up");
    });

    await expect(
      manager.withPooledConnection(STDIO_CONFIG, "srv1", operation),
    ).rejects.toThrow("tool blew up");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("建连失败会包装为 MCP connection failed", async () => {
    const manager = buildManager();
    mockConnectFailure = new Error("spawn ENOENT");

    await expect(
      manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping()),
    ).rejects.toThrow("MCP connection failed: spawn ENOENT");

    // 失败不留在池里当"可用连接"：下一次取用会重新尝试建连
    expect(manager.stats().stale).toBe(1);
  });
});

// ---------- 回收 ----------

describe("McpConnectionManager 回收", () => {
  it("空闲超时会关闭连接并回收子进程树", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());
    expect(manager.stats().active).toBe(1);

    await manager.sweepIdleNow(0);

    expect(manager.stats().active).toBe(0);
    expect(killedPidAt()).toBe(4242);
  });

  it("未到 TTL 的连接不被回收", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());

    await manager.sweepIdleNow(60_000);

    expect(manager.stats().active).toBe(1);
    expect(mockKillProcessTree).not.toHaveBeenCalled();
  });

  it("invalidate 只释放指定服务器，且立即回收进程", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());
    await manager.withPooledConnection(STDIO_CONFIG, "srv2", async (c) => c.ping());
    expect(manager.stats().active).toBe(2);

    const released = await manager.invalidate("srv1");

    expect(released).toBe(1);
    expect(manager.stats().active).toBe(1);
    expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
    // 主动释放不是断连故障，不该产生"意外断开"告警
    expect(sawUnexpectedDisconnect()).toBe(false);
  });

  it("shutdown 关闭全部连接并拒绝新建", async () => {
    const manager = buildManager();
    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());
    await manager.withPooledConnection(STDIO_CONFIG, "srv2", async (c) => c.ping());

    await manager.shutdown();

    expect(manager.stats().active).toBe(0);
    expect(
      mockRegistry.clients.every((c) => c.close.mock.calls.length === 1),
    ).toBe(true);
    // 关闭过程中替身会触发 onclose，若未先摘除就会被误记为意外断连
    expect(sawUnexpectedDisconnect()).toBe(false);
    await expect(
      manager.withPooledConnection(STDIO_CONFIG, "srv3", async (c) => c.ping()),
    ).rejects.toThrow("MCP 连接管理器正在关闭");
  });
});

// ---------- 短连接 ----------

describe("McpConnectionManager 短连接", () => {
  it("用完即关，不进入池", async () => {
    const manager = buildManager();

    await manager.withEphemeralConnection(STDIO_CONFIG, "srv1", async (c) =>
      c.ping(),
    );

    expect(manager.stats().active).toBe(0);
    expect(mockRegistry.clients[0].close).toHaveBeenCalledTimes(1);
    expect(killedPidAt()).toBe(4242);
  });

  it("操作抛错时仍然关闭连接", async () => {
    const manager = buildManager();

    await expect(
      manager.withEphemeralConnection(STDIO_CONFIG, "srv1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mockRegistry.clients[0].close).toHaveBeenCalledTimes(1);
    expect(manager.stats().active).toBe(0);
  });

  it("取消信号绑定到独占建连上（短连接不会掐到别人）", async () => {
    const manager = buildManager();
    const controller = new AbortController();

    await manager.withEphemeralConnection(
      STDIO_CONFIG,
      "srv1",
      async (c) => c.ping(),
      { signal: controller.signal },
    );

    expect(mockRegistry.clients[0].connect.mock.calls[0][1].signal).toBe(
      controller.signal,
    );
  });

  it("池化建连不绑定任何调用方的信号（共享连接不能被单个调用掐掉）", async () => {
    const manager = buildManager();
    const controller = new AbortController();

    await manager.withPooledConnection(STDIO_CONFIG, "srv1", async (c) => c.ping());

    // 池化路径不接收信号参数；即便调用方已 abort，共享建连也不受影响
    controller.abort();
    expect(mockRegistry.clients[0].connect.mock.calls[0][1].signal).toBeUndefined();
    expect(manager.stats().active).toBe(1);
  });
});

// ---------- 连通性检查 ----------

describe("McpConnectionManager.checkHealth", () => {
  it("ping 通过时直接判为健康，不再多发一次 tools/list", async () => {
    const manager = buildManager();

    await expect(manager.checkHealth(STDIO_CONFIG, "srv1")).resolves.toBe(true);

    expect(mockRegistry.clients[0].ping).toHaveBeenCalledTimes(1);
    // 轻量路径：合规服务器只花一次 ping 往返（工具列表可能很大，能省则省）
    expect(mockRegistry.clients[0].listTools).not.toHaveBeenCalled();
  });

  it("ping 报协议层错误（未实现 ping）→ 用 tools/list 复核后判为健康", async () => {
    const manager = buildManager();
    const methodNotFound: any = new Error("Method not found");
    methodNotFound.code = -32601;
    mockPingFailure = methodNotFound;

    await expect(manager.checkHealth(STDIO_CONFIG, "srv1")).resolves.toBe(true);

    expect(mockRegistry.clients[0].listTools).toHaveBeenCalledTimes(1);
  });

  it("ping 被严格 schema 拒（结果多带字段）→ 仍判为健康", async () => {
    const manager = buildManager();
    // SDK 对 ping 结果用 EmptyResultSchema（strict）校验，多一个字段就抛数组型 Zod 错误，
    // 且没有错误码——正是 metaso 的成因
    mockPingFailure = [
      {
        code: "unrecognized_keys",
        keys: ["status"],
        path: [],
        message: 'Unrecognized key: "status"',
      },
    ];

    await expect(manager.checkHealth(STDIO_CONFIG, "srv1")).resolves.toBe(true);

    expect(mockRegistry.clients[0].listTools).toHaveBeenCalledTimes(1);
  });

  it("ping 与 tools/list 都失败才算不可用", async () => {
    const manager = buildManager();
    mockPingFailure = new Error("ping 不通");
    mockListToolsFailure = new Error("listTools 也不通");

    await expect(manager.checkHealth(STDIO_CONFIG, "srv1")).resolves.toBe(false);
  });

  it("建连失败判为不可用，且不抛错（配置页只需一个布尔结论）", async () => {
    const manager = buildManager();
    mockConnectFailure = new Error("ECONNREFUSED");

    await expect(manager.checkHealth(STDIO_CONFIG, "srv1")).resolves.toBe(false);
  });
});
