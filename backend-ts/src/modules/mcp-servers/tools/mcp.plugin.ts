import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../../plugins/base-plugin";
import {
  PluginContext,
  RolePluginConfig,
} from "../../plugins/types/plugin.types";
import { McpClientService } from "../../../common/mcp/mcp-client.service";
import { McpFileStore } from "../mcp-file.store";
import { PluginApi } from "../../plugins/api/plugin-api";
import { isToolkitAllowedByRoleConfig } from "../../plugins/utils/role-toolkit-filter";
import {
  resolveToolOwners,
  toPublicToolName,
} from "../mcp-tool-name";

@Injectable()
export class McpPlugin extends PluginBase {
  private readonly logger = new Logger(McpPlugin.name);

  manifest = {
    id: "mcp",
    name: "MCP 工具",
    description: "通过 Model Context Protocol 连接外部工具和服务",
    version: "1.0.0",
    /** system 类别：插件实例始终加载，工具可用性由 toolsets_allow 控制 */
    category: "system" as const,
  };

  constructor(
    private mcpClient: McpClientService,
    private mcpStore: McpFileStore,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    // onLoad 可能早于启动期导出完成：先等门控放行，避免读到空索引导致工具全丢
    await this.mcpStore.initialize();
    const servers = this.mcpStore.listEnabled();

    // 同名工具的归属：创建更早的服务器拥有（见 resolveToolOwners）
    const ownerOfTool = resolveToolOwners(servers);

    for (const server of servers) {
      if (!server.tools) continue;
      const serverToolKitId = `mcp_${server.id}`;
      const rawTools = server.tools as Record<string, any>;

      // 为每个 MCP 服务器注册一个工具包（返回值方式）
      const toolkit = api.registerToolKit({
        id: serverToolKitId,
        name: server.name || serverToolKitId,
        loadMode: "eager",
        // 智能体级门控由 MCP 自己的管理页写入 settings.plugins.mcp，
        // 不参与通用工具包过滤：「全部禁用」「新插件默认」均不作用于它
        governance: "self",
        handler: (ctx: PluginContext) => {
          const entry = (ctx.pluginsConfig as RolePluginConfig | undefined)?.mcp;
          return {
            loadMode: isToolkitAllowedByRoleConfig(entry, serverToolKitId)
              ? "eager"
              : "none",
          };
        },
      });

      for (const [toolName, toolSchema] of Object.entries(rawTools)) {
        const mcpToolName = toPublicToolName(toolName);

        // 工具名不含服务器命名空间，因此不同 server 可能暴露同名工具。
        // 重复的 function 会让发给供应商的 tools 数组非法（整轮请求被拒），
        // 所以只保留创建更早的那个，另一个跳过并报错（添加服务器时已提前拦下，
        // 这里覆盖启用/改名/上游刷新等运行期引入的冲突）。
        const owner = ownerOfTool.get(mcpToolName);
        if (owner !== server.id) {
          this.logger.error(
            `MCP tool name conflict: "${mcpToolName}" is already provided by server "${owner}"; ` +
              `skipping it on server "${server.id}" (${server.name || server.id}). ` +
              `Rename the tool on one of the servers to use both.`,
          );
          continue;
        }

        const schema = (toolSchema as any).inputSchema;

        toolkit.registerRawTool({
          name: mcpToolName,
          description: (toolSchema as any).description || `Execute ${toolName}`,
          parameters: schema || { type: "object", properties: {} },
          handler: async (
            args: any,
            ctx?: PluginContext,
            abortSignal?: AbortSignal,
          ) => {
            const result = await this.mcpClient.callTool(
              {
                url: server.url || undefined,
                headers: (server.headers as Record<string, any>) || undefined,
                type:
                  (server.type as "sse" | "streamableHttp" | "stdio") ||
                  undefined,
                command: server.command || undefined,
                args: (server.args as string[]) || undefined,
                env: (server.env as Record<string, string>) || undefined,
                cwd: server.cwd || undefined,
              },
              toolName,
              args,
              {
                // 服务器 id 决定连接归属：同一服务器的所有工具共用一条连接，
                // 也便于配置变更/删除时按 id 精确释放
                serverId: server.id,
                // 透传取消信号，否则用户点「停止生成」后 MCP 请求仍会跑到超时
                signal: abortSignal,
              },
            );
            // isError 必须一路带到工具执行器：只返回 content 的话，模型会把
            // 「连接失败/工具报错」的文字当成工具的正常输出使用
            return {
              content: result.content || "",
              ...(result.success ? {} : { isError: true }),
            };
          },
        });
      }
    }
  }
}
