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

@Controller()
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(
    private readonly characterService: CharacterService,
    private readonly toolOrchestrator: ToolOrchestrator,
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
   */
  @Get("characters/:id/tools")
  async getCharacterTools(@Param("id") characterId: string) {
    const isNewCharacter = characterId === "__new_character__";

    let characterToolsConfig: any;

    if (isNewCharacter) {
      // 创建角色模式：默认禁用所有工具，由用户手动开启
      characterToolsConfig = false;
    } else {
      const character =
        await this.characterService.getCharacterById(characterId);
      if (!character) {
        throw new Error("Character not found");
      }
      characterToolsConfig = (character.settings as any)?.tools;
    }

    const allTools = await this.toolOrchestrator.getLocalToolsList();

    // 过滤掉全局禁用的工具，不显示在角色配置界面
    const enabledTools = allTools.filter((tool) => tool.enabled);

    return {
      characterId,
      characterTools: characterToolsConfig,
      tools: enabledTools.map((tool) => ({
        ...tool,
        effectiveEnabled: this.calculateEffectiveEnabled(
          characterToolsConfig,
          tool.namespace,
        ),
      })),
    };
  }

  /**
   * 计算工具有效状态
   *
   * 说明：getLocalToolsList 已根据 globalTools 过滤，传入的工具仅包含全局启用的工具。
   * 因此此处只需判断角色级别的配置即可。
   *
   * 规则：
   * 1. 如果角色设置为 true，则启用（跟随全局，自动适应新增工具）
   * 2. 如果角色设置为 false，则禁用
   * 3. 如果角色设置为数组，表示部分启用（至少有一个工具启用就算启用）
   * 4. 如果角色设置为对象，则取 namespace 的配置（未设置默认为 false）
   * 5. 如果角色未设置，则默认禁用
   */
  private calculateEffectiveEnabled(
    characterTools: any,
    namespace: string,
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

    // 角色设置为对象，取 namespace 的配置
    if (typeof characterTools === "object" && characterTools !== null) {
      const charValue = characterTools[namespace];

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
