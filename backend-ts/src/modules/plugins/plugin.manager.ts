import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "./base-plugin";
import { PluginRegistry } from "./registry/plugin-registry";
import {
  PluginContext,
  ToolHandlerDef,
  PluginManifest,
  GlobalPluginConfig,
  GlobalPluginEntryConfig,
  RolePluginConfig,
  RolePluginEntryConfig,
  ToolKitLoadMode,
  ResolvedPluginInfo,
} from "./types/plugin.types";
import { PluginApiImpl } from "./api/plugin-api";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { EventBusService } from "../../common/events/event-bus.service";
import { SG_PLUGINS } from "../../constants/settings.constants";
import { PromptCollector } from "./prompt-collector.service";
import { ISessionContext } from "../chat/session-context";
import { CommandProviderRegistry } from "../commands/command-provider-registry.service";
import { NlsService } from "./i18n/nls.service";

// ──

/** 单个插件在决议过程中的中间状态（resolvePlugins 内部使用） */
type PluginResolutionState = {
  manifest: PluginManifest;
  /** 全局层结果（system/core/essential 默认启用） */
  enabled: boolean;
  /** 启停来源："default"=按 category 默认值 / "global"=全局层禁用 */
  effective: "default" | "global";
  /** 被角色层裁剪的工具包 ID 集合 */
  deniedToolkits: Set<string>;
};

export interface PluginInstance {
  plugin: PluginBase;
  manifest: PluginManifest;
  /** 启用状态（受全局和插件自身状态影响） */
  enabled: boolean;
  /** 插件来源 */
  source?: "builtin" | "dev" | "user";
  /** 插件目录绝对路径（仅外部插件） */
  pluginPath?: string;
}

/**
 * 插件管理器
 *
 * 职责：
 * 1. 管理插件的加载/卸载/启用/禁用生命周期
 * 2. 两层开关决议：全局层控插件启停，角色层只裁剪工具包（能力包）
 * 3. 聚合所有插件的工具定义和提示词
 */
@Injectable()
export class PluginManager {
  private readonly logger = new Logger(PluginManager.name);
  private instances = new Map<string, PluginInstance>();

  constructor(
    private readonly settingsStorage: SettingsStorage,
    private readonly promptCollector: PromptCollector,
    private readonly commandRegistry: CommandProviderRegistry,
    private readonly nlsService: NlsService,
    private readonly eventBus: EventBusService,
  ) {}

  // ── 生命周期 ──

  /**
   * 注册并加载一个插件实例
   */
  async registerPlugin(plugin: PluginBase, enabled?: boolean): Promise<void> {
    const id = plugin.manifest.id;
    if (this.instances.has(id)) {
      this.logger.warn(`Plugin ${id} already registered, skipping`);
      return;
    }

    // 从全局配置读取启用状态（与全局层决议 resolveGlobalLayer 共用同一解析逻辑）
    let finalEnabled: boolean;
    if (enabled !== undefined) {
      finalEnabled = enabled;
    } else {
      try {
        const globalCfg: GlobalPluginConfig =
          await this.settingsStorage.getSettings(SG_PLUGINS);
        finalEnabled = this.readGlobalEnabled(globalCfg, plugin.manifest);
      } catch {
        finalEnabled = plugin.manifest.category === "core";
      }
    }

    // 创建 api 并调用 onLoad
    const api = new PluginApiImpl(
      id,
      plugin.manifest.name,
      this.nlsService,
      this.settingsStorage,
      plugin.manifest.source,
    );
    if (plugin.onLoad) {
      await plugin.onLoad(api).catch((err) => {
        this.logger.error(`Plugin ${id} onLoad failed: ${err.message}`);
      });
    }

    // 执行 ToolKit onLoad 回调（支持二级注册）
    for (const tk of api["_toolKits"] || []) {
      if (tk.def.onLoad) {
        try {
          await tk.def.onLoad(tk);
        } catch (err: any) {
          this.logger.error(`ToolKit ${tk.id} onLoad failed: ${err.message}`);
        }
      }
    }

    api.flush();

    // 启用时调用 onStart
    if (finalEnabled && plugin.onStart) {
      await plugin.onStart().catch((err) => {
        this.logger.error(`Plugin ${id} onStart failed: ${err.message}`);
      });
    }

    const instance: PluginInstance = {
      plugin,
      manifest: plugin.manifest,
      enabled: finalEnabled,
      source: plugin.manifest.source || "builtin",
      pluginPath: plugin.manifest.pluginPath,
    };
    // 同步插件实例启用态（钩子监听器如 turn.stopping 据此自检门控）
    plugin._enabled = finalEnabled;
    this.instances.set(id, instance);

    this.logger.log(
      `Plugin registered: ${plugin.manifest.name} (${id}), tools=${PluginRegistry.getTools(id).length}, kits=${PluginRegistry.getToolKits(id).length}, enabled=${finalEnabled}`,
    );

    // 注册命令提供者
    const cmdProviders = api.getCommandProviders();
    for (const cp of cmdProviders) {
      this.commandRegistry.register(cp);
    }

    // 插件集合变化 → 通知前端刷新 slot 清单
    this.eventBus.emit("plugins.changed", { pluginId: id, action: "registered" });
  }

