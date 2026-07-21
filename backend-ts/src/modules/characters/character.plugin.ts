import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext } from "../plugins/types/plugin.types";
import { CharacterRepository } from "../../common/database/character.repository";

@Injectable()
export class CharacterPlugin extends PluginBase {
  private readonly logger = new Logger(CharacterPlugin.name);
  manifest = {
    id: "character",
    name: "角色",
    description: "预设角色列表，可通过 @ 唤起或 subagent_spawn 创建子代理",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private characterRepo: CharacterRepository) {
    super();
  }

  async onLoad(api: PluginApi) {
    // ── @mention 命令提供者 ──
    api.registerCommandProvider({
      id: "agent",
      trigger: "mention",
      fetchItems: async () => {
        const { items } = await this.characterRepo.findAll(0, 200);
        return items.map((c: any) => ({
          name: c.id,
          description: c.title || c.name || "",
          label: c.title || c.id,
        }));
      },
      parse: async (attrs) => {
        const characterId = attrs.name || "";
        if (!characterId) return undefined;

        const character = await this.characterRepo.findById(characterId, false);
        if (!character) return undefined;

        const displayName = character.title || characterId;
        return {
          replacement: `\`@subagent: ${displayName} (id:${characterId})\``,
          appendix: character.description
            ? `<available_agents>name:${displayName}\nid:${characterId}\n${character.description ? `description:${character.description}` : ""}</available_agents>`
            : undefined,
        };
      },
    });

    // ── 预设角色列表提示词（从 agent-presets.plugin.ts 迁移） ──
    api.registerPrompt({
      frequency: "REGULAR",
      description: "可用预设角色列表及使用指南",
      content: async (context: PluginContext) => {
        if (context?.session.sessionType === "sub_agent") return "";

        const { items } = await this.characterRepo.findAll(0, 200);
        if (items.length === 0) return "";

        // 当前会话的角色 ID，排除自身
        const currentCharacterId = context?.session?.getSettings?.("systemPrompt") ? undefined : undefined;
        // 通过 session 获取当前 characterId 不可直接拿到，
        // 预设列表包含所有角色即可，LLM 不会 spawn 自身

        const charAgentCfg = context?.session.getSettings?.("agents");

        let agents: any[];

        if (charAgentCfg === false) {
          agents = [];
        } else if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
          if (charAgentCfg.__default === false) {
            // 白名单：只保留显式 true 的角色
            agents = items.filter((c: any) => charAgentCfg[c.id] === true);
          } else {
            // 黑名单：排除显式 false 的角色
            agents = items.filter((c: any) => charAgentCfg[c.id] !== false);
          }
        } else {
          // 无配置：默认白名单模式，不注入任何角色
          agents = [];
        }

        if (agents.length === 0) return "";

        const agentXml = agents
          .map((a: any) => {
            return `   - name: ${a.title}\nid: ${a.id}\ndescription: ${a.description || ""}`;
          })
          .join("\n");

        return [
          "",
          "# Agents",
          "",
          "You can use the following preset Agent roles as a default visible list. ",
          "These preset Agents have built-in system instructions and dedicated working methods. ",
          "Scan their descriptions to see if they match the user's requirements. If so, use subagent_spawn with the corresponding agentId to create a sub-agent. ",
          "When using a preset Agent, you only need to specify requirements and deliverables; no additional workflow instructions are required. ",
          "However, the preset list does not mean you are restricted to these only.",
          "You are still free to use the general-purpose agent, or spawn sub-tasks based on any agent that the user explicitly @mentions in the conversation. ",
          "** You are also allowed to create sub-tasks with agents specified by the user, even if they are not in the preset list. ** ",
          "",
          "<agents>",
          agentXml,
          "</agents>",
        ].join("\n");
      },
    });
  }
}
