import { Logger } from "@nestjs/common";
import { McpPlugin } from "../../src/modules/mcp-servers/tools/mcp.plugin";
import type { PluginApi } from "../../src/modules/plugins/api/plugin-api";

/**
 * McpPlugin 的工具包注册与角色门控映射。
 *
 * MCP 的每个服务器注册一个 `governance: "self"` 的工具包——不参与通用角色层过滤，
 * 由 handler 读 `pluginsConfig.mcp`（MCP 管理页写入的 settings.plugins.mcp）裁决 eager/none。
 * 两个批量开关（__strategy / __default）刻意不作用于它。
 */

/** 捕获 registerToolKit 注册结果的极简 PluginApi 替身 */
function createApiCapture() {
  const toolKits: Array<{
    def: any;
    tools: any[];
    registerTool: (d: any) => void;
    registerRawTool: (d: any) => void;
    registerPrompt: (d: any) => void;
  }> = [];
  const api = {
    registerNls: () => {},
    registerToolKit: (def: any) => {
      const tk = {
        def,
        tools: [] as any[],
        registerTool: (d: any) => tk.tools.push(d),
        registerRawTool: (d: any) => tk.tools.push(d),
        registerPrompt: () => {},
      };
      toolKits.push(tk);
      return tk;
    },
  } as unknown as PluginApi;
  return { api, toolKits };
}

function createServer(
  id: string,
  name: string,
  toolNames: string[],
  createdAt = "2026-01-01T00:00:00.000Z",
) {
  const tools: Record<string, any> = {};
  for (const t of toolNames) {
    tools[t] = { description: `desc ${t}`, inputSchema: { type: "object", properties: {} } };
  }
  return { id, name, enabled: true, createdAt, tools };
}

describe("McpPlugin 工具包注册与角色门控", () => {
  function build(servers: any[]) {
    const mcpStore = {
      initialize: jest.fn(async () => undefined),
      listEnabled: () => servers,
    } as any;
    const plugin = new McpPlugin({} as any, mcpStore);
    const { api, toolKits } = createApiCapture();
    return { plugin, api, toolKits };
  }

  it("每个服务器注册一个 mcp_<id> 工具包，标为自治理，工具名带 mcp__ 前缀", async () => {
    const { plugin, api, toolKits } = build([
      createServer("srv1", "搜索", ["web_search"]),
      createServer("srv2", "抓取", ["fetch"]),
    ]);

    await plugin.onLoad(api);

    expect(toolKits.map((k) => k.def.id)).toEqual(["mcp_srv1", "mcp_srv2"]);
    expect(toolKits.every((k) => k.def.governance === "self")).toBe(true);
    expect(toolKits[0].def.name).toBe("搜索");
    expect(toolKits[0].tools.map((t) => t.name)).toEqual(["mcp__web_search"]);
    expect(toolKits[1].tools.map((t) => t.name)).toEqual(["mcp__fetch"]);
  });

  it("两个服务器暴露同名工具时只保留创建更早的那个，并记 error（不发重复 function）", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      const { plugin, api, toolKits } = build([
        createServer("srvNew", "新的", ["search", "new_only"], "2026-02-01T00:00:00.000Z"),
        createServer("srvOld", "旧的", ["search", "old_only"], "2026-01-01T00:00:00.000Z"),
      ]);

      await plugin.onLoad(api);

      const names = toolKits.flatMap((k) => k.tools.map((t) => t.name));
      // srvOld 拥有 search；srvNew 的 search 被跳过
      expect(names).toEqual(["mcp__new_only", "mcp__search", "mcp__old_only"]);
      // 关键：没有重名（重名会让请求被供应商拒绝）
      expect(new Set(names).size).toBe(names.length);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("mcp__search"),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("未抓取到工具的服务器不注册工具包", async () => {
    const { plugin, api, toolKits } = build([
      { id: "srv0", name: "空", enabled: true, tools: null },
    ]);

    await plugin.onLoad(api);

    expect(toolKits).toHaveLength(0);
  });

  describe("handler：settings.plugins.mcp → loadMode", () => {
    async function handlerFor(pluginsConfig: unknown) {
      const { plugin, api, toolKits } = build([
        createServer("srv1", "搜索", ["web_search"]),
      ]);
      await plugin.onLoad(api);
      return toolKits[0].def.handler({ pluginsConfig }) as {
        loadMode: string;
      };
    }

    it("无条目 → 放行（等于没管过）", async () => {
      expect(await handlerFor(undefined)).toEqual({ loadMode: "eager" });
      expect(await handlerFor({})).toEqual({ loadMode: "eager" });
    });

    it("黑名单：拒绝列出的服务器", async () => {
      expect(
        await handlerFor({ mcp: { toolkits_deny: ["mcp_srv1"] } }),
      ).toEqual({ loadMode: "none" });
      expect(
        await handlerFor({ mcp: { toolkits_deny: ["mcp_other"] } }),
      ).toEqual({ loadMode: "eager" });
    });

    it("白名单：只放行列出的服务器，空列表等于全禁", async () => {
      expect(
        await handlerFor({
          mcp: { toolkits_filter: "allow", toolkits_allow: ["mcp_srv1"] },
        }),
      ).toEqual({ loadMode: "eager" });
      expect(
        await handlerFor({
          mcp: { toolkits_filter: "allow", toolkits_allow: ["mcp_other"] },
        }),
      ).toEqual({ loadMode: "none" });
      expect(
        await handlerFor({ mcp: { toolkits_filter: "allow" } }),
      ).toEqual({ loadMode: "none" });
    });

    it("deny_all（全部禁用）→ 不分服务器一律 none，且不动记住的列表", async () => {
      expect(
        await handlerFor({
          mcp: { toolkits_filter: "deny_all", toolkits_allow: ["mcp_srv1"] },
        }),
      ).toEqual({ loadMode: "none" });
      expect(
        await handlerFor({ mcp: { toolkits_filter: "deny_all" } }),
      ).toEqual({ loadMode: "none" });
    });

    it("批量开关不作用于自治理工具包", async () => {
      expect(
        await handlerFor({ __strategy: "deny_nonsystem" }),
      ).toEqual({ loadMode: "eager" });
      expect(await handlerFor({ __default: false })).toEqual({
        loadMode: "eager",
      });
    });
  });
});
