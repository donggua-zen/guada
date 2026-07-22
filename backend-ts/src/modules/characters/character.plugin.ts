import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { CommandContext } from "../commands/interfaces/command-provider.interface";
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
      fetchItems: async (ctx?: CommandContext) => {
        const { items } = await this.characterRepo.findAll(0, 200);

        // 排除当前会话自身的角色
        const candidates = ctx?.characterId
          ? items.filter((c: any) => c.id !== ctx.characterId)
          : items;

        // 无角色上下文时，返回全部角色（向后兼容）
        if (!ctx?.characterId) {
          return candidates.map((c: any) => ({
            name: c.id,
            description: c.title || c.name || "",
            label: c.title || c.id,
          }));
        }

        // 从角色 settings 读取 agents 配置进行过滤
        const character = await this.characterRepo.findById(ctx.characterId, false);
        const agentCfg = (character?.settings as any)?.agents;

        let filtered: any[];

        if (agentCfg === false) {
          filtered = [];
        } else if (typeof agentCfg === "object" && agentCfg !== null) {
          if (agentCfg.__default === false) {
            // 白名单：只保留显式 true 的角色
            filtered = candidates.filter((c: any) => agentCfg[c.id] === true);
          } else {
            // 黑名单：排除显式 false 的角色
            filtered = candidates.filter((c: any) => agentCfg[c.id] !== false);
          }
        } else {
          // 无 agents 配置：返回全部角色
          filtered = candidates;
        }

        return filtered.map((c: any) => ({
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
  }
}
