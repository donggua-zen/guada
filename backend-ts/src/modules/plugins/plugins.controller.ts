import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { PluginManager } from "./plugin.manager";
import { ExternalPluginLoader } from "./external/external-plugin-loader";

@Controller("plugins")
export class PluginsController {
  private readonly logger = new Logger(PluginsController.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly externalLoader: ExternalPluginLoader,
  ) {}

  /**
   * 查询插件列表（全局/角色通用）
   * Body: { config?: any } — 角色级插件配置，不传则返回全局状态
   */
  @Public()
  @Post("query")
  async queryPlugins(@Body() body: { config?: any }) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, body?.config, true);

    return {
      plugins: resolved
        .filter((r) => r.plugin.category !== "system")
        .map((r) => ({
          pluginId: r.plugin.id,
          effective: r.effective,
          name: r.plugin.id,
          displayName: r.plugin.name,
          description: r.plugin.description,
          category: r.plugin.category,
          enabled: r.enabled,
          icon: r.plugin.icon,
          source: r.source || "builtin",
          tools: r.allTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters as any,
          })),
          toolkits: r.enabledToolKits.map((k) => ({
            id: k.id,
            name: k.name,
            loadMode: k.loadMode,
            enabled: k.enabled,
          })),
        })),
    };
  }

  /**
   * 获取全局插件列表（旧接口，保留兼容）
   */
  @Public()
  @Get("global")
  async getGlobalPlugins() {
    return this.queryPlugins({});
  }

  /**
   * 获取插件图标
   */
  @Public()
  @Get(":pluginId/icon")
  async getPluginIcon(
    @Param("pluginId") pluginId: string,
    @Res() res: Response,
  ) {
    const instance = this.pluginManager.getPlugin(pluginId);
    const icon = instance?.manifest.icon;

    if (!icon) {
      return res.status(404).send("No icon");
    }

    // data URI 直接返回
    if (icon.startsWith("data:")) {
      return res.redirect(icon);
    }

    // http URL 重定向
    if (icon.startsWith("http")) {
      return res.redirect(icon);
    }

    // 相对路径：从插件目录读取
    const pluginPath = this.externalLoader.getPluginPath(pluginId);
    if (!pluginPath) {
      return res.status(404).send("Plugin directory not found");
    }

    const iconPath = path.resolve(pluginPath, icon);
    if (!fs.existsSync(iconPath)) {
      return res.status(404).send("Icon file not found");
    }

    return res.sendFile(iconPath);
  }

  /**
   * 更新全局插件状态
   * 请求体：{ pluginId: string, enabled: boolean }
   */
  @UseGuards(AuthGuard)
  @Put("global")
  async updateGlobalPluginStatus(@Body() data: { pluginId: string; enabled: boolean }) {
    const { pluginId, enabled } = data;

    // 持久化 + 运行时同步（PluginManager 内部处理）
    await this.pluginManager.setPluginEnabled(pluginId, enabled);

    return { success: true, pluginId, enabled };
  }

  /**
   * 重新加载插件（触发 onUnload -> onLoad 重新注册工具）
   * 外部插件优先使用 ExternalPluginLoader 的重载逻辑
   */
  @UseGuards(AuthGuard)
  @Post("reload/:pluginId")
  async reloadPlugin(@Param("pluginId") pluginId: string) {
    const source = this.pluginManager.getPluginSource(pluginId);
    if (source === "dev" || source === "user") {
      await this.externalLoader.reloadExternalPlugin(pluginId);
    } else {
      await this.pluginManager.reloadPlugin(pluginId);
    }
    return { success: true, pluginId };
  }

  /**
   * 卸载外部插件
   */
  @UseGuards(AuthGuard)
  @Delete(":pluginId")
  async uninstallPlugin(@Param("pluginId") pluginId: string) {
    const source = this.pluginManager.getPluginSource(pluginId);
    if (!source || source === "builtin") {
      throw new BadRequestException("Cannot uninstall built-in plugin");
    }
    await this.externalLoader.uninstallPlugin(pluginId);
    return { success: true, pluginId };
  }
}
