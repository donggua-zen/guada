import { Controller, Get, Post, Put, Body, UseGuards, Logger } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { PluginManager } from "./plugin.manager";

@Controller("plugins")
export class PluginsController {
  private readonly logger = new Logger(PluginsController.name);

  constructor(
    private readonly pluginManager: PluginManager,
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
}
