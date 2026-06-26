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
} from "./types/plugin.types";
import { IToolProvider } from "../tools/interfaces/tool-provider.interface";
import { LegacyProviderAdapter } from "./adapter/legacy-provider.adapter";
import { PluginApiImpl } from "./api/plugin-api";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SG_PLUGINS } from "../../constants/settings.constants";

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
}

/**
 * 插件管理器
 *
 * 职责：
 * 1. 管理插件的加载/卸载/启用/禁用生命周期
 * 2. 聚合所有插件的工具定义（供 ToolOrchestrator 消费）
 * 3. 聚合所有插件的提示词（替代 ToolOrchestrator 的提示词收集逻辑）
 */
@Injectable()
export class PluginManager {
  private readonly logger = new Logger(PluginManager.name);
  private instances = new Map<string, PluginInstance>();

  constructor(private readonly settingsStorage: SettingsStorage) {}

  // ── 生命周期 ──

  /**
   * 注册并加载一个插件实例
   * @param plugin 插件实例
   * @param enabled 是否启用
   */
  async registerPlugin(plugin: PluginBase, enabled?: boolean): Promise<void> {
    const id = plugin.manifest.id;
    if (this.instances.has(id)) {
      this.logger.warn(`Plugin ${id} already registered, skipping`);
      return;
    }

    // 从全局配置读取启用状态（未传 enabled 参数时）
    let finalEnabled: boolean;
    if (enabled !== undefined) {
      finalEnabled = enabled;
    } else {
      try {
        const globalCfg = await this.settingsStorage.getSettings(SG_PLUGINS);
        const pluginVal = globalCfg[id];
        if (pluginVal === true || pluginVal === false) {
          finalEnabled = pluginVal;
        } else {
          finalEnabled = plugin.manifest.category === "core";
        }
      } catch {
        finalEnabled = plugin.manifest.category === "core";
      }
    }

    // 创建 api 并调用 onLoad（始终调用——注册工具/提示词等元数据）
    const api = new PluginApiImpl(id, plugin.manifest.name);
    if (plugin.onLoad) {
      await plugin.onLoad(api).catch((err) => {
        this.logger.error(`Plugin ${id} onLoad failed: ${err.message}`);
      });
    }
    api.flush();

    // 启用时调用 onStart（启动活跃运行时）
    if (finalEnabled && plugin.onStart) {
      await plugin.onStart().catch((err) => {
        this.logger.error(`Plugin ${id} onStart failed: ${err.message}`);
      });
    }

    const instance: PluginInstance = {
      plugin,
      manifest: plugin.manifest,
      enabled: finalEnabled,
    };
    this.instances.set(id, instance);

    this.logger.log(
      `Plugin registered: ${plugin.manifest.name} (${id}), tools=${PluginRegistry.getTools(id).length}, enabled=${finalEnabled}`,
    );
  }

  /**
   * 将旧 IToolProvider 包装为 LegacyProviderAdapter 并注册为插件
   * 用于模块原有的 IToolProvider 无缝接入 Plugin 体系
   */
  async registerLegacyProvider(provider: IToolProvider): Promise<void> {
    const adapter = new LegacyProviderAdapter(provider);
    await this.registerPlugin(adapter);
  }

