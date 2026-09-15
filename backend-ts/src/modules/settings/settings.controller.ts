import { Controller, Get, Put, Body, UseGuards, Post, Query, Param } from "@nestjs/common";
import * as path from 'path';
import { SettingsService } from "./settings.service";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { PluginManager } from "../plugins/plugin.manager";
import { WorkspaceService } from "../../common/services/workspace.service";

@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly pluginManager: PluginManager,
    private readonly workspaceService: WorkspaceService,
  ) { }

  /**
   * 获取全局工作目录基路径
   * 注意：必须放在 /settings/:group 之前，避免路由冲突
   */
  @UseGuards(AuthGuard)
  @Get("settings/workspace-base-dir")
  async getWorkspaceBaseDir() {
    const dirPath = await this.workspaceService.getEffectiveBaseDir();
    return { workspaceBaseDir: dirPath };
  }

  /**
   * 设置全局工作目录基路径
   * 注意：必须放在 /settings/:group 之前，避免路由冲突
   */
  @UseGuards(AuthGuard)
  @Put("settings/workspace-base-dir")
  async setWorkspaceBaseDir(@Body() body: { workspaceBaseDir: string | null }) {
    if (body.workspaceBaseDir) {
      if (!path.isAbsolute(body.workspaceBaseDir)) {
        throw new Error('工作目录基路径必须是绝对路径');
      }
    }
    await this.settingsService.setWorkspaceBaseDir(body.workspaceBaseDir);
    return { success: true, workspaceBaseDir: body.workspaceBaseDir };
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
   * 请求体格式: { system: {...}, models: {...}, tools: {...}, ocr: {...} }
   */
  @UseGuards(AuthGuard)
  @Put("settings")
  async updateSettings(@Body() data: Record<string, Record<string, any>>) {
    const groups = ['system', 'models', 'tools', 'ocr'];

    for (const group of groups) {
      if (data[group]) {
        await this.settingsService.updateGroupSettings(group, data[group]);
      }
    }

    return this.settingsService.getSettings();
  }

  /**
   * 更新全局插件状态
   * 请求体：{ pluginId: string, enabled: boolean }
   * setPluginEnabled 内部完成持久化（SG_PLUGINS）与运行时同步，此处不再重复写配置。
   */
  @UseGuards(AuthGuard)
  @Put("settings/plugins/global")
  async updateGlobalToolStatus(@Body() data: { pluginId: string; enabled: boolean }) {
    const { pluginId, enabled } = data;

    // 持久化全局配置 + 同步运行时状态（触发 onLoad/onUnload）
    await this.pluginManager.setPluginEnabled(pluginId, enabled);

    return { success: true, pluginId, enabled };
  }
}
