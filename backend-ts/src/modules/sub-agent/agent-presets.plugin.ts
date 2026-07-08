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
    description:
      "预设 Agent 角色列表，可通过 subagent_spawn + characterId 创建",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private agentScanner: AgentScannerService) {
    super();
  }

  async onLoad(api: PluginApi) {
    // ── 注册艾特命令提供者（含解析器） ──
    api.registerCommandProvider({
      id: "subagent",
      trigger: "mention",
      fetchItems: async () => {
        const allAgents = await this.agentScanner.listAgents();
        // 仅返回可见的 agent
        // const visibleAgents = allAgents.filter(
        //   (a) => a.visible && a.folderVisible !== false,
        // );
        const visibleAgents = allAgents;
        return visibleAgents.map((a) => ({
          name: a.id,
          description: a.description,
          label: `${a.emoji || ""} ${a.name}`,
        }));
      },
      parse: async (attrs) => {
        const agentId = attrs.name || "unknown";
        const allAgents = await this.agentScanner.listAgents();
        const agent = allAgents.find((a) => a.id === agentId);
        if (!agent) return undefined;
        const description =
          agent.visible && agent.folderVisible ? agent.description : "";

        return {
          replacement: `\`@subagent: ${agent.name}(id:${agent.id})\``,
          appendix: agent.description
            ? `\n<agents>name:${agent.name}\id:${agent.id}\n${description ? `description:${description}` : ""}</agents>`
            : undefined,
        };
      },
    });
    // 轻量 Agent 列表提示词
    api.registerPrompt({
      frequency: "REGULAR",
      description: "可用预设 Agent 列表及使用指南",
      content: async (context: PluginContext) => {
        const allAgents = await this.agentScanner.listAgents();
        // 仅注入可见的 agent（自身 visible + 文件夹 cascade）
        const visibleAgents = allAgents.filter(
          (a) => a.visible && a.folderVisible !== false,
        );
        if (visibleAgents.length === 0) return "";

        // 按角色级偏好过滤（复刻 SkillPlugin 逻辑）
        const charAgentCfg = context?.session.getSettings?.("agents");
        let agents: AgentDefinition[];

        // 1. 提取文件夹配置（不以 agent- 开头且非系统字段的 key 视为文件夹名）
        const folderCfg: Record<string, boolean> = {};
        if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
          for (const key of Object.keys(charAgentCfg)) {
            if (key.startsWith("__") || key.startsWith("agent-")) continue;
            if (typeof charAgentCfg[key] === "boolean") {
              folderCfg[key] = charAgentCfg[key];
            }
          }
        }

        // 2. 过滤掉文件夹关闭的 agent
        const folderFiltered = visibleAgents.filter((a) => {
          if (a.folder && folderCfg[a.folder] === false) return false;
          return true;
        });

        // 3. 再按 agent 级黑白名单过滤
        if (charAgentCfg === false) {
          agents = [];
        } else if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
          if (charAgentCfg.__default === false) {
            // 白名单：只保留显式 true 的 agent
            agents = folderFiltered.filter((a) => charAgentCfg[a.id] === true);
          } else {
            // 黑名单：排除显式 false 的 agent
            agents = folderFiltered.filter((a) => charAgentCfg[a.id] !== false);
          }
        } else {
          agents = folderFiltered;
        }
        if (agents.length === 0) return "";

        const agentXml = agents
          .map((a) => {
            return [
              `   - name: ${a.name}\nid: ${a.id}\ndescription: ${a.description}`,
            ].join("\n");
          })
          .join("\n");

        return [
          "",
          "# Agents",
          "",
          "You can use the following preset Agent roles. ",
          "Scan the agent descriptions to see if they match user requirements. If they match, use subagent_spawn with agentId to create a sub-agent.",
          "Preset Agents already have built-in role instructions and working methods.",
          "You only need to specify requirements and deliverables, no need to specify additional workflows.",
          "In addition to the agents listed, if the user actively @mentions an agent, you can also use it.",
          "",
          "<agents>",
          agentXml,
          "</agents>",
        ].join("\n");
      },
    });
  }
}