  /**
   * 卸载插件
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) return;

    if (instance.enabled && instance.plugin.onStop) {
      await instance.plugin.onStop().catch((err) => {
        this.logger.error(`Plugin ${pluginId} onStop failed: ${err.message}`);
      });
    }

    if (instance.plugin.onUnload) {
      await instance.plugin.onUnload().catch((err) => {
        this.logger.error(`Plugin ${pluginId} onUnload failed: ${err.message}`);
      });
    }
    PluginRegistry.clearPlugin(pluginId);
    this.instances.delete(pluginId);
    this.logger.log(`Plugin unregistered: ${pluginId}`);
    this.eventBus.emit("plugins.changed", { pluginId, action: "unregistered" });
  }

  /**
   * 重新加载插件
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      this.logger.warn(`Plugin ${pluginId} not found, cannot reload`);
      return;
    }

    const plugin = instance.plugin;
    const wasEnabled = instance.enabled;

    await this.unregisterPlugin(pluginId);
    await this.registerPlugin(plugin, wasEnabled);

    this.logger.log(`Plugin reloaded: ${pluginId}, enabled=${wasEnabled}`);
  }

  /**
   * 启用/禁用插件
   */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) return;

    if (
      (instance.manifest.category === "system" ||
        instance.manifest.essential) &&
      !enabled
    ) {
      this.logger.warn(`Cannot disable system plugin: ${pluginId}`);
      return;
    }

    try {
      await this.settingsStorage.updateSettings(SG_PLUGINS, {
        [pluginId]: { enabled },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist plugin state for ${pluginId}: ${err}`,
      );
    }

    if (enabled && !instance.enabled) {
      if (instance.plugin.onStart) {
        await instance.plugin.onStart().catch((err) => {
          this.logger.error(
            `Plugin ${pluginId} onStart failed: ${err.message}`,
          );
        });
      }
      instance.enabled = true;
      instance.plugin._enabled = true;
      this.logger.log(`Plugin ${pluginId} enabled`);
    } else if (!enabled && instance.enabled) {
      if (instance.plugin.onStop) {
        await instance.plugin.onStop().catch((err) => {
          this.logger.error(`Plugin ${pluginId} onStop failed: ${err.message}`);
        });
      }
      instance.enabled = false;
      instance.plugin._enabled = false;
      this.logger.log(`Plugin ${pluginId} disabled`);
    }

    // 插件启停状态变化 → 通知前端刷新 slot 清单
    this.eventBus.emit("plugins.changed", { pluginId, action: enabled ? "enabled" : "disabled" });
  }

  // ── 工具聚合 ──

  /** 检查插件是否已全局启用 */
  isPluginEnabled(pluginId: string): boolean {
    const inst = this.instances.get(pluginId);
    if (!inst) return false;
    if (inst.manifest.category === "system" || inst.manifest.essential)
      return true;
    return inst.enabled;
  }

  private isPluginAvailable(id: string): boolean {
    return this.isPluginEnabled(id);
  }

  /**
   * 获取所有已启用插件的工具定义
   */
  async getTools(
    context?: PluginContext,
    enabledPlugins?: string[],
  ): Promise<Array<{ pluginId: string; tools: ToolHandlerDef[] }>> {
    const result: Array<{ pluginId: string; tools: ToolHandlerDef[] }> = [];
    for (const [id, instance] of this.instances) {
      if (enabledPlugins && !enabledPlugins.includes(id)) continue;
      if (!this.isPluginAvailable(id)) continue;

      let tools = PluginRegistry.getTools(id);

      if (tools.length > 0) {
        result.push({ pluginId: id, tools });
      }
    }
    return result;
  }

  /** 获取指定插件的工具定义（仅用于前端列表展示） */
  getPluginTools(pluginId: string): ToolHandlerDef[] {
    return PluginRegistry.getTools(pluginId);
  }

  /**
   * 获取所有懒加载 ToolKit/ToolSet 的激活词
   */
  async getToolActivators(
    resolved: ResolvedPluginInfo[],
  ): Promise<Array<{ name: string; activator: string }>> {
    const activators: Array<{ name: string; activator: string }> = [];

    for (const rp of resolved) {
      if (!rp.enabled) continue;

      // 从 ToolKit 收集
      for (const tk of rp.enabledToolKits) {
        if (!tk.enabled) continue;
        if (tk.loadMode !== "lazy") continue;
        activators.push({
          name: tk.id,
          activator: tk.activator || `${rp.plugin.name} 工具包`,
        });
      }
    }

    return activators;
  }

  // ── 查询 ──

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId);
  }

  /** 获取插件来源 */
  getPluginSource(pluginId: string): "builtin" | "dev" | "user" | undefined {
    return this.instances.get(pluginId)?.source;
  }

  // ==================== 统一决议层 ====================

  /**
   * 统一决议（V3）：给定上下文，返回所有插件的启用状态 + 可用工具 + 工具包信息
   *
   * 两层开关语义（配置与解析已彻底分离）：
   * - 全局层（GlobalPluginConfig，持久化于 SG_PLUGINS/plugins_config）：
   *   仅控制插件级启停（entry.enabled），由 resolveGlobalLayer 独立解析；
   *   enabled=true 与 enabled=false 均生效（默认关闭的 user/extended 插件可被显式启用）
   * - 角色层（RolePluginConfig，即 character/session settings.plugins）：
   *   仅裁剪工具包（toolkits_filter/deny/allow），由 applyRoleLayer 独立消费；
   *   不消费 entry.enabled，旧角色数据中的插件级开关被直接忽略
   * - 二级过滤：全局关闭的插件其工具包对角色层不可见——applyRoleLayer
   *   直接跳过未启用插件，角色层对它们的 allow/deny 均不生效
   *
   * 这是 PluginManager 对外唯一决议入口。
   * ToolExecutor / PromptCollector 等消费方通过 ResolvedPluginInfo 使用结果。
   */
  async resolvePlugins(
    session?: ISessionContext,
    roleCfg?: RolePluginConfig,
    skipHandler = false,
  ): Promise<ResolvedPluginInfo[]> {
    // 全局层 → 角色层：两个配置各自独立解析，互不耦合
    const stateMap = await this.resolveGlobalLayer();
    this.applyRoleLayer(stateMap, roleCfg);

    const result: ResolvedPluginInfo[] = [];
    for (const [, state] of stateMap) {
      result.push(
        await this.buildPluginResult(state, skipHandler, session, roleCfg),
      );
    }
    return result;
  }

  /**
   * 从全局配置读取单个插件的启停状态（registerPlugin 与 resolveGlobalLayer 共用，
   * 保证启动装载与运行时决议对同一份持久化配置的解读一致）
   *
   * 兼容两种持久化形态：
   * - 旧格式：布尔直存（true/false）
   * - 新格式：{ enabled: boolean }
   */
  private readGlobalEnabled(
    globalCfg: GlobalPluginConfig,
    manifest: PluginManifest,
  ): boolean {
    if (manifest.essential || manifest.category === "system") return true;
    // 持久化可能是遗留的布尔直存或新格式对象，先按 unknown 收窄再判断
    const pluginVal: unknown = globalCfg[manifest.id];
    if (pluginVal === true || pluginVal === false) {
      return pluginVal;
    }
    if (pluginVal && typeof pluginVal === "object" && "enabled" in pluginVal) {
      return (pluginVal as GlobalPluginEntryConfig).enabled !== false;
    }
    return manifest.category === "core";
  }

  /**
   * 全局层决议：只读 SG_PLUGINS（plugins_config），决定每个插件的启停。
   * 不消费任何角色配置；显式配置过的插件标记 effective='global'。
   */
  private async resolveGlobalLayer(): Promise<
    Map<string, PluginResolutionState>
  > {
    const rawGlobal = await this.settingsStorage.getSettings(SG_PLUGINS);
    // 只读拷贝：不变异持久化的全局配置
    const globalCfg: GlobalPluginConfig = { ...(rawGlobal || {}) };

    const stateMap = new Map<string, PluginResolutionState>();
    for (const [id, instance] of this.instances) {
      const isEssential = instance.manifest.essential === true;
      stateMap.set(id, {
        manifest: instance.manifest,
        enabled: this.readGlobalEnabled(globalCfg, instance.manifest),
        // 显式写入过全局配置的插件标记为全局层决策；essential 恒为默认
        effective:
          !isEssential && globalCfg[id] !== undefined ? "global" : "default",
        deniedToolkits: new Set(),
      });
    }
    return stateMap;
  }

  /**
   * 角色层决议：只消费角色配置（character/session settings.plugins），
   * 在全局已启用的插件范围内裁剪工具包，不触碰插件启停。
   *
   * - __strategy="deny_nonsystem"：拒绝所有非受保护插件的全部工具包（"全部禁用"）
   * - __default=false：白名单模式（未显式允许的工具包默认拒绝）
   * - 全局关闭的插件直接跳过——角色层对它们的 allow/deny 均不生效（二级过滤）
   * - essential 插件的工具包不可被任何方式拒绝（如 universal_tools 的 lazy_tools 元能力）；
   *   system 分类插件（mcp/skill/sub_agent）的插件本体不可禁用，但工具包可按角色裁剪
   * - 角色层条目中遗留的 enabled 字段被显式忽略（角色层不再控制插件启停）
   */
  private applyRoleLayer(
    stateMap: Map<string, PluginResolutionState>,
    roleCfg: RolePluginConfig | undefined,
  ): void {
    if (!roleCfg) return;

    const denyAllKits = roleCfg.__strategy === "deny_nonsystem";
    const roleDefault = roleCfg.__default ?? true;

    for (const [id, state] of stateMap) {
      if (!state.enabled) continue; // 全局已禁用 → 没有可裁剪的能力
      if (state.manifest.essential) continue; // 受保护插件，工具包不可裁剪

      const kits = PluginRegistry.getToolKits(id);
      if (kits.length === 0) continue;

      const denyAllOfPlugin = () => {
        for (const k of kits) state.deniedToolkits.add(k.def.id);
      };

      if (denyAllKits) {
        denyAllOfPlugin();
        continue;
      }

      const entry = roleCfg[id];
      if (!entry || typeof entry !== "object") {
        // 白名单模式下未显式配置的插件 → 全部工具包默认拒绝
        if (!roleDefault) denyAllOfPlugin();
        continue;
      }

      const e = entry as RolePluginEntryConfig;
      if (e.toolkits_filter === "deny_all") {
        // 全部禁用：压过两个列表（列表原样保留在配置里，供解除时恢复）
        denyAllOfPlugin();
      } else if (e.toolkits_filter === "allow") {
        // 白名单：先全拒，再放行显式允许的
        denyAllOfPlugin();
        for (const a of e.toolkits_allow || []) {
          state.deniedToolkits.delete(a);
        }
      } else {
        // 黑名单（默认）：累加拒绝列表
        for (const d of e.toolkits_deny || []) {
          state.deniedToolkits.add(d);
        }
      }
    }
  }

  /**
   * 根据插件状态构建 ResolvedPluginInfo
   *
   * enabledToolKits 返回全部工具包：被角色层裁剪的以 enabled=false 标记，
   * 且不解析其 handler（loadMode/activator 取注册默认值），其工具与提示词
   * 均不进入运行时。
   */
  private async buildPluginResult(
    state: PluginResolutionState,
    skipHandler: boolean,
    session?: ISessionContext,
    roleCfg?: RolePluginConfig,
  ): Promise<ResolvedPluginInfo> {
    const manifest = state.manifest;
    const allTools = [
      ...PluginRegistry.getTools(manifest.id),
      ...PluginRegistry.getToolKits(manifest.id).flatMap((k) => k.tools),
    ];

    if (!state.enabled) {
      return {
        enabled: false,
        effective: state.effective,
        plugin: manifest,
        enabledTools: [],
        allTools,
        enabledToolKits: PluginRegistry.getToolKits(manifest.id).map((k) => ({
          id: k.def.id,
          name: k.def.name || k.def.id,
          description: k.def.description,
          loadMode: k.def.loadMode || "eager",
          activator: k.def.activator,
          enabled: false,
          toolCount: k.tools.length,
          promptCount: k.prompts.length,
        })),
        workspaceProviders: PluginRegistry.getWorkspaceProviders(manifest.id),        attachmentTypes: PluginRegistry.getAttachmentTypes(manifest.id),
        uiPages: PluginRegistry.getUiPages(manifest.id),
        source: manifest.source,
        pluginPath: manifest.pluginPath,
      };
    }

    const enabledTools: ToolHandlerDef[] = [
      ...PluginRegistry.getTools(manifest.id),
    ];
    const enabledToolKits: ResolvedPluginInfo["enabledToolKits"] = [];

    for (const kitReg of PluginRegistry.getToolKits(manifest.id)) {
      // 自治理工具包不参与角色层过滤：applyRoleLayer 写入的 deniedToolkits 对其无效。
      // 这是 handler 必然被执行的前提——被 deny 的工具包会跳过 handler 直接取静态默认值。
      const isSelfGoverned = kitReg.def.governance === "self";
      const denied =
        !isSelfGoverned && state.deniedToolkits.has(kitReg.def.id);
      let loadMode: ToolKitLoadMode = kitReg.def.loadMode || "eager";
      let activator = kitReg.def.activator;

      if (!denied) {
        try {
          if (kitReg.def.handler && !skipHandler && session) {
            const runtime = await kitReg.def.handler({
              session,
              pluginsConfig: roleCfg,
            } as PluginContext);
            if (runtime) {
              loadMode = (runtime.loadMode as ToolKitLoadMode) ?? loadMode;
              activator = runtime.activator ?? activator;
            }
          }
        } catch {}

        // eager 工具包的工具直接进入启用列表
        if (loadMode === "eager") {
          enabledTools.push(...kitReg.tools);
        }
      }

      enabledToolKits.push({
        id: kitReg.def.id,
        name: kitReg.def.name || kitReg.def.id,
        description: kitReg.def.description,
        loadMode,
        activator,
        enabled: !denied,
        toolCount: kitReg.tools.length,
        promptCount: kitReg.prompts.length,
      });
    }

    return {
      enabled: true,
      effective: state.effective,
      plugin: manifest,
      enabledTools,
      allTools,
      enabledToolKits,
      workspaceProviders: PluginRegistry.getWorkspaceProviders(manifest.id),
      attachmentTypes: PluginRegistry.getAttachmentTypes(manifest.id),
      uiPages: PluginRegistry.getUiPages(manifest.id),
      source: manifest.source,
      pluginPath: manifest.pluginPath,
    };
  }
}
