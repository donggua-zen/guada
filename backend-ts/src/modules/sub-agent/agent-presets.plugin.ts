import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext } from "../plugins/types/plugin.types";
import { AgentScannerService, AgentDefinition } from "./agent-scanner.service";

@Injectable()
export class AgentPresetsPlugin extends PluginBase {
  private readonly logger = new Logger(AgentPresetsPlugin.name);
  manifest = {
    id: "agent_presets",
    name: "预设 Agent",
    description: "预设 Agent 角色列表，可通过 subagent_spawn + characterId 创建",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private agentScanner: AgentScannerService) {
    super();
  }

  async onLoad(api: PluginApi) {
    // 轻量 Agent 列表提示词
    api.registerPrompt({
      frequency: "REGULAR",
      description: "可用预设 Agent 列表及使用指南",
      content: async (context: PluginContext) => {
        // 团队会话不注入预设 Agent 列表
        if (context?.session.sessionType === "team") return "";
        const allAgents = await this.agentScanner.listAgents();
        // 仅注入可见的 agent（自身 visible + 文件夹 cascade）
        const visibleAgents = allAgents.filter((a) => a.visible && a.folderVisible !== false);
        if (visibleAgents.length === 0) return "";

        // 按角色级偏好过滤（复刻 SkillPlugin 逻辑）
        const charAgentCfg = context?.session.getSettings?.('agents');
        let agents: AgentDefinition[];
        if (charAgentCfg === false) {
          agents = [];
        } else if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
          if (charAgentCfg.__default === false) {
            // 白名单：只保留显式 true 的 agent
            agents = visibleAgents.filter((a) => charAgentCfg[a.id] === true);
          } else {
            // 黑名单：排除显式 false 的 agent
            agents = visibleAgents.filter((a) => charAgentCfg[a.id] !== false);
          }
        } else {
          agents = visibleAgents;
        }
        if (agents.length === 0) return "";

        const agentXml = agents
          .map((a) => {
            return [
              ` <agent id="${a.id}">`,
              `   <name>${a.emoji} ${a.name}</name>`,
              `   <description>${a.description}</description>`,
              ` </agent>`,
            ].join("\n");
          })
          .join("\n");

        return [
          "",
          "# Agents",
          "",
          "You have access to the following lightweight agents. " +
            "Use `subagent_spawn` with `characterId` set to the agent's `id` " +
            "to create a sub-agent with that agent's personality and instructions.",
          "",
          "<available_agents>",
          agentXml,
          "</available_agents>",
        ].join("\n");
      },
    });
  }
}
