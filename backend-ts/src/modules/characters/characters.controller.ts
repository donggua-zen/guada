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
  ) { }

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
    return this.characterService.createGroup(user.sub, data);
  }

  @Put("character-groups/:id")
  async updateCharacterGroup(
    @Param("id") id: string,
    @Body() data: any,
  ) {
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
    return this.characterService.createCharacter(user.sub, data);
  }

  @Put("characters/:id")
  async updateCharacter(
    @Param("id") id: string,
    @Body() data: any,
  ) {
    return this.characterService.updateCharacter(id, data);
  }

  @Delete("characters/:id")
  async deleteCharacter(@Param("id") id: string) {
    await this.characterService.deleteCharacter(id);
    return { success: true };
  }

  @Post("characters/:id/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(
    @Param("id") id: string,
    @UploadedFile() file: any,
  ) {
    return this.characterService.uploadAvatar(id, file);
  }

  /**
   * 获取角色工具列表（包含有效状态）
   */
  @Get("characters/:id/tools")
  async getCharacterTools(@Param('id') characterId: string) {
    const character = await this.characterService.getCharacterById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }

    const characterToolsConfig = (character.settings as any)?.tools;
    
    const globalTools = await this.characterService.getGlobalToolsSettings();

    const allTools = await this.toolOrchestrator.getLocalToolsList('local-user', { tools: globalTools });

    return {
      characterId,
      characterTools: characterToolsConfig,
      globalTools,
      tools: allTools.map(tool => ({
        ...tool,
        effectiveEnabled: this.calculateEffectiveEnabled(
          globalTools,
          characterToolsConfig,
          tool.namespace,
        ),
      })),
    };
  }

  /**
   * 计算工具有效状态
   * 
   * 规则：
   * 1. 如果全局未启用，则无论如何都禁用
   * 2. 如果角色设置为 true，则跟随全局设置（自动适应新增工具）
   * 3. 如果角色设置为 false，则禁用
   * 4. 如果角色设置为对象，则取 namespace 的配置（未设置默认为 true）
   * 5. 如果角色未设置，则跟随全局设置
   */
  private calculateEffectiveEnabled(globalTools: any, characterTools: any, namespace: string): boolean {
    // 首先检查全局是否启用该工具
    let globalEnabled = false;
    if (globalTools === true) {
      globalEnabled = true;
    } else if (globalTools === false) {
      globalEnabled = false;
    } else if (typeof globalTools === 'object') {
      globalEnabled = globalTools[namespace] !== false;
    } else {
      globalEnabled = true;
    }

    // 全局未启用，直接返回 false
    if (!globalEnabled) {
      return false;
    }

    // 角色设置为 true，跟随全局（自动适应）
    if (characterTools === true) {
      return true;
    }

    // 角色设置为 false，禁用
    if (characterTools === false) {
      return false;
    }

    // 角色设置为对象，取 namespace 的配置
    if (typeof characterTools === 'object') {
      const charValue = characterTools[namespace];
      if (charValue === 'all' || charValue === true) {
        return true;
      }
      if (charValue === false) {
        return false;
      }
      // 未设置，跟随全局
      return true;
    }

    // 角色未设置，跟随全局
    return true;
  }
}
