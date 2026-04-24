import { Controller, Get, Put, Body, UseGuards, Post, Query } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { CharacterRepository } from "../../common/database/character.repository";

@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly characterRepo: CharacterRepository,
  ) { }

  @UseGuards(AuthGuard)
  @Get("settings")
  async getSettings(@CurrentUser() user: any) {
    return this.settingsService.getSettings(user.sub);
  }

  @UseGuards(AuthGuard)
  @Put("settings")
  async updateSettings(
    @Body() data: Record<string, any>,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateSettings(user.sub, data);
  }

  /**
   * 获取全局工具列表
   */
  @UseGuards(AuthGuard)
  @Get("settings/tools/global")
  async getGlobalTools(@CurrentUser() user: any) {
    const settings = await this.settingsService.getSettings(user.sub);
    const globalTools = settings.tools || {};
    
    const allTools = await this.toolOrchestrator.getLocalToolsList(user.sub, { tools: globalTools });
    
    return {
      globalTools,
      tools: allTools,
    };
  }

  /**
   * 更新全局工具状态
   */
  @UseGuards(AuthGuard)
  @Put("settings/tools/global")
  async updateGlobalToolStatus(
    @Body() data: { namespace: string; enabled: boolean },
    @CurrentUser() user: any,
  ) {
    const { namespace, enabled } = data;
    
    const currentSettings = await this.settingsService.getSettings(user.sub);
    const currentTools = currentSettings.tools || {};
    
    const updatedTools = {
      ...currentTools,
      [namespace]: enabled,
    };

    await this.settingsService.updateSettings(user.sub, {
      tools: updatedTools,
    });

    return { success: true, namespace, enabled };
  }

  /**
   * 获取角色工具列表（包含有效状态）
   */
  @UseGuards(AuthGuard)
  @Get("settings/tools/character")
  async getCharacterTools(
    @Query('characterId') characterId: string,
    @CurrentUser() user: any,
  ) {
    if (!characterId) {
      throw new Error("characterId is required");
    }

    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }

    const characterTools = (character.settings as any)?.tools || {};
    const globalSettings = await this.settingsService.getSettings(user.sub);
    const globalTools = globalSettings.tools || {};

    const allTools = await this.toolOrchestrator.getLocalToolsList(user.sub, { tools: globalTools });

    return {
      characterId,
      characterTools,
      globalTools,
      tools: allTools.map(tool => ({
        ...tool,
        effectiveEnabled: this.calculateEffectiveEnabled(
          globalTools[tool.namespace],
          characterTools[tool.namespace],
        ),
      })),
    };
  }

  /**
   * 更新角色工具状态
   */
  @UseGuards(AuthGuard)
  @Put("settings/tools/character")
  async updateCharacterToolStatus(
    @Body() data: { characterId: string; namespace: string; enabled: boolean | "all" },
    @CurrentUser() user: any,
  ) {
    const { characterId, namespace, enabled } = data;
    
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }

    const currentTools = (character.settings as any)?.tools || {};
    
    const updatedTools = {
      ...currentTools,
      [namespace]: enabled,
    };

    await this.characterRepo.update(characterId, {
      settings: {
        ...(character.settings as any),
        tools: updatedTools,
      },
    });

    return { success: true, characterId, namespace, enabled };
  }

  /**
   * 计算工具有效状态（全局 ∩ 角色）
   */
  private calculateEffectiveEnabled(globalValue: any, characterValue: any): boolean {
    if (characterValue === "all") {
      return globalValue === true;
    }

    if (typeof characterValue === "boolean") {
      return globalValue === true && characterValue === true;
    }

    return globalValue === true;
  }

  /**
   * 获取免登录状态 - 公开访问
   */
  @Public()
  @Get("settings/auto-login")
  async getAutoLoginStatus() {
    const enabled = await this.settingsService.getAutoLoginEnabled();
    return { enabled };
  }

  /**
   * 设置免登录状态 - 需要认证
   */
  @UseGuards(AuthGuard)
  @Post("settings/auto-login")
  async setAutoLoginStatus(
    @Body() body: { enabled: boolean },
    @CurrentUser() user: any,
  ) {
    await this.settingsService.setAutoLoginEnabled(body.enabled);
    return { success: true };
  }
}
