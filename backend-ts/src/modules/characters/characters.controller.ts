import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CharacterService } from "./character.service";
import { FileInterceptor } from "@nestjs/platform-express";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { PluginManager } from "../plugins/plugin.manager";

@Controller()
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(
    private readonly characterService: CharacterService,
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly pluginManager: PluginManager,
  ) {}

  @Get("characters")
  async getCharacters(@Query() query: any) {
    const { groupId, skip = 0, limit = 20 } = query;
    return this.characterService.getCharacters(
      Number(skip),
      Number(limit),
      groupId,
    );
  }

  // --- Character Group Endpoints ---
  @Get("character-groups")
  async getCharacterGroups() {
    return this.characterService.getGroups();
  }

  @Post("character-groups")
  async createCharacterGroup(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createGroup(user.id, data);
  }

  @Put("character-groups/:id")
  async updateCharacterGroup(@Param("id") id: string, @Body() data: any) {
    return this.characterService.updateGroup(id, data);
  }

  @Delete("character-groups/:id")
  async deleteCharacterGroup(@Param("id") id: string) {
    await this.characterService.deleteGroup(id);
    return { success: true };
  }

  @Get("characters/:id")
  async getCharacterById(@Param("id") id: string) {
    return this.characterService.getCharacterById(id);
  }

  @Post("characters")
  async createCharacter(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createCharacter(user.id, data);
  }

  @Put("characters/:id")
  async updateCharacter(@Param("id") id: string, @Body() data: any) {
    return this.characterService.updateCharacter(id, data);
  }

  @Delete("characters/:id")
  async deleteCharacter(@Param("id") id: string) {
    await this.characterService.deleteCharacter(id);
    return { success: true };
  }

  @Post("characters/:id/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(@Param("id") id: string, @UploadedFile() file: any) {
    return this.characterService.uploadAvatar(id, file);
  }

  /**
   * 获取角色工具列表（包含有效状态）
   * 支持特殊 ID '__new_character__'，用于创建角色时预览全局启用的工具
   * @deprecated 使用 getCharacterPlugins 代替
   */
  @Get("characters/:id/tools")
  async getCharacterTools(@Param("id") characterId: string) {
    const isNewCharacter = characterId === "__new_character__";

    let characterPluginConfig: any;

    if (isNewCharacter) {
      characterPluginConfig = {};
    } else {
      const character =
        await this.characterService.getCharacterById(characterId);
      if (!character) {
        throw new Error("Character not found");
      }
      characterPluginConfig = (character.settings as any)?.plugins ?? (character.settings as any)?.tools;
    }

    const plugins = await this.pluginManager.getAllPlugins(
      true,
      characterPluginConfig,
    );

    const filtered = plugins.filter((p) => p.manifest.category !== "system");

    const denyAll = (characterPluginConfig as any)?.__strategy === "deny_nonsystem";
    return {
      characterId,
      plugins: filtered.map((p) => {
        const isRoleConfigured =
          characterPluginConfig === true ||
          (typeof characterPluginConfig === "object" &&
            p.manifest.id in (characterPluginConfig as any));

        const effective =
          (isRoleConfigured || (denyAll && p.manifest.category !== "system"))
            ? ("role" as const)
            : ("global" as const);

        const pluginCfg =
          characterPluginConfig === true
            ? true
            : typeof characterPluginConfig === "object"
              ? (characterPluginConfig as any)[p.manifest.id]
              : undefined;

        return {
          pluginId: p.manifest.id,
          effective,
          name: p.manifest.id,
          displayName: p.manifest.name,
          description: p.manifest.description,
          category: p.manifest.category,
          enabled: p.enabled,
          isMcp: p.manifest.id === "mcp",
          isSkill: p.manifest.id === "skill",
          tools: this.pluginManager.getPluginTools(p.manifest.id).map((t) => ({
            enabled: pluginCfg === true
              ? true
              : Array.isArray(pluginCfg)
                ? pluginCfg.includes(t.name)
                : p.enabled,
            name: t.name,
            description: t.description,
            parameters: t.parameters as any,
          })),
          toolkits: this.pluginManager.getPluginToolKits(p.manifest.id).map((k) => ({
            id: k.id,
            name: k.name,
            loadMode: k.loadMode,
          })),
          effectiveEnabled: p.enabled,
        };
      }),
    };
  }

  /**
   * 获取角色插件列表（新接口，替代 getCharacterTools）
   * 配置从 character.settings.plugins 读取
   */
  @Get("characters/:id/plugins")
  async getCharacterPlugins(@Param("id") characterId: string) {
    const isNewCharacter = characterId === "__new_character__";

    let characterPluginConfig: any;

    if (isNewCharacter) {
      characterPluginConfig = {};
    } else {
      const character =
        await this.characterService.getCharacterById(characterId);
      if (!character) {
        throw new Error("Character not found");
      }
      // 新接口：从 plugins 字段读取角色级插件配置
      characterPluginConfig = (character.settings as any)?.plugins;
    }

    // 仍然使用旧的 getAllPlugins 逻辑获取插件列表
    const plugins = await this.pluginManager.getAllPlugins(
      true,
      characterPluginConfig,
    );

    const filtered = plugins.filter((p) => p.manifest.category !== "system");

    const denyAll = (characterPluginConfig as any)?.__strategy === "deny_nonsystem";
    return {
      characterId,
      plugins: filtered.map((p) => {
        const isRoleConfigured =
          characterPluginConfig === true ||
          (typeof characterPluginConfig === "object" &&
            p.manifest.id in (characterPluginConfig as any));

        const effective =
          (isRoleConfigured || (denyAll && p.manifest.category !== "system"))
            ? ("role" as const)
            : ("global" as const);

        const pluginCfg =
          characterPluginConfig === true
            ? true
            : typeof characterPluginConfig === "object"
              ? (characterPluginConfig as any)[p.manifest.id]
              : undefined;

        return {
          pluginId: p.manifest.id,
          effective,
          name: p.manifest.id,
          displayName: p.manifest.name,
          description: p.manifest.description,
          category: p.manifest.category,
          enabled: p.enabled,
          isMcp: p.manifest.id === "mcp",
          isSkill: p.manifest.id === "skill",
          tools: this.pluginManager.getPluginTools(p.manifest.id).map((t) => ({
            enabled: pluginCfg === true
              ? true
              : typeof pluginCfg === "object" && !Array.isArray(pluginCfg)
                ? !(pluginCfg.toolkits_deny || []).includes(t.toolSet)
                : p.enabled,
            name: t.name,
            description: t.description,
            parameters: t.parameters as any,
          })),
          toolkits: this.pluginManager.getPluginToolKits(p.manifest.id).map((k) => ({
            id: k.id,
            name: k.name,
            loadMode: k.loadMode,
            enabled: pluginCfg === true
              ? true
              : typeof pluginCfg === "object" && !Array.isArray(pluginCfg) && pluginCfg.toolkits_filter
                ? !(pluginCfg.toolkits_deny || []).includes(k.id)
                : true,
          })),
          effectiveEnabled: p.enabled,
        };
      }),
    };
  }

  /**
   * 计算工具有效状态
   *
   * 说明：getHotPluggableTools 已根据 globalTools 过滤，传入的工具仅包含全局启用的工具。
   * 因此此处只需判断角色级别的配置即可。
   *
   * 规则：
   * 1. 如果角色设置为 true，则启用（跟随全局，自动适应新增工具）
   * 2. 如果角色设置为 false，则禁用
   * 3. 如果角色设置为数组，表示部分启用（至少有一个工具启用就算启用）
   * 4. 如果角色设置为对象，则取 pluginId 的配置（未设置默认为 false）
   * 5. 如果角色未设置，则默认禁用
   */
  private calculateEffectiveEnabled(
    characterTools: any,
    pluginId: string,
  ): boolean {
    // 角色设置为 true，启用（跟随全局，自动适应新增工具）
    if (characterTools === true) {
      return true;
    }

    // 角色设置为 false，禁用
    if (characterTools === false) {
      return false;
    }

    // 角色设置为数组，表示部分启用（至少有一个工具启用就算启用）
    if (Array.isArray(characterTools)) {
      return characterTools.length > 0;
    }

    // 角色设置为对象，取 pluginId 的配置
    if (typeof characterTools === "object" && characterTools !== null) {
      const charValue = characterTools[pluginId];

      // 如果是数组，至少有一个工具启用就算启用
      if (Array.isArray(charValue)) {
        return charValue.length > 0;
      }

      if (charValue === "all" || charValue === true) {
        return true;
      }
      // 其余情况（false 或未设置）均禁用
      return false;
    }

    // 角色未设置（undefined / null），默认禁用
    return false;
  }
}
