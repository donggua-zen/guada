import { Controller, Get, Put, Body, UseGuards, Post, Query, Param } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";

@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly toolOrchestrator: ToolOrchestrator,
  ) { }

  /**
   * 获取免登录状态 - 公开访问
   * 注意：必须放在 /settings/:group 之前，避免路由冲突
   */
  @Public()
  @Get("settings/auto-login")
  async getAutoLoginStatus() {
    const enabled = await this.settingsService.getAutoLoginEnabled();
    return { enabled };
  }

  /**
   * 设置免登录状态 - 需要认证
   * 注意：必须放在 /settings/:group 之前，避免路由冲突
   */
  @UseGuards(AuthGuard)
  @Post("settings/auto-login")
  async setAutoLoginStatus(@Body() body: { enabled: boolean }) {
    await this.settingsService.setAutoLoginEnabled(body.enabled);
    return { success: true };
  }

  @Public()
  @Get("settings/:group")
  async getGroupSettings(@Param('group') group: string) {
    return this.settingsService.getGroupSettings(group);
  }

  @UseGuards(AuthGuard)
  @Put("settings/:group")
  async updateGroupSettings(@Param('group') group: string, @Body() data: Record<string, any>) {
    await this.settingsService.updateGroupSettings(group, data);
    return this.settingsService.getGroupSettings(group);
  }

  /**
   * 获取所有设置（合并所有分组，仅用于初始化）
   * @deprecated 建议使用 getGroupSettings 按分组获取
   */
  @Public()
  @Get("settings")
  async getSettings() {
    return this.settingsService.getSettings();
  }

  /**
   * 批量更新多个分组的设置
   * 请求体格式: { system: {...}, models: {...}, tools: {...} }
   */
  @UseGuards(AuthGuard)
  @Put("settings")
  async updateSettings(@Body() data: Record<string, Record<string, any>>) {
    const groups = ['system', 'models', 'tools'];

    for (const group of groups) {
      if (data[group]) {
        await this.settingsService.updateGroupSettings(group, data[group]);
      }
    }

    return this.settingsService.getSettings();
  }

  /**
   * 获取全局工具列表
   */
  @Public()
  @Get("settings/tools/global")
  async getGlobalTools() {
    // 直接获取 tools 分组的配置，效率更高
    const globalToolsConfig = await this.settingsService.getGroupSettings('tools');

    const allTools = await this.toolOrchestrator.getLocalToolsList({ tools: globalToolsConfig });

    return {
      globalTools: globalToolsConfig,
      tools: allTools,
    };
  }

  /**
   * 更新全局工具状态
   * 支持两种模式：
   * 1. 整体开关：{ enabled: boolean } → tools = true/false
   * 2. 单独控制：{ namespace: string, enabled: boolean } → tools[namespace] = enabled
   */
  @UseGuards(AuthGuard)
  @Put("settings/tools/global")
  async updateGlobalToolStatus(@Body() data: { namespace?: string; enabled: boolean }) {
    const { namespace, enabled } = data;

    if (namespace) {
      // 单独控制某个工具
      await this.settingsService.updateGroupSettings('tools', {
        [namespace]: enabled,
      });
    } else {
      // 整体开关
      await this.settingsService.updateGroupSettings('tools', {
        _global: enabled,
      });
    }

    return { success: true, namespace, enabled };
  }
}
