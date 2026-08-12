import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
import { NlsService } from "./i18n/nls.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";

@Controller("plugins")
export class PluginsController {
  private readonly logger = new Logger(PluginsController.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly externalLoader: ExternalPluginLoader,
    private readonly nlsService: NlsService,
    private readonly settingsStorage: SettingsStorage,
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
            display: this.nlsService.resolveDisplay(r.plugin.id, {
              text: t.displayText,
              aggregate: t.displayAggregate,
              argsKey: t.argsKey,
              icon: t.icon,
            }),
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
   * 获取工具展示文案注册表（扁平 name→display）
   *
   * 前端启动时调用，返回所有插件的工具展示文案（已按当前 locale 解析 %key% 引用）。
   */
  @Public()
  @Get("tool-displays")
  async getToolDisplays() {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const result: Record<string, any> = {};

    for (const r of resolved) {
      for (const t of r.allTools) {
        result[t.name] = this.nlsService.resolveDisplay(r.plugin.id, {
          text: t.displayText,
          aggregate: t.displayAggregate,
          argsKey: t.argsKey,
          icon: t.icon,
        });
      }
    }

    return result;
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
    if (!iconPath.startsWith(pluginPath + path.sep) && iconPath !== pluginPath) {
      return res.status(403).send("Access denied");
    }
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

  // ── Plugin Data API: 插件数据自治 ──

  /**
   * 获取插件的全部数据
   */
  @UseGuards(AuthGuard)
  @Get(":pluginId/data")
  async getPluginData(@Param("pluginId") pluginId: string) {
    return this.settingsStorage.getSettings(`plugin:${pluginId}`);
  }

  /**
   * 写入插件数据的单个 key
   */
  @UseGuards(AuthGuard)
  @Put(":pluginId/data/:key")
  async setPluginData(
    @Param("pluginId") pluginId: string,
    @Param("key") key: string,
    @Body() body: { value: any },
  ) {
    await this.settingsStorage.updateSettings(`plugin:${pluginId}`, {
      [key]: body.value,
    });
    return { success: true };
  }

  /**
   * 删除插件数据的单个 key
   */
  @UseGuards(AuthGuard)
  @Delete(":pluginId/data/:key")
  async deletePluginData(
    @Param("pluginId") pluginId: string,
    @Param("key") key: string,
  ) {
    await this.settingsStorage.deleteSettingValue(`plugin:${pluginId}`, key);
    return { success: true };
  }

  // ── Attachment Types API ──

  /**
   * 获取所有注册的附件类型
   */
  @Public()
  @Get("attachment-types")
  async getAttachmentTypes() {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const result: Array<{ id: string; label: string; icon: string; pluginId: string }> = [];
    for (const r of resolved) {
      if (!r.enabled) continue;
      for (const att of r.attachmentTypes) {
        result.push({
          id: att.id,
          label: att.label,
          icon: att.icon,
          pluginId: r.plugin.id,
        });
      }
    }
    return result;
  }

  /**
   * 获取插件可用的附件项列表
   */
  @Public()
  @Get(":pluginId/attachments")
  async getPluginAttachments(@Param("pluginId") pluginId: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const r = resolved.find((x) => x.plugin.id === pluginId);
    if (!r || !r.enabled) return [];
    const result: any[] = [];
    for (const att of r.attachmentTypes) {
      try {
        const items = await att.list();
        result.push({ typeId: att.id, items });
      } catch (err: any) {
        this.logger.error(`Failed to list attachments for ${att.id}: ${err.message}`);
        result.push({ typeId: att.id, items: [] });
      }
    }
    return result;
  }

  // ── UI Pages API ──

  /**
   * 获取所有注册的 UI 页面
   */
  @Public()
  @Get("ui-pages")
  async getUiPages(@Query("area") area?: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const result: Array<{
      id: string;
      area: string;
      group: string;
      tab: string;
      icon: string;
      component: string;
      pluginId: string;
      order: number;
    }> = [];
    for (const r of resolved) {
      if (!r.enabled) continue;
      for (const page of r.uiPages) {
        if (area && page.area !== area) continue;
        result.push({
          id: page.id,
          area: page.area,
          group: page.group,
          tab: page.tab,
          icon: page.icon,
          component: page.component,
          pluginId: r.plugin.id,
          order: page.order || 100,
        });
      }
    }
    return result.sort((a, b) => a.order - b.order);
  }

  /**
   * 获取插件前端组件源码
   */
  @Public()
  @Get(":pluginId/ui/:component")
  async getPluginUiComponent(
    @Param("pluginId") pluginId: string,
    @Param("component") component: string,
    @Res() res: Response,
  ) {
    // 安全校验：component 只能是文件名，不能包含路径分隔符
    if (component.includes("/") || component.includes("\\") || component.includes("..")) {
      return res.status(403).send("Invalid component path");
    }

    const pluginPath = this.externalLoader.getPluginPath(pluginId);
    if (!pluginPath) {
      return res.status(404).send("Plugin directory not found");
    }

    const frontendDir = path.join(pluginPath, "frontend");
    // Try .vue first (dev mode), then .js (precompiled)
    const vuePath = path.join(frontendDir, component.endsWith(".vue") ? component : component + ".vue");
    const jsPath = path.join(frontendDir, "dist", component.endsWith(".js") ? component : component + ".js");

    let filePath: string | null = null;
    let contentType = "text/plain";

    if (fs.existsSync(vuePath)) {
      filePath = vuePath;
      contentType = "text/plain";
    } else if (fs.existsSync(jsPath)) {
      filePath = jsPath;
      contentType = "application/javascript";
    }

    if (!filePath) {
      return res.status(404).send("Component not found");
    }

    // 路径遍历防护
    if (!filePath.startsWith(frontendDir + path.sep) && filePath !== frontendDir && !filePath.startsWith(path.join(frontendDir, "dist") + path.sep)) {
      return res.status(403).send("Access denied");
    }

    return res.type(contentType).sendFile(filePath);
  }
}
