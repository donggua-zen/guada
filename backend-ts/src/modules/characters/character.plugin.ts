import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { CharacterRepository } from "../../common/database/character.repository";

@Injectable()
export class CharacterPlugin extends PluginBase {
  private readonly logger = new Logger(CharacterPlugin.name);
  manifest = {
    id: "character",
    name: "角色",
    description: "预设角色列表，可通过 @ 唤起",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(private characterRepo: CharacterRepository) {
    super();
  }

  async onLoad(api: PluginApi) {
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
          replacement: `\`@${displayName} (id:${characterId})\``,
          appendix: character.description
            ? `---${displayName} description---\n${character.description}`
            : undefined,
        };
      },
    });
  }
}
