import { McpClientService } from "../../src/common/mcp/mcp-client.service";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
} from "../../src/common/mcp/mcp-connection-manager.service";

/**
 * McpClientService 的协议请求组装与结果塑形。
 *
 * 连接管理器整体替身化——这一层测的是「请求参数有没有被放到正确位置」与
 * 「失败/协议级错误有没有如实上报」，两者都是历史上真实踩过或漏过的点。
 */

const CONFIG = { type: "stdio" as const, command: "node", args: ["srv.js"] };

function build() {
  // 参数必须显式声明，否则 jest.fn 推断出零参签名，mock.calls[n] 取不到位置参数
  const client = {
    listTools: jest.fn(
      async (_params?: any, _options?: any): Promise<any> => ({ tools: [] }),
    ),
    callTool: jest.fn(
      async (
        _params?: any,
        _resultSchema?: any,
        _options?: any,
      ): Promise<any> => ({ content: [] }),
    ),
    ping: jest.fn(async (_options?: any): Promise<any> => ({})),
  };

  // 管理器直接替身化：把 operation 立刻作用在假 client 上
  const connections = {
    withPooledConnection: jest.fn(
      (_config: any, _serverId: any, operation: any, _options: any) =>
        operation(client),
    ),
    withEphemeralConnection: jest.fn(
      (_config: any, _serverId: any, operation: any, _options: any) =>
        operation(client),
    ),
    checkHealth: jest.fn(async () => true),
  };

  const service = new McpClientService(connections as any);
  return { service, client, connections };
}

describe("McpClientService.callTool", () => {
  it("成功时拍平 content 数组并标记 isError=false", async () => {
    const { service, client } = build();
    client.callTool.mockResolvedValueOnce({
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    });

    const result = await service.callTool(CONFIG, "echo", { a: 1 });

    expect(result.success).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.content).toBe("line1\nline2");
  });

  it("协议级 isError 透传：不能让模型把工具错误当成正常输出", async () => {
    const { service, client } = build();
    client.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "file not found" }],
    });

    const result = await service.callTool(CONFIG, "read", {});

    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    // 正文仍然带出去：模型要靠它判断怎么改
    expect(result.content).toBe("file not found");
  });

  it("抛出异常时也标记失败，并给出可读原因", async () => {
    const { service, client } = build();
    const failure: any = new Error("fetch failed");
    failure.cause = new Error("ECONNREFUSED 127.0.0.1:3000");
    client.callTool.mockRejectedValueOnce(failure);

    const result = await service.callTool(CONFIG, "read", {});

    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.error).toContain("ECONNREFUSED");
    expect(result.content).toContain("Error:");
  });

  it("signal 与超时落在 SDK 的第三参数位（传错位置会让取消静默失效）", async () => {
    const { service, client } = build();
    const controller = new AbortController();

    await service.callTool(CONFIG, "echo", {}, { signal: controller.signal });

    const [params, resultSchema, options] = client.callTool.mock.calls[0];
    expect(params).toEqual({ name: "echo", arguments: {} });
    expect(resultSchema).toBeUndefined();
    expect(options.signal).toBe(controller.signal);
    expect(options.timeout).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });

  it("调用方指定的超时覆盖默认值", async () => {
    const { service, client } = build();

    await service.callTool(CONFIG, "echo", {}, { timeoutMs: 1234 });

    expect(client.callTool.mock.calls[0][2].timeout).toBe(1234);
  });

  it("serverId 透传给管理器，决定连接归属", async () => {
    const { service, connections } = build();

    await service.callTool(CONFIG, "echo", {}, { serverId: "srv-1" });

    expect(connections.withPooledConnection.mock.calls[0][1]).toBe("srv-1");
  });

  it("结构化输出（content 非数组）回退为整体序列化", async () => {
    const { service, client } = build();
    client.callTool.mockResolvedValueOnce({ structuredContent: { ok: true } });

    const result = await service.callTool(CONFIG, "echo", {});

    expect(result.content).toBe(JSON.stringify({ structuredContent: { ok: true } }));
  });
});

describe("McpClientService.listTools", () => {
  it("返回以工具名为键的字典，并跳过无名条目", async () => {
    const { service, client } = build();
    client.listTools.mockResolvedValueOnce({
      tools: [
        { name: "alpha", description: "a" },
        { name: "beta", description: "b" },
        { description: "没有名字" },
      ],
    });

    const tools = await service.listTools(CONFIG);

    expect(Object.keys(tools).sort()).toEqual(["alpha", "beta"]);
    expect(tools.alpha.description).toBe("a");
  });

  it("走短连接（配置期操作不占池）", async () => {
    const { service, connections } = build();

    await service.listTools(CONFIG, { serverId: "srv-1" });

    expect(connections.withEphemeralConnection).toHaveBeenCalledTimes(1);
    expect(connections.withPooledConnection).not.toHaveBeenCalled();
    expect(connections.withEphemeralConnection.mock.calls[0][1]).toBe("srv-1");
  });

  it("超时与 signal 落在 listTools 的第二参数位", async () => {
    const { service, client } = build();
    const controller = new AbortController();

    await service.listTools(CONFIG, { signal: controller.signal });

    const [params, options] = client.listTools.mock.calls[0];
    expect(params).toBeUndefined();
    expect(options.signal).toBe(controller.signal);
    expect(options.timeout).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });
});

describe("McpClientService.healthCheck", () => {
  it("委托给管理器的连通性检查", async () => {
    const { service, connections } = build();
    connections.checkHealth.mockResolvedValueOnce(false);

    await expect(service.healthCheck(CONFIG, { serverId: "srv-1" })).resolves.toBe(
      false,
    );
    expect(connections.checkHealth).toHaveBeenCalledWith(CONFIG, "srv-1", {
      serverId: "srv-1",
    });
  });
});
