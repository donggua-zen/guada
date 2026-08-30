import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "./base-plugin";
import { PluginRegistry } from "./registry/plugin-registry";
import {
  PromptPiece,
  PluginContext,
  ToolHandlerDef,
  PluginManifest,
  ToolLoadMode,
  PluginConfig,
  PluginEntryConfig,
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

// ── 新 registerTools API 类型 ──

export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  action?: string;
  argsKey?: string;
  icon?: string;
  execute: (
    args: any,
    ctx?: PluginContext,
    signal?: AbortSignal,
  ) => string | Promise<string>;
}

export interface PromptDef {
  content: string | ((ctx: PluginContext) => string);
  frequency?: "STATIC" | "REGULAR" | "VOLATILE";
  description?: string;
}

export interface ToolPluginDef {
  id: string;
  name: string;
  description: string;
  category?: "core" | "extended" | "user";
  tools: ToolDef[];
  prompts?: PromptDef[];
}

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

    // 从全局配置读取启用状态
    let finalEnabled: boolean;
    if (enabled !== undefined) {
      finalEnabled = enabled;
    } else if (plugin.manifest.category === "system") {
      finalEnabled = true;
    } else {
      try {
        const globalCfg = await this.settingsStorage.getSettings(SG_PLUGINS);
        const pluginVal = globalCfg[id];
        if (pluginVal === true || pluginVal === false) {
          finalEnabled = pluginVal;
        } else if (
          pluginVal &&
          typeof pluginVal === "object" &&
          "enabled" in pluginVal
        ) {
          finalEnabled = pluginVal.enabled !== false;
        } else {
          finalEnabled = plugin.manifest.category === "core";
        }
      } catch {
        finalEnabled = plugin.manifest.category === "core";
      }
    }

    // 创建 api 并调用 onLoad
    const api = new PluginApiImpl(id, plugin.manifest.name, this.nlsService, this.settingsStorage);
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
   * 以纯对象方式注册工具插件
   */
  async registerTools(def: ToolPluginDef): Promise<void> {
    const id = def.id;
    if (this.instances.has(id)) {
      this.logger.warn(`Plugin ${id} already registered, skipping`);
      return;
    }

    const manifest: PluginManifest = {
      id,
      name: def.name,
      description: def.description,
      version: "1.0.0",
      category: def.category || "core",
    };

    if (!PluginRegistry.has(id)) {
      PluginRegistry.registerManifest(manifest);
    }

    const toolDefs: ToolHandlerDef[] = def.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: (() => {
          const props: Record<string, any> = {};
          for (const [key, val] of Object.entries(t.parameters || {})) {
            const { required: _r, ...rest } = val as any;
            props[key] = rest;
          }
          return props;
        })(),
        required: (() => {
          const r = Object.entries(t.parameters || {})
            .filter(([_, v]) => (v as any).required !== false)
            .map(([k]) => k);
          return r.length > 0 ? r : undefined;
        })(),
      },
      handler: (args, ctx, signal) => t.execute(args, ctx, signal),
      toolSet: "__plugin_level",
      action: t.action,
      argsKey: t.argsKey,
      icon: t.icon,
    }));

    const reg = (PluginRegistry as any).registrations.get(id);
    if (reg) {
      for (const td of toolDefs) {
        if (!reg.tools.find((x: any) => x.name === td.name)) {
          reg.tools.push(td);
        }
      }
    }

    const promptMetas: any[] = (def.prompts || []).map((p) => ({
      methodName: "",
      frequency: p.frequency || "REGULAR",
      loadMode: "eager",
      description: p.description || "",
      handler:
        typeof p.content === "function" ? p.content : async () => p.content,
    }));

    const instance: PluginInstance = {
      plugin: {
        manifest,
        _enabled: true,
        getPrompts: async (ctx: PluginContext) => {
          const pieces: PromptPiece[] = [];
          for (const p of promptMetas) {
            try {
              const content = await p.handler(ctx);
              if (content)
                pieces.push({
                  content,
                  frequency: p.frequency,
                  loadMode: "eager",
                  pluginId: id,
                  description: p.description,
                });
            } catch {}
          }
          return pieces;
        },
      } as any,
      manifest,
      enabled: true,
    };

    this.instances.set(id, instance);
    this.logger.log(
      `Plugin registered (tools): ${def.name} (${id}), tools=${toolDefs.length}`,
    );
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
   * 两层开关语义：
   * - 全局层（SG_PLUGINS 持久化配置）：仅控制插件级启停（entry.enabled），
   *   决定装载与生命周期，工具包过滤不属于全局层
   * - 角色层（pluginsConfig，即 character/session settings.plugins）：
   *   仅裁剪工具包（toolkits_filter/deny/allow），不消费 entry.enabled；
   *   插件只是能力集合的命名空间，旧角色数据中的插件级开关被直接忽略
   *
   * 这是 PluginManager 对外唯一决议入口。
   * ToolExecutor / PromptCollector 等消费方通过 ResolvedPluginInfo 使用结果。
   */
  async resolvePlugins(
    session?: ISessionContext,
    pluginsConfig?: PluginConfig,
    skipHandler = false,
  ): Promise<ResolvedPluginInfo[]> {
    const rawGlobal = await this.settingsStorage.getSettings(SG_PLUGINS);
    // 只读拷贝：不变异持久化的全局配置，也不变异调用方传入的角色配置对象
    const globalCfg: Record<string, unknown> = { ...(rawGlobal || {}) };
    const roleCfg: PluginConfig = { ...(pluginsConfig || {}) };

    const stateMap = new Map<string, PluginResolutionState>();

    // 1. 初始化全部插件的默认状态（按 category/essential 决定默认启用）
    for (const [id, instance] of this.instances) {
      const defaultEnabled =
        instance.manifest.category === "system" ||
        instance.manifest.category === "core" ||
        instance.manifest.essential === true;
      stateMap.set(id, {
        manifest: instance.manifest,
        enabled: defaultEnabled,
        effective: "default",
        deniedToolkits: new Set(),
      });
    }

    // 2. 全局层：仅读 entry.enabled 决定插件启停
    for (const [id, state] of stateMap) {
      if (state.manifest.essential) continue;
      const entry = globalCfg[id];
      if (entry && typeof entry === "object" && (entry as PluginEntryConfig).enabled === false) {
        state.enabled = false;
        state.effective = "global";
      }
    }

    // 3. 角色层：只裁剪工具包，不影响插件启停
    //    - __strategy="deny_nonsystem"：拒绝所有非受保护插件的全部工具包（"全部禁用"）
    //    - __default=false：白名单模式（未显式允许的工具包默认拒绝）
    //    - essential 插件的工具包不可被任何方式拒绝（如 universal_tools 的 lazy_tools 元能力）；
    //      system 分类插件（mcp/skill/sub_agent）的插件本体不可禁用，但工具包可按角色裁剪
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

      const e = entry as PluginEntryConfig;
      if ((e.toolkits_filter ?? "deny") === "allow") {
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

    // 4. 构建最终结果
    const result: ResolvedPluginInfo[] = [];
    for (const [, state] of stateMap) {
      result.push(await this.buildPluginResult(state, skipHandler, session));
    }
    return result;
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
      const denied = state.deniedToolkits.has(kitReg.def.id);
      let loadMode: ToolLoadMode = kitReg.def.loadMode || "eager";
      let activator = kitReg.def.activator;

      if (!denied) {
        try {
          if (kitReg.def.handler && !skipHandler && session) {
            const runtime = await kitReg.def.handler({
              session,
            } as PluginContext);
            if (runtime) {
              loadMode = (runtime.loadMode as ToolLoadMode) ?? loadMode;
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

  /** 获取所有已注册的工具包（供外部汇总） */
  getPluginToolKits(
    pluginId: string,
  ): Array<{ id: string; name: string; loadMode: ToolKitLoadMode }> {
    return PluginRegistry.getToolKits(pluginId).map((k) => ({
      id: k.def.id,
      name: k.def.name || k.def.id,
      loadMode: k.def.loadMode || "lazy",
    }));
  }
}
