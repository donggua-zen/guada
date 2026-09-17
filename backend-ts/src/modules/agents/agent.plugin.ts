import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { CommandContext } from "../commands/interfaces/command-provider.interface";
import { AgentFileStore } from "./agent-file.store";

@Injectable()
export class AgentPlugin extends PluginBase {
  private readonly logger = new Logger(AgentPlugin.name);
  manifest = {
    id: "agent",
    name: "智能体",
    description: "预设智能体列表，可通过 @ 唤起或 subagent_spawn 创建子代理",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private agentStore: AgentFileStore) {
    super();
  }

  async onLoad(api: PluginApi) {
    // ── @mention 命令提供者 ──
    api.registerCommandProvider({
      id: "agent",
      trigger: "mention",
      fetchItems: async (ctx?: CommandContext) => {
        const items = (await this.agentStore.listAgents()).slice(0, 200);

        // 排除当前会话自身的智能体
        const candidates = ctx?.agentId
          ? items.filter((c: any) => c.id !== ctx.agentId)
          : items;

        // 无智能体上下文时，返回全部智能体（向后兼容）
        if (!ctx?.agentId) {
          return candidates.map((c: any) => ({
            name: c.id,
            description: c.name || c.id,
            label: c.name || c.id,
          }));
        }

        // 从智能体 settings 读取 agents 配置进行过滤
        const agent = await this.agentStore.findById(ctx.agentId);
        const agentCfg = (agent?.settings as any)?.agents;

        let filtered: any[];

        if (agentCfg === false) {
          filtered = [];
        } else if (typeof agentCfg === "object" && agentCfg !== null) {
          // 固定白名单：只保留显式 true 的智能体
          filtered = candidates.filter((c: any) => agentCfg[c.id] === true);
        } else {
          // 无 agents 配置：返回全部智能体
          filtered = candidates;
        }

        return filtered.map((c: any) => ({
          name: c.id,
          description: c.name || c.id,
          label: c.name || c.id,
        }));
      },
      parse: async (attrs) => {
        const agentId = attrs.name || "";
        if (!agentId) return undefined;

        const agent = await this.agentStore.findById(agentId);
        if (!agent) return undefined;

        const displayName = agent.name || agentId;
        return {
          replacement: `\`@subagent: ${displayName} (id:${agentId})\``,
          appendix: agent.description
            ? `<available_agents>name:${displayName}\nid:${agentId}\n${agent.description ? `description:${agent.description}` : ""}</available_agents>`
            : undefined,
        };
      },
    });
  }
}
