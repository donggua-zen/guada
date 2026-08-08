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
  ToolKitLoadMode,
  ResolvedPluginInfo,
} from "./types/plugin.types";
import { PluginApiImpl } from "./api/plugin-api";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SG_PLUGINS } from "../../constants/settings.constants";
import { PromptCollector } from "./prompt-collector.service";
import { ISessionContext } from "../chat/session-context";
import { CommandProviderRegistry } from "../commands/command-provider-registry.service";

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
 * 2. 统一配置解析（全局→角色两级合并）
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
    const api = new PluginApiImpl(id, plugin.manifest.name);
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
    this.instances.set(id, instance);

    this.logger.log(
      `Plugin registered: ${plugin.manifest.name} (${id}), tools=${PluginRegistry.getTools(id).length}, kits=${PluginRegistry.getToolKits(id).length}, enabled=${finalEnabled}`,
    );

    // 注册命令提供者
    const cmdProviders = api.getCommandProviders();
    for (const cp of cmdProviders) {
      this.commandRegistry.register(cp);
    }
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
      this.logger.log(`Plugin ${pluginId} enabled`);
    } else if (!enabled && instance.enabled) {
      if (instance.plugin.onStop) {
        await instance.plugin.onStop().catch((err) => {
          this.logger.error(`Plugin ${pluginId} onStop failed: ${err.message}`);
        });
      }
      instance.enabled = false;
      this.logger.log(`Plugin ${pluginId} disabled`);
    }
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

  async getAllPlugins(
    includeDisabled?: boolean,
    roleCfg?: any,
  ): Promise<PluginInstance[]> {
    throw new Error("Method is deprecated.");
  }

  // ==================== 统一决议层 ====================

  /**
   * 统一决议：给定上下文，返回所有插件的启用状态 + 可用工具 + 工具包信息
   *
   * 这是 PluginManager 对外唯一决议入口。
   * - ToolOrchestrator / ToolExecutor 调用后直接按结果构建运行时
   * - PromptCollector 复用此结果
   */
  // async resolvePlugins(
  //   session?: ISessionContext,
  //   pluginsConfig?: any,
  //   skipHandler = false,
  // ): Promise<ResolvedPluginInfo[]> {
  //   const rawGlobal = await this.settingsStorage.getSettings(SG_PLUGINS);
  //   const globalCfg = PluginConfigParser.normalize(rawGlobal);

  //   // 读取策略，默认 custom
  //   const strategy = pluginsConfig?.__strategy || "custom";
  //   const { __strategy: _, ...cleanCfg } = pluginsConfig || {};
  //   const denyAll = strategy === "deny_nonsystem";
  //   const roleCfg =
  //     strategy === "inherit" ? {} : PluginConfigParser.normalize(cleanCfg);

  //   const merged = PluginConfigParser.merge(globalCfg, roleCfg);

  //   // __deny: "none-system" 覆盖：所有非 system 插件强制禁用
  //   if (denyAll) {
  //     for (const [id, instance] of this.instances) {
  //       if (instance.manifest.category !== "system") {
  //         merged[id] = { ...merged[id], enabled: false };
  //       }
  //     }
  //   }

  //   const result: ResolvedPluginInfo[] = [];

  //   for (const [id, instance] of this.instances) {
  //     const manifest = instance.manifest;
  //     const entry = merged[id];

  //     // 1. 解析 enabled 状态
  //     // system/core 插件默认启用，其他按 category
  //     const defaultEnabled =
  //       manifest.category === "system" || manifest.category === "core";
  //     const enabled = PluginConfigParser.isEnabled(entry, defaultEnabled);

  //     // 计算 effective：谁导致了这个状态
  //     const globalDisabled = globalCfg[id]?.enabled === false;
  //     const effective: "global" | "role" =
  //       !enabled && (globalDisabled || !defaultEnabled) ? "global" : "role";

  //     if (!enabled) {
  //       result.push({
  //         enabled: false,
  //         effective,
  //         plugin: manifest,
  //         enabledTools: [],
  //         allTools: PluginRegistry.getTools(id),
  //         toolKits: [],
  //         deniedToolKits: { global: [], role: [] },
  //       });
  //       continue;
  //     }

  //     const tools = PluginRegistry.getTools(id);
  //     // 合并工具包内的工具（供前端展示所有工具用）
  //     const allTools = [
  //       ...tools,
  //       ...PluginRegistry.getToolKits(id).flatMap((k) => k.tools),
  //     ];

  //     // 2. 解析 toolkits deny 过滤（分来源）
  //     const toolkitsDenyGlobal: string[] = PluginConfigParser.getToolkitsFilter(
  //       globalCfg[id],
  //     )
  //       ? (entry as any).toolkits_deny_global || []
  //       : [];
  //     const toolkitsDenyRole: string[] = PluginConfigParser.getToolkitsFilter(
  //       merged[id],
  //     )
  //       ? (entry as any).toolkits_deny_role || []
  //       : [];
  //     const deniedToolKits = {
  //       global: toolkitsDenyGlobal,
  //       role: toolkitsDenyRole,
  //     };
  //     const effectiveDenied = new Set([
  //       ...toolkitsDenyGlobal,
  //       ...toolkitsDenyRole,
  //     ]);

  //     // 3. 初始化 enabledTools（plugin级工具，工具包工具在下方循环中追加）
  //     const enabledTools = [...tools];

  //     // 4. 解析 ToolKit 运行时信息，eager 工具包的工具追加到 enabledTools
  //     const kitRegs = PluginRegistry.getToolKits(id);
  //     const resolvedToolKits: Array<{
  //       id: string;
  //       name: string;
  //       loadMode: ToolLoadMode;
  //       activator?: string;
  //       enabled: boolean;
  //     }> = [];
  //     for (const kitReg of kitRegs) {
  //       const kitEnabled = !effectiveDenied.has(kitReg.def.id);
  //       if (!kitEnabled) continue;

  //       let loadMode: ToolLoadMode = kitReg.def.loadMode || "eager";
  //       let activator = kitReg.def.activator;
  //       try {
  //         if (kitReg.def.handler && !skipHandler && session) {
  //           const runtime = await kitReg.def.handler({
  //             session,
  //           } as PluginContext);
  //           if (runtime) {
  //             loadMode = (runtime.loadMode as ToolLoadMode) ?? loadMode;
  //             activator = runtime.activator ?? activator;
  //           }
  //         }
  //       } catch {}
  //       resolvedToolKits.push({
  //         id: kitReg.def.id,
  //         name: kitReg.def.name || kitReg.def.id,
  //         loadMode,
  //         activator,
  //         enabled: true,
  //       });

  //       // eager 工具包的工具直接追加到启用列表
  //       if (loadMode === "eager") {
  //         enabledTools.push(...kitReg.tools);
  //       }
  //     }

  //     result.push({
  //       enabled,
  //       effective,
  //       plugin: manifest,
  //       enabledTools,
  //       allTools,
  //       toolKits: resolvedToolKits,
  //       deniedToolKits,
  //     });
  //   }

  //   return result;
  // }

  /**
   * V2：分层决议——先准备好全部插件的默认状态，
   * 然后遍历配置层级（global → deny_nonsystem → role），
   * 每层根据自身配置禁用/修改插件，并标记来源层级。
   *
   * 与 resolvePlugins 保持相同签名，方便对照验证。
   */
  async resolvePlugins(
    session?: ISessionContext,
    pluginsConfig?: PluginConfig,
    skipHandler = false,
  ): Promise<ResolvedPluginInfo[]> {
    const rawGlobal = await this.settingsStorage.getSettings(SG_PLUGINS);
    // const globalCfg = PluginConfigParser.normalize(rawGlobal);
    const globalCfg = rawGlobal as PluginConfig;
    console.log(globalCfg);
    // role 配置原样保留 __strategy，作为该层的内置策略
    const roleCfg = pluginsConfig || {};
    // 1. 准备全部插件的初始状态（按 category 决定默认启用）
    type PluginState = {
      manifest: PluginManifest;
      enabled: boolean | undefined;
      defaultEnabled: boolean;
      effective: string;
      /** 被禁用的 toolkit ID 集合（仅用于运行时过滤，不入输出） */
      deniedToolkits: Set<string>;
    };
    const stateMap = new Map<string, PluginState>();

    for (const [id, instance] of this.instances) {
      const defaultEnabled =
        instance.manifest.category === "system" ||
        instance.manifest.category === "core" ||
        instance.manifest.essential === true;
      stateMap.set(id, {
        manifest: instance.manifest,
        enabled: instance.manifest.essential ? true : undefined,
        defaultEnabled: defaultEnabled,
        effective: "default",
        deniedToolkits: new Set(),
      });
    }

    // 2. 逐层处理配置
    const layers: Record<string, PluginConfig> = {
      global: globalCfg,
      role: roleCfg,
    };

    for (const [layerName, layerCfg] of Object.entries(layers)) {
      if (!layerCfg) continue;
      const layerStrategy = layerCfg.__strategy || undefined;
      const layerDefault = layerCfg.__default ?? true;
      delete layerCfg.__strategy;
      delete layerCfg.__default;

      if (layerStrategy === "deny_nonsystem") {
        for (const [pluginId, state] of stateMap) {
          if (
            state.enabled &&
            state.manifest.category !== "system" &&
            !state.manifest.essential
          ) {
            state.enabled = false;
            state.effective = layerName;
          }
        }
      }
      for (const [pluginId, state] of stateMap) {
        // essential 插件跳过所有后续处理，始终保持启用
        if (state.manifest.essential) continue;

        // 前层已禁用的插件，后层不再处理,必须使用 === false 判断
        if (state.enabled === false) continue;

        if (
          layerStrategy === "deny_nonsystem" &&
          state.manifest.category !== "system"
        ) {
          state.enabled = false;
          state.effective = layerName;
          continue;
        }

        const getEntry = (pluginId: string) => {
          const entry = layerCfg[pluginId];
          if (!entry || typeof entry !== "object") {
            return {
              enabled:
                layerName !== "global" ? layerDefault : state.defaultEnabled,
            };
          }
          return entry;
        };

        const entry = getEntry(pluginId);

        state.enabled = !!entry.enabled;

        if (state.enabled === false) {
          state.effective = layerName;
          continue;
        }

        if (entry.toolkits_filter !== "allow") {
          // 黑名单模式（默认）：拒绝列出的工具包
          for (const d of entry.toolkits_deny || [])
            state.deniedToolkits.add(d);
        } else {
          // 白名单模式：拒绝所有工具包，只允许列出的
          const allKits = PluginRegistry.getToolKits(pluginId);
          for (const kit of allKits) state.deniedToolkits.add(kit.def.id);
          for (const a of entry.toolkits_allow || [])
            state.deniedToolkits.delete(a);
        }
      }
    }

    // 3. 构建最终结果
    const result: ResolvedPluginInfo[] = [];

    for (const [id, state] of stateMap) {
      result.push(
        await this.buildPluginResult(
          id,
          state.manifest,
          state.enabled,
          state.effective,
          state.deniedToolkits,
          skipHandler,
          session,
        ),
      );
    }

    return result;
  }

  /**
   * 根据插件状态构建 ResolvedPluginInfo
   */
  private async buildPluginResult(
    pluginId: string,
    manifest: PluginManifest,
    enabled: boolean,
    effective: string,
    deniedSet: Set<string> | undefined,
    skipHandler: boolean,
    session: ISessionContext | undefined,
  ): Promise<ResolvedPluginInfo> {
    const allTools = [
      ...PluginRegistry.getTools(pluginId),
      ...PluginRegistry.getToolKits(pluginId).flatMap((k) => k.tools),
    ];
    if (!enabled) {
      return {
        enabled: false,
        effective,
        plugin: manifest,
        enabledTools: [],
        allTools,
        enabledToolKits: [],
        interceptors: [],
        workspaceProviders: PluginRegistry.getWorkspaceProviders(pluginId),
        source: manifest.source,
        pluginPath: manifest.pluginPath,
      };
    }

    const tools = PluginRegistry.getTools(pluginId);

    const allDenied = deniedSet ?? new Set();

    const enabledTools = [...tools];
    const kitRegs = PluginRegistry.getToolKits(pluginId);
    const enabledToolKits: Array<{
      id: string;
      name: string;
      loadMode: ToolLoadMode;
      activator?: string;
      enabled: boolean;
    }> = [];

    for (const kitReg of kitRegs) {
      if (allDenied.has(kitReg.def.id)) continue;

      let loadMode: ToolLoadMode = kitReg.def.loadMode || "eager";
      let activator = kitReg.def.activator;
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
      enabledToolKits.push({
        id: kitReg.def.id,
        name: kitReg.def.name || kitReg.def.id,
        loadMode,
        activator,
        enabled: true,
      });

      if (loadMode === "eager") {
        enabledTools.push(...kitReg.tools);
      }
    }

    return {
      enabled: true,
      effective,
      plugin: manifest,
      enabledTools,
      allTools,
      enabledToolKits,
      interceptors: PluginRegistry.getInterceptors(pluginId),
      workspaceProviders: PluginRegistry.getWorkspaceProviders(pluginId),
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
