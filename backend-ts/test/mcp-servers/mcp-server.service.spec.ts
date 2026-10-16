import { BadRequestException } from "@nestjs/common";
import { McpServerService } from "../../src/modules/mcp-servers/mcp-server.service";

/**
 * 创建 MCP 服务器时的工具名冲突拦截。
 *
 * 工具名不含服务器命名空间（`mcp__<rawName>`），重名工具无法共存——两条同名 function
 * 会让发给供应商的 tools 数组非法、整轮请求被拒。所以在"添加"这一步就报错，
 * 而不是等运行期才发现工具不见了。
 */
describe("McpServerService.createServer 工具名冲突", () => {
  function build(options: {
    existing?: any[];
    fetchedTools?: Record<string, any>;
    listTools?: jest.Mock;
  }) {
    const store = {
      initialize: jest.fn(async () => undefined),
      list: () => options.existing ?? [],
      create: jest.fn(async (data: any) => ({
        ...data,
        id: "new-srv",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      })),
      writeTools: jest.fn(async () => undefined),
      getRow: () => undefined,
    } as any;

    const client = {
      listTools:
        options.listTools ??
        jest.fn(async () => options.fetchedTools ?? { web_search: {} }),
    } as any;

    const pluginManager = { reloadPlugin: jest.fn(async () => undefined) } as any;
    const connections = { invalidate: jest.fn(async () => 0) } as any;

    return {
      service: new McpServerService(store, client, pluginManager, connections),
      store,
      client,
      pluginManager,
      connections,
    };
  }

  const validHttpData = { name: "新服务器", url: "https://example.com/mcp" };

  it("与已启用服务器重名 → 400 报错，且不落盘、不刷新插件", async () => {
    const { service, store, pluginManager } = build({
      existing: [
        { id: "srv1", enabled: true, tools: { web_search: { description: "" } } },
      ],
      fetchedTools: { web_search: {} },
    });

    await expect(service.createServer(validHttpData)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.createServer(validHttpData)).rejects.toThrow(
      /mcp__web_search/,
    );
    expect(store.create).not.toHaveBeenCalled();
    expect(pluginManager.reloadPlugin).not.toHaveBeenCalled();
  });

  it("报错信息里点名占用者，便于定位", async () => {
    const { service } = build({
      existing: [
        { id: "srv1", enabled: true, tools: { web_search: { description: "" } } },
      ],
      fetchedTools: { web_search: {} },
    });

    await expect(service.createServer(validHttpData)).rejects.toThrow(/srv1/);
  });

  it("不重名 → 正常创建、写工具缓存并刷新插件", async () => {
    const { service, store, pluginManager } = build({
      existing: [
        { id: "srv1", enabled: true, tools: { fetch: { description: "" } } },
      ],
      fetchedTools: { web_search: {} },
    });

    await service.createServer(validHttpData);

    expect(store.create).toHaveBeenCalled();
    expect(store.writeTools).toHaveBeenCalledWith("new-srv", {
      web_search: {},
    });
    expect(pluginManager.reloadPlugin).toHaveBeenCalledWith("mcp");
  });

  it("与已停用服务器重名不算冲突（它的工具包未注册）", async () => {
    const { service, store } = build({
      existing: [
        { id: "srv1", enabled: false, tools: { web_search: { description: "" } } },
      ],
      fetchedTools: { web_search: {} },
    });

    await service.createServer(validHttpData);

    expect(store.create).toHaveBeenCalled();
  });

  it("抓取工具失败（返回空表）不阻断创建", async () => {
    const { service, store, pluginManager } = build({
      existing: [
        { id: "srv1", enabled: true, tools: { web_search: { description: "" } } },
      ],
      fetchedTools: {},
    });

    await service.createServer(validHttpData);

    expect(store.create).toHaveBeenCalled();
    expect(store.writeTools).not.toHaveBeenCalled();
    expect(pluginManager.reloadPlugin).toHaveBeenCalledWith("mcp");
  });
});

/**
 * 配置变更时对已建连接的释放。
 *
 * 运行期工具调用走池化长连接，所以"服务器被删/被禁用/配置被改"必须显式通知连接管理器，
 * 否则 stdio 子进程会活到空闲 TTL 到期才被回收。
 */
describe("McpServerService 连接释放", () => {
  function build(row: any) {
    const store = {
      initialize: jest.fn(async () => undefined),
      getRow: () => row,
      getConfig: () => row,
      delete: jest.fn(async () => true),
      update: jest.fn(async (_id: string, data: any) => ({ ...row, ...data })),
      writeTools: jest.fn(async () => undefined),
    } as any;
    const client = { listTools: jest.fn(async () => ({})), healthCheck: jest.fn() } as any;
    const pluginManager = { reloadPlugin: jest.fn(async () => undefined) } as any;
    const connections = { invalidate: jest.fn(async () => 1) } as any;

    return {
      service: new McpServerService(store, client, pluginManager, connections),
      store,
      client,
      pluginManager,
      connections,
    };
  }

  const row = {
    id: "srv1",
    name: "服务器",
    url: "https://example.com/mcp",
    type: "streamableHttp",
    command: null,
    args: null,
    env: null,
    cwd: null,
    headers: null,
    enabled: true,
  };

  it("删除服务器时立即释放连接", async () => {
    const { service, connections, pluginManager } = build(row);

    await service.deleteServer("srv1");

    expect(connections.invalidate).toHaveBeenCalledWith("srv1");
    expect(pluginManager.reloadPlugin).toHaveBeenCalledWith("mcp");
  });

  it("禁用服务器时断开连接", async () => {
    const { service, connections } = build(row);

    await service.toggleServerStatus("srv1", false);

    expect(connections.invalidate).toHaveBeenCalledWith("srv1");
  });

  it("启用服务器时不预连（留给首次工具调用按需建立）", async () => {
    const { service, connections } = build(row);

    await service.toggleServerStatus("srv1", true);

    expect(connections.invalidate).not.toHaveBeenCalled();
  });

  it("改配置时释放旧连接（不等空闲 TTL）", async () => {
    const { service, connections } = build(row);

    await service.updateServer("srv1", { name: "改了名字" });

    expect(connections.invalidate).toHaveBeenCalledWith("srv1");
  });

  it("测试连接只探测链路，不改动任何状态", async () => {
    const { service, client, connections, store } = build(row);
    client.healthCheck.mockResolvedValueOnce(true);

    await expect(service.testConnection("srv1")).resolves.toEqual({ ok: true });

    expect(client.healthCheck).toHaveBeenCalledTimes(1);
    expect(client.healthCheck.mock.calls[0][1]).toEqual({ serverId: "srv1" });
    // 关键：不释放连接、不写缓存、不刷新插件
    expect(connections.invalidate).not.toHaveBeenCalled();
    expect(store.writeTools).not.toHaveBeenCalled();
  });

  it("测试连接失败时如实返回 ok=false 而不是抛错", async () => {
    const { service, client } = build(row);
    client.healthCheck.mockResolvedValueOnce(false);

    await expect(service.testConnection("srv1")).resolves.toEqual({
      ok: false,
      error: "Connection failed",
    });
  });
});
