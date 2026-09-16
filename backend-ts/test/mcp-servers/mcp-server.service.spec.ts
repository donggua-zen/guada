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

    return {
      service: new McpServerService(store, client, pluginManager),
      store,
      client,
      pluginManager,
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