  /**
   * 以纯对象方式注册工具插件（类 OpenClaw 风格，无装饰器）
   * 与 @Plugin 装饰器方案共存，逐步迁移
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

    // 构建 ToolHandlerDef[]
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

    // 注册到 registry
    const reg = (PluginRegistry as any).registrations.get(id);
    if (reg) {
      for (const td of toolDefs) {
        if (!reg.tools.find((x: any) => x.name === td.name)) {
          reg.tools.push(td);
        }
      }
    }

    // 构建 prompts
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

    // 先 stop（如果正在运行）
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
   * 重新加载插件：清除旧注册数据后重新走一遍 onLoad 注册流程
   * 适用于插件所依赖的外部配置发生变化（如 MCP 服务器增删改）后需要刷新工具列表的场景
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      this.logger.warn(`Plugin ${pluginId} not found, cannot reload`);
      return;
    }

    const plugin = instance.plugin;
    const wasEnabled = instance.enabled;

    // 完整卸载：onStop → onUnload → clearPlugin → delete instances
    await this.unregisterPlugin(pluginId);

    // 重新注册：创建新 PluginApiImpl → onLoad(查最新数据) → flush → (onStart)
    await this.registerPlugin(plugin, wasEnabled);

    this.logger.log(`Plugin reloaded: ${pluginId}, enabled=${wasEnabled}`);
  }

  /**
   * 启用/禁用插件
   */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) return;

    // 持久化
    try {
      await this.settingsStorage.updateSettings(SG_PLUGINS, {
        [pluginId]: enabled,
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist plugin state for ${pluginId}: ${err}`,
      );
    }

    if (enabled && !instance.enabled) {
      // 启用：调用 onStart
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
      // 禁用：调用 onStop（不清除 PluginRegistry，保持元数据可见）
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

  /** 检查插件是否已启用（注册时已评估 @Condition） */
  /** 检查角色级配置是否允许此插件 */
  private isRolePluginEnabled(
    pluginId: string,
    roleCfg?: PluginConfig,
  ): boolean {
    if (!roleCfg) return true;
    // PluginConfig 本身可为 true/false（旧角色配置兼容）
    if ((roleCfg as any) === true) return true;
    if ((roleCfg as any) === false) return false;
    const val = roleCfg[pluginId];
    if (val === true) return true;
    if (Array.isArray(val)) return val.length > 0;
    // 角色未配置此项 → 继承全局（由 isPluginAvailable 决定）
    return true;
  }

  private isPluginAvailable(id: string): boolean {
    return this.instances.get(id)?.enabled === true;
  }

  /**
   * 获取所有已启用插件的工具定义
   * @param context 运行时上下文，用于 ToolSet 解析
   * @param enabledPlugins 可选，限制只返回指定插件的工具
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

  /** 获取指定插件的工具定义（无论启用/禁用，仅用于前端列表展示） */
  getPluginTools(pluginId: string): ToolHandlerDef[] {
    return PluginRegistry.getTools(pluginId);
  }

  /**
   * 获取所有启用插件中已解析运行时的 ToolSet 信息
   * 外部（如 ToolOrchestrator）可据此按 toolSet 分类工具
   */
  async getPluginToolSets(
    context: PluginContext,
    roleCfg?: PluginConfig,
  ): Promise<
    Array<{
      pluginId: string;
      toolSets: Array<{
        name: string;
        loadMode: ToolLoadMode;
        activator?: string;
      }>;
    }>
  > {
    const result: Array<{
      pluginId: string;
      toolSets: Array<{
        name: string;
        loadMode: ToolLoadMode;
        activator?: string;
      }>;
    }> = [];
    for (const [id, instance] of this.instances) {
      if (!this.isPluginAvailable(id)) continue;
      if (!this.isRolePluginEnabled(id, context.tools)) continue;

      const toolSets = PluginRegistry.getToolSets(id);
      if (toolSets.length === 0) continue;

      const resolved: Array<{
        name: string;
        loadMode: ToolLoadMode;
        activator?: string;
      }> = [];
      for (const ts of toolSets) {
        const def = {
          loadMode: ts.loadMode || ("lazy" as ToolLoadMode),
          activator: ts.activator,
        };
        let resolved_ts = { ...def };
        try {
          if (ts.handler) {
            const runtime = await ts.handler(context);
            if (runtime)
              resolved_ts = {
                ...resolved_ts,
                loadMode: runtime.loadMode ?? resolved_ts.loadMode,
                activator: runtime.activator ?? resolved_ts.activator,
              };
          }
        } catch {}
        resolved.push({
          name: ts.name,
          loadMode: resolved_ts.loadMode,
          activator: resolved_ts.activator,
        });
      }
      result.push({ pluginId: id, toolSets: resolved });
    }
    return result;
  }

  // ── 提示词聚合 ──

  /**
   * 收集所有启用插件中 loadMode=eager 的提示词（始终注入 system prompt）
   * 按 frequency 排序：STATIC → REGULAR → VOLATILE
   */
  async collectPrompts(context: PluginContext): Promise<PromptPiece[]> {
    return this.collectByLoadMode(context, "eager");
  }

  /**
   * 收集所有启用插件中 loadMode=lazy 的提示词（仅在 tool_load 时注入）
   */
  async collectLazyPrompts(context: PluginContext): Promise<PromptPiece[]> {
    return this.collectByLoadMode(context, "lazy");
  }

  /**
   * 获取指定插件的所有 loadMode=eager 的提示词（注入 system prompt 的静态/动态内容）
   */
  async collectPluginPrompts(
    pluginId: string,
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    const all = await this.collectByLoadMode(context, "eager");
    return all.filter((p) => p.pluginId === pluginId);
  }

  /**
   * 获取指定插件的所有 loadMode=lazy 的提示词（tool_load 时才注入的详细说明）
   */
  async collectPluginLazyPrompts(
    pluginId: string,
    context: PluginContext,
  ): Promise<PromptPiece[]> {
    const all = await this.collectByLoadMode(context, "lazy");
    return all.filter((p) => p.pluginId === pluginId);
  }

  /** 按 loadMode 收集提示词 */
  private async collectByLoadMode(
    context: PluginContext,
    loadMode: string,
  ): Promise<PromptPiece[]> {
    const pieces: PromptPiece[] = [];

    for (const [id, instance] of this.instances) {
      if (!this.isPluginAvailable(id)) continue;
      if (!this.isRolePluginEnabled(id, context.tools)) continue;

      // 从 PluginRegistry 读取注册的提示词元数据（OnLoad(api).registerPrompt 方式）
      const { prompts: promptMetas } = PluginRegistry.getPromptMetas(id);
      for (const meta of promptMetas) {
        // 解析实际 loadMode：从 toolSet 运行时决定，无 toolSet 时默认为 eager
        let actualLoadMode: string | undefined;
        if (meta.toolSet) {
          try {
            const toolSets = PluginRegistry.getToolSets(id);
            const ts = toolSets.find((t) => t.name === meta.toolSet);
            if (ts) {
              const tsDefaults = {
                loadMode: ts.loadMode || ("eager" as ToolLoadMode),
              };
              let tsResolved = { ...tsDefaults };
              if (ts.handler) {
                const runtime = await ts.handler(context);
                if (runtime)
                  tsResolved = {
                    ...tsResolved,
                    loadMode: runtime.loadMode ?? tsResolved.loadMode,
                  };
              }
              actualLoadMode = tsResolved.loadMode;
            }
          } catch {}
        }
        actualLoadMode = actualLoadMode || "eager";
        if (actualLoadMode !== loadMode) continue;
        try {
          const content = await meta.handler(context);
          if (content)
            pieces.push({
              content,
              frequency: meta.frequency as any,
              loadMode: actualLoadMode as any,
              pluginId: id,
              description: meta.description,
            });
        } catch {}
      }

      // 旧适配器兼容：getPrompts/getPersistentPrompts 方法（LegacyProviderAdapter 使用）
      if (loadMode === "eager") {
        if (instance.plugin.getPrompts) {
          try {
            const r = await instance.plugin.getPrompts(context);
            if (r) pieces.push(...r);
          } catch {}
        }
        if (instance.plugin.getPersistentPrompts) {
          try {
            const r = await instance.plugin.getPersistentPrompts(context);
            if (r) pieces.push(...r);
          } catch {}
        }
      }
    }

    const order = { STATIC: 0, REGULAR: 1, VOLATILE: 2 };
    pieces.sort((a, b) => {
      const diff = (order[a.frequency] ?? 1) - (order[b.frequency] ?? 1);
      return diff !== 0 ? diff : a.pluginId.localeCompare(b.pluginId);
    });
    return pieces;
  }

  /**
   * 获取所有懒加载 ToolSet 的激活词原始数据（已过滤+运行时解析），供插件格式化。
   * 返回格式：[{ name: "todo", activator: "..." }, ...]
   */
  async getToolActivators(context: PluginContext): Promise<Array<{ name: string; activator: string }>> {
    const activators: Array<{ name: string; activator: string }> = [];

    for (const [id, instance] of this.instances) {
      if (!this.isPluginAvailable(id)) continue;
      if (!this.isRolePluginEnabled(id, context.tools)) continue;

      const toolSets = PluginRegistry.getToolSets(id);

      for (const ts of toolSets) {
        const tsDefaults = {
          loadMode: ts.loadMode || ("eager" as ToolLoadMode),
          activator: ts.activator,
        };
        let tsResolved = { ...tsDefaults };
        try {
          if (ts.handler) {
            const runtime = await ts.handler(context);
            if (runtime)
              tsResolved = {
                ...tsResolved,
                loadMode: runtime.loadMode ?? tsResolved.loadMode,
                activator: runtime.activator ?? tsResolved.activator,
              };
          }
        } catch {}

        if (tsResolved.loadMode !== "lazy") continue;

        activators.push({
          name: ts.name,
          activator: tsResolved.activator || `${instance.manifest.name} 工具集`,
        });
      }
    }

    return activators;
  }

  // ── 查询 ──

  isPluginEnabled(pluginId: string): boolean {
    return this.instances.get(pluginId)?.enabled ?? false;
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.instances.get(pluginId);
  }

  getAllPlugins(): PluginInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.enabled);
  }

  /** 返回所有已注册插件实例（包括禁用），用于前端列表展示 */
  getAllPluginRegistrations(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  getEnabledPluginIds(): string[] {
    return Array.from(this.instances.values())
      .filter((i) => i.enabled)
      .map((i) => i.manifest.id);
  }

  /**
   * 获取指定插件的所有能力入口
   * 对外公开，整个系统统一通过 getTools 获取工具，不再单独提供 findTool/findPluginTools
   */
}
