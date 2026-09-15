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
  Req,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { PluginManager } from "./plugin.manager";
import { ExternalPluginLoader } from "./external/external-plugin-loader";
import { NlsService } from "./i18n/nls.service";
import { SettingsStorage } from "../../common/utils/settings-storage.util";import { PluginRegistry } from "./registry/plugin-registry";
import { RolePluginConfig } from "./types/plugin.types";

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
   * 前端语言（zh-CN/en-US）→ NLS 语言代码（zh/en）
   */
  private toNlsLocale(lang?: string): string {
    return lang === "en-US" || lang === "en" ? "en" : "zh";
  }

  /**
   * 查询插件列表（全局/角色通用）
   * Body: { config?: RolePluginConfig, lang?: string } — 角色层工具包配置（character/session settings.plugins），
   * 不传则仅返回全局状态（不做角色层工具包过滤）。
   */
  @Public()
  @Post("query")
  async queryPlugins(@Body() body: { config?: RolePluginConfig; lang?: string }) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, body?.config, true);
    const nlsLocale = this.toNlsLocale(body?.lang);

    return {
      plugins: resolved
        .filter((r) => r.plugin.category !== "system")
        .map((r) => ({
          pluginId: r.plugin.id,
          effective: r.effective,
          name: r.plugin.id,
          displayName: this.nlsService.resolveString(r.plugin.id, r.plugin.name, nlsLocale),
          description: this.nlsService.resolveString(r.plugin.id, r.plugin.description, nlsLocale),
          category: r.plugin.category,
          enabled: r.enabled,
          icon: r.plugin.icon,
          source: r.source || "builtin",
          version: r.plugin.version,
          author: r.plugin.author,
          tools: r.allTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters as any,
            display: this.nlsService.resolveDisplay(
              r.plugin.id,
              {
                text: t.displayText,
                aggregate: t.displayAggregate,
                argsKey: t.argsKey,
                icon: t.icon,
                renderer: t.displayRenderer,
              },
              nlsLocale,
            ),
          })),
          toolkits: r.enabledToolKits.map((k) => ({
            id: k.id,
            name: this.nlsService.resolveString(r.plugin.id, k.name, nlsLocale),
            description: this.nlsService.resolveString(r.plugin.id, k.description || "", nlsLocale),
            loadMode: k.loadMode,
            enabled: k.enabled,
            toolCount: k.toolCount,
            promptCount: k.promptCount,
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
  async getToolDisplays(@Query("lang") lang?: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const nlsLocale = this.toNlsLocale(lang);
    const result: Record<string, any> = {};

    for (const r of resolved) {
      for (const t of r.allTools) {
    result[t.name] = this.nlsService.resolveDisplay(
      r.plugin.id,
      {
        text: t.displayText,
        aggregate: t.displayAggregate,
        argsKey: t.argsKey,
        icon: t.icon,
        renderer: t.displayRenderer,
      },
      nlsLocale,
    );
      }
    }

    // legacy：remote_read/write/edit/grep/bash 已合并进标准 file/shell 工具
    // （workspace 参数路由），不再注册；此处保留展示映射，
    // 使历史会话中持久化的 remote_* 工具调用块仍按原样渲染。
    // NLS 键保留在 remote-workspace 语言包中；插件未加载时回退原始 %key% 字符串。
    const legacyRemoteTools: Record<
      string,
      { argsKey: string; icon: string; hasAggregate: boolean; renderer?: any }
    > = {
      remote_read: { argsKey: "file_path", icon: "read", hasAggregate: false },
      remote_write: {
        argsKey: "file_path",
        icon: "edit",
        hasAggregate: false,
        renderer: { kind: "content", fields: { file: "file_path", content: "content" } },
      },
      remote_edit: {
        argsKey: "file_path",
        icon: "edit",
        hasAggregate: false,
        renderer: { kind: "diff", fields: { file: "file_path", oldValue: "old_text", newValue: "new_text" } },
      },
      remote_grep: { argsKey: "pattern", icon: "search", hasAggregate: true },
      remote_bash: {
        argsKey: "command",
        icon: "terminal",
        hasAggregate: true,
        renderer: { kind: "terminal", fields: { command: "command" } },
      },
    };
    for (const [name, meta] of Object.entries(legacyRemoteTools)) {
      if (result[name]) continue; // 仍在注册（如回滚/过渡期）时以实际注册为准
      const display: Record<string, any> = {
        text: {
          executing: `%${name}.executing%`,
          completed: `%${name}.completed%`,
        },
        argsKey: meta.argsKey,
        icon: meta.icon,
      };
      if (meta.hasAggregate) {
        display.aggregate = {
          executing: `%${name}.aggregate.executing%`,
          completed: `%${name}.aggregate.completed%`,
        };
      }
      if (meta.renderer) {
        display.renderer = meta.renderer;
      }
      result[name] = this.nlsService.resolveDisplay(
        "remote-workspace",
        display,
        nlsLocale,
      );
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

  /**
   * 从分发源安装外部插件（后台任务，返回 jobId；前端轮询 install-log 显示进度）
   * source: github:owner/repo[#ref] / gitee:owner/repo[#ref] / git:https://...[#ref] / local:path
   */
  @UseGuards(AuthGuard)
  @Post("install")
  async installPlugin(@Body() body: { source: string }) {
    if (!body?.source) throw new BadRequestException("source is required");
    return await this.externalLoader.installPluginJob(body.source);
  }

  /** 查询安装任务日志（假终端轮询） */
  @UseGuards(AuthGuard)
  @Get("install-log/:jobId")
  async getInstallLog(@Param("jobId") jobId: string) {
    const state = await this.externalLoader.getInstallLog(jobId);
    if (!state) throw new NotFoundException("安装任务不存在或已过期");
    return state;
  }

  /** 取消安装任务（窗口关闭/组件卸载时调用） */
  @UseGuards(AuthGuard)
  @Post("install-cancel/:jobId")
  async cancelInstall(@Param("jobId") jobId: string) {
    return await this.externalLoader.cancelInstall(jobId);
  }

  /**
   * 更新已安装的外部插件（git 分发）
   */
  @UseGuards(AuthGuard)
  @Post(":pluginId/update")
  async updatePlugin(@Param("pluginId") pluginId: string) {
    const res = await this.externalLoader.updatePlugin(pluginId);
    return { success: true, ...res };
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

  // ── Slot 注册表 API（v2 插件 UI）──

  /**
   * 获取所有已启用插件的 slot 注册清单（按 slot 名归并，已排序）
   * 同时返回插件主题注册表（themes），前端据此注册可选项
   */
  @Public()
  @Get("slots")
  async getSlots(@Query("lang") lang?: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const nlsLocale = this.toNlsLocale(lang);
    const result: Record<string, Array<Record<string, any>>> = {};
    const themes: Array<Record<string, any>> = [];
    for (const r of resolved) {
      if (!r.enabled) continue;
      const pluginPath = this.externalLoader.getPluginPath(r.plugin.id);
      for (const slot of PluginRegistry.getSlots(r.plugin.id)) {
        if (!result[slot.name]) result[slot.name] = [];
        result[slot.name].push({
          pluginId: r.plugin.id,
          component: slot.component,
          mode: slot.mode || "list",
          order: slot.order ?? 100,
          loadMode: slot.loadMode || "lazy",
          props: slot.props || {},
          meta: slot.meta
            ? {
                label: this.nlsService.resolveString(r.plugin.id, slot.meta.label || "", nlsLocale),
                icon: slot.meta.icon,
                group: slot.meta.group,
              }
            : undefined,
          rev: pluginPath ? this.assetRev(pluginPath) : r.plugin.version || "1.0.0",
        });
      }
      // 插件主题注册表（CSS 走 assets 端点，前端按 baseURL 拼完整 URL）
      for (const theme of PluginRegistry.getThemes(r.plugin.id)) {
        themes.push({
          pluginId: r.plugin.id,
          id: theme.id,
          name: theme.nameKey
            ? this.nlsService.resolveString(r.plugin.id, theme.nameKey, nlsLocale)
            : theme.name,
          primaryColor: theme.primaryColor,
          secondaryColor: theme.secondaryColor,
          mode: theme.mode || "all",
          cssFile: theme.cssFile,
          rev: pluginPath ? this.assetRev(pluginPath) : r.plugin.version || "1.0.0",
        });
      }
    }
    for (const name of Object.keys(result)) {
      result[name].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    return { slots: result, themes };
  }

  /**
   * 插件资产静态服务（slot 组件产物 / 插件主题 CSS / 字体等）
   *
   * 契约（2026-09-02 修订，方案 A）：
   * - 基路径 = 插件扫描时记录的真实目录（getPluginPath），不硬编码 frontend/dist；
   *   assetPath 为「相对插件根」的受约束子路径（如 frontend/dist/x.css、themes/famicom.css）
   * - 安全：解码后的 assetPath 走字符白名单正则——仅 [A-Za-z0-9_-] 与单层 `/`，
   *   不含 `.` / `..` / `\` / 空段 → join 后物理上无法目录穿越；
   *   另加 resolve 后前缀校验作为纵深防御
   * - 扩展名白名单覆盖 css/js/字体/图片，插件可自包含分发资源
   */
  @Public()
  @Get(":pluginId/assets/*")
  async getPluginAsset(
    @Param("pluginId") pluginId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 手动解析 assets/ 之后的路径：NestJS 11 / Express 5 下命名通配
    // （assets/*assetPath）对多段路径捕获异常（@Param 得到 "a,b" 逗号拼接），
    // 故从 originalUrl 截取，绕开路由参数。
    const marker = `/plugins/${pluginId}/assets/`;
    const idx = req.originalUrl.indexOf(marker);
    if (idx < 0) return res.status(404).send("Not found");
    let assetPath: string;
    try {
      assetPath = decodeURIComponent(
        req.originalUrl.slice(idx + marker.length).split("?")[0] || "",
      );
    } catch {
      return res.status(400).send("Bad path encoding");
    }
    // 白名单（解码后执行）：字符集无 '.'，'..' 不可能构造
    if (
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(css|js|mjs|json|woff2|woff|ttf|otf|png|jpg|jpeg|gif|svg|webp)$/.test(
        assetPath,
      )
    ) {
      return res.status(403).send("Invalid asset path");
    }
    const pluginPath = this.externalLoader.getPluginPath(pluginId);
    if (!pluginPath) return res.status(404).send("Plugin directory not found");
    // 基路径 = 扫描记录的真实插件目录；纵深防御：解析后必须仍在插件目录内
    const base = path.resolve(pluginPath);
    const filePath = path.resolve(base, assetPath);
    if (filePath !== base && !filePath.startsWith(base + path.sep)) {
      return res.status(403).send("Access denied");
    }
    if (!fs.existsSync(filePath)) return res.status(404).send("Asset not found");
    // sendFile 异步错误处理：existsSync 通过后仍可能失败（竞态/权限/点目录等），
    // 统一回 404，避免 500 噪音。
    // dotfiles: "allow" —— Express send 默认 ignore 点开头段，会拒绝位于点目录
    //（如用户插件目录 .guada-dev）下的插件资产，必须放行。
    return res
      .type(this.assetContentType(assetPath))
      .sendFile(filePath, { dotfiles: "allow" }, (err) => {
        if (err && !res.headersSent) {
          const status = (err as any).status || ((err as any).code === "ENOENT" ? 404 : undefined);
          if (status === 404) {
            res.status(404).send("Asset not found");
          } else {
            this.logger.error(`sendFile failed: ${filePath}: ${err.message}`);
            res.status(500).send("Asset read failed");
          }
        }
      });
  }

  /** 按扩展名映射 Content-Type */
  private assetContentType(file: string): string {
    const ext = file.slice(file.lastIndexOf("."));
    const map: Record<string, string> = {
      ".css": "text/css",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".json": "application/json",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    };
    return map[ext] || "application/octet-stream";
  }

  /**
   * 插件 RPC：插件 UI 调用插件后端的业务方法
   * Body: { args?: any, sessionId?, workspaceId? }
   */
  @UseGuards(AuthGuard)
  @Post(":pluginId/rpc/:method")
  async callPluginRpc(
    @Param("pluginId") pluginId: string,
    @Param("method") method: string,
    @Body() body: { args?: any; sessionId?: string; workspaceId?: string },
    @Req() req: any,
  ) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(method)) {
      throw new BadRequestException("Invalid rpc method name");
    }
    const handler = PluginRegistry.getRpcHandler(pluginId, method);
    if (!handler) {
      throw new BadRequestException(`rpc method ${pluginId}.${method} not found`);
    }
    try {
      return await handler(body?.args, {
        sessionId: body?.sessionId,
        workspaceId: body?.workspaceId,
      });
    } catch (e: any) {
      this.logger.error(`Plugin rpc ${pluginId}.${method} failed: ${e.message}`);
      throw new BadRequestException(e.message || "rpc failed");
    }
  }

  /**
   * 插件产物 rev：递归取插件目录最新文件 mtime（变化时前端重新加载）。
   * 覆盖 frontend/dist（slot 产物）与 themes/（主题 CSS/字体）等全部资源目录。
   */
  private assetRev(pluginPath: string): string {
    try {
      let latest = 0;
      const walk = (dir: string): void => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) {
            walk(p);
          } else {
            const st = fs.statSync(p);
            if (st.mtimeMs > latest) latest = st.mtimeMs;
          }
        }
      };
      if (fs.existsSync(pluginPath)) walk(pluginPath);
      return latest ? Math.round(latest).toString(36) : "";
    } catch {
      return "";
    }
  }

  // ── Attachment Types API ──

  /**
   * 获取所有注册的附件类型
   */
  @Public()
  @Get("attachment-types")
  async getAttachmentTypes(@Query("lang") lang?: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const nlsLocale = this.toNlsLocale(lang);
    const result: Array<{ id: string; label: string; icon: string; pluginId: string }> = [];
    for (const r of resolved) {
      if (!r.enabled) continue;
      for (const att of r.attachmentTypes) {
        result.push({
          id: att.id,
          label: this.nlsService.resolveString(r.plugin.id, att.label, nlsLocale),
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
  async getUiPages(@Query("area") area?: string, @Query("lang") lang?: string) {
    const resolved = await this.pluginManager.resolvePlugins(undefined, undefined, true);
    const nlsLocale = this.toNlsLocale(lang);
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
          group: this.nlsService.resolveString(r.plugin.id, page.group, nlsLocale),
          tab: this.nlsService.resolveString(r.plugin.id, page.tab, nlsLocale),
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
