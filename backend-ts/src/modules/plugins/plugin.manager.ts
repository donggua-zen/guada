import { Injectable, Logger, Optional } from "@nestjs/common";
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
import { TurnReminderRegistry } from "./turn-reminders/turn-reminder.registry";
import { isToolkitAllowedByRoleConfig } from "./utils/role-toolkit-filter";
import { isVisibleToAgent } from "./utils/agent-visibility";
import {
  PluginAgentRegistry,
  isPluginAgentId,
} from "./registry/plugin-agent.registry";
import { normalizeKitRefs } from "./registry/plugin-agent-settings";
import { ProviderContributionCoordinator } from "../llm-core/provider-contribution.coordinator";
import { PluginPathsService } from "./paths/plugin-paths.service";
import { PluginHookRegistry } from "./hooks/plugin-hook.registry";
import { LocalSlashCommandRegistry } from "../chat/commands/local-slash-command.registry";
import { JobRegistryService } from "../jobs/job-registry.service";
import { PluginHttpRegistry } from "./http/plugin-http.registry";
import { PluginLlmService } from "./llm/plugin-llm.service";

// ──

/** 单个插件在决议过程中的中间状态（resolvePlugins 内部使用） */
type PluginResolutionState = {
  manifest: PluginManifest;
  /** 全局层结果（system/core/essential 默认启用） */
  enabled: boolean;
  /** 启停来源："default"=按 category 默认值 / "global"=全局层禁用 */
  effective: "default" | "global";
  /** 被智能体层裁剪的工具包 ID 集合 */
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
 * 2. 两层开关决议：全局层控插件启停，智能体层只裁剪工具包（能力包）
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
    /** 每轮提醒注册表；由 PluginApi 转发给插件（测试可省略） */
    @Optional()
    private readonly turnReminderRegistry?: TurnReminderRegistry,
    /** 供应商包贡献协调器；llm-core 提供（测试可省略） */
    @Optional()
    private readonly providerCoordinator?: ProviderContributionCoordinator,
    /** v2：插件数据目录（测试可省略） */
    @Optional()
    private readonly pluginPaths?: PluginPathsService,
    /** v2：插件 Hook 注册表（测试可省略） */
    @Optional()
    private readonly hookRegistry?: PluginHookRegistry,
    /** v2：动作型本地命令注册表（测试可省略） */
    @Optional()
    private readonly localCommandRegistry?: LocalSlashCommandRegistry,
    /** v2.1：后台作业注册表（测试可省略） */
    @Optional()
    private readonly jobRegistry?: JobRegistryService,
    /** v3：插件 HTTP 路由注册表（测试可省略） */
    @Optional()
    private readonly httpRegistry?: PluginHttpRegistry,
    /** v3：插件 LLM 能力（测试可省略） */
    @Optional()
    private readonly pluginLlm?: PluginLlmService,
  ) {
    // Hook 启用态由本管理器裁决（禁用插件不执行 hook，但保留注册避免抖动）
    this.hookRegistry?.setEnabledResolver((pluginId) => this.isPluginEnabled(pluginId));
    // HTTP 路由同理：禁用后请求 404，但保留注册避免反复启停抖动
    this.httpRegistry?.setEnabledResolver((pluginId) => this.isPluginEnabled(pluginId));
    // v4：插件智能体的可见性跟随插件全局启停（checker 注入，避免 agents 模块反向依赖）
    PluginAgentRegistry.setAvailabilityChecker((pluginId) =>
      this.isPluginEnabled(pluginId),
    );
  }

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
        finalEnabled =
          plugin.manifest.category === "core" ||
          !!plugin.manifest.providerApi ||
          !!plugin.manifest.provides;
      }
    }

    // 创建 api 并调用 onLoad
    let dataDir: string | undefined;
    try {
      dataDir = this.pluginPaths?.getDataDir(id);
    } catch (err: any) {
      this.logger.warn(`Plugin ${id} data dir unavailable: ${err?.message ?? err}`);
    }
    const api = new PluginApiImpl(
      id,
      plugin.manifest.name,
      this.nlsService,
      this.settingsStorage,
      plugin.manifest.source,
      this.turnReminderRegistry,
      { pluginDir: plugin.manifest.pluginPath, dataDir },
      this.localCommandRegistry,
      this.hookRegistry,
      this.jobRegistry,
      this.httpRegistry,
      this.pluginLlm,
    );
    if (plugin.onLoad) {
      let onLoadError: any = null;
      await plugin.onLoad(api).catch((err) => {
        onLoadError = err;
        this.logger.error(`Plugin ${id} onLoad failed: ${err.message}`);
      });
      // 供应商包要求贡献完整：onLoad 失败意味着类型卡/适配器可能缺失，
      // 继续注册会留下「模板存在但协议不可用」的半状态，直接整包失败。
      if (onLoadError && (plugin.manifest.providerApi || plugin.manifest.provides)) {
        throw new Error(
          `Provider pack ${id} onLoad failed: ${onLoadError?.message || onLoadError}`,
        );
      }
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

    // 供应商包贡献（协议适配器 / 类型卡）：app 级注册，随插件启停联动。
    // 校验失败视为整包失败：清掉已写入 PluginRegistry 的工具/提示词后抛出，
    // 避免留下「插件已装但供应商能力不可用」的半状态。
    try {
      this.commitProviderContributions(id, api, finalEnabled);
    } catch (err: any) {
      PluginRegistry.clearPlugin(id);
      this.logger.error(
        `Plugin ${id} provider contribution rejected: ${err?.message || err}`,
      );
      throw err;
    }

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
   * 把 PluginApi 收集到的供应商贡献提交到 app 级注册表。
   * 无贡献时跳过（普通工具插件零开销）。
   */
  private commitProviderContributions(
    pluginId: string,
    api: PluginApiImpl,
    enabled: boolean,
  ): void {
    if (!this.providerCoordinator) return;
    const contributions = api.getProviderContributions();
    const hasAdapters = (contributions.adapters?.length || 0) > 0;
    const hasTypes = (contributions.types?.length || 0) > 0;
    if (!hasAdapters && !hasTypes) return;
    this.providerCoordinator.commit(pluginId, contributions, enabled);
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
    PluginAgentRegistry.removeByPlugin(pluginId);
    this.providerCoordinator?.remove(pluginId);
    this.hookRegistry?.unregisterPlugin(pluginId);
    this.localCommandRegistry?.unregisterByPlugin(pluginId);
    this.turnReminderRegistry?.unregisterByPlugin(pluginId);
    this.httpRegistry?.unregisterPlugin(pluginId);
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
      // 先摘掉供应商能力，再执行可能耗时的 onStop，避免停用窗口内继续路由新请求
      this.providerCoordinator?.setActive(pluginId, false);
      if (instance.plugin.onStop) {
        await instance.plugin.onStop().catch((err) => {
          this.logger.error(`Plugin ${pluginId} onStop failed: ${err.message}`);
        });
      }
      instance.enabled = false;
      instance.plugin._enabled = false;
      this.logger.log(`Plugin ${pluginId} disabled`);
    }

    // 供应商包：协议路由/类型卡随插件启停即时切换（保留定义，不重新 require）
    this.providerCoordinator?.setActive(pluginId, enabled);

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
   * - 智能体层（RolePluginConfig，即 agent/session settings.plugins）：
   *   仅裁剪工具包（toolkits_filter/deny/allow），由 applyRoleLayer 独立消费；
   *   不消费 entry.enabled，旧智能体数据中的插件级开关被直接忽略
   * - 二级过滤：全局关闭的插件其工具包对智能体层不可见——applyRoleLayer
   *   直接跳过未启用插件，智能体层对它们的 allow/deny 均不生效
   *
   * 这是 PluginManager 对外唯一决议入口。
   * ToolExecutor / PromptCollector 等消费方通过 ResolvedPluginInfo 使用结果。
   */
  async resolvePlugins(
    session?: ISessionContext,
    roleCfg?: RolePluginConfig,
    skipHandler = false,
  ): Promise<ResolvedPluginInfo[]> {
    // 全局层 → 智能体层：两个配置各自独立解析，互不耦合
    const stateMap = await this.resolveGlobalLayer();
    this.applyRoleLayer(stateMap, roleCfg);
    this.applyVisibilityLayer(stateMap, session?.agentId ?? null);
    this.applyLockedKitLayer(stateMap, session?.agentId ?? null);
    const kitAvailability = this.buildKitAvailability(stateMap, roleCfg);

    const result: ResolvedPluginInfo[] = [];
    for (const [, state] of stateMap) {
      result.push(
        await this.buildPluginResult(
          state,
          skipHandler,
          session,
          roleCfg,
          kitAvailability,
        ),
      );
    }
    return result;
  }

  /**
   * 锁定常开层（v4.1）：插件智能体绑定的工具包豁免一切智能体层裁剪。
   *
   * 在 roleLayer（消费侧收窄）与 visibilityLayer（生产侧收窄）之后执行：
   * agentId 命中插件智能体时，把其绑定工具包从 deniedToolkits 移除——
   * 用户的 `__strategy: "deny_nonsystem"` / 白名单 / 黑名单都压不过绑定声明，
   * 语义镜像 essential 插件的"工具包不可被任何方式拒绝"。
   *
   * 自治理（governance:"self"）包不在此豁免：mcp/skill/sub_agent 的可见性
   * 由各自 handler 按 roleCfg 裁决，store 层合成 settings 已重申其门控。
   */
  private applyLockedKitLayer(
    stateMap: Map<string, PluginResolutionState>,
    agentId: string | null | undefined,
  ): void {
    if (!agentId || !isPluginAgentId(agentId)) return;
    const reg = PluginAgentRegistry.findVisibleById(agentId);
    if (!reg) return;
    const lockedRefs = normalizeKitRefs(reg);
    if (lockedRefs.length === 0) return;

    for (const { pluginId, kitId } of lockedRefs) {
      const state = stateMap.get(pluginId);
      if (!state || !state.enabled) continue; // 全局禁用：能力面整体消失
      const kitReg = PluginRegistry.getToolKits(pluginId).find(
        (k) => k.def.id === kitId,
      );
      if (!kitReg || kitReg.def.governance === "self") continue;
      state.deniedToolkits.delete(kitId);
    }
  }

  /**
   * 构建全量工具包可用性快照（"pluginId:kitId" → 是否可用），
   * 供 requiresAnyKits 依赖判定消费。
   *
   * 可用 = ① 所属插件全局启用（两层状态此时已对全部插件算完）
   *      + ② 工具包未被智能体层拒；自治理（governance:"self"）工具包
   *        不参与 applyRoleLayer，改按其自有条目用 isToolkitAllowedByRoleConfig 裁决
   *        （与各自 handler 的判定语义一致）。
   * 刻意静态：不执行依赖包的 handler，预览/无 session 路径同样可判定。
   */
  private buildKitAvailability(
    stateMap: Map<string, PluginResolutionState>,
    roleCfg: RolePluginConfig | undefined,
  ): Map<string, boolean> {
    const availability = new Map<string, boolean>();
    for (const [id, state] of stateMap) {
      for (const kitReg of PluginRegistry.getToolKits(id)) {
        const allowed =
          kitReg.def.governance === "self"
            ? isToolkitAllowedByRoleConfig(
                roleCfg?.[id],
                kitReg.def.id,
              )
            : !state.deniedToolkits.has(kitReg.def.id);
        availability.set(`${id}:${kitReg.def.id}`, state.enabled && allowed);
      }
    }
    return availability;
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
    // 供应商包默认启用：安装即生效（类型卡/协议可用），用户显式禁用仍以持久化配置为准。
    // 代码包在装载阶段已经 require，禁用只影响能力可见性，不改变执行面。
    const defaultEnabled =
      manifest.category === "core" ||
      !!manifest.providerApi ||
      !!manifest.provides;
    // 持久化可能是遗留的布尔直存或新格式对象，先按 unknown 收窄再判断
    const pluginVal: unknown = globalCfg[manifest.id];
    if (pluginVal === true || pluginVal === false) {
      return pluginVal;
    }
    if (pluginVal && typeof pluginVal === "object" && "enabled" in pluginVal) {
      return (pluginVal as GlobalPluginEntryConfig).enabled !== false;
    }
    return defaultEnabled;
  }

  /**
   * 全局层决议：只读 SG_PLUGINS（plugins_config），决定每个插件的启停。
   * 不消费任何智能体配置；显式配置过的插件标记 effective='global'。
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
   * 智能体层决议：只消费智能体配置（agent/session settings.plugins），
   * 在全局已启用的插件范围内裁剪工具包，不触碰插件启停。
   *
   * - __strategy="deny_nonsystem"：拒绝所有非受保护插件的全部工具包（"全部禁用"）
   * - __default=false：白名单模式（未显式允许的工具包默认拒绝）
   * - 全局关闭的插件直接跳过——智能体层对它们的 allow/deny 均不生效（二级过滤）
   * - essential 插件的工具包不可被任何方式拒绝（如 universal_tools 的 lazy_tools 元能力）；
   *   system 分类插件（mcp/skill/sub_agent）的插件本体不可禁用，但工具包可按智能体裁剪
   * - 智能体层条目中遗留的 enabled 字段被显式忽略（智能体层不再控制插件启停）
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
   * 作用域层决议（v4）：插件注册侧声明的 visibleTo。
   *
   * 与 applyRoleLayer 的方向相反——roleLayer 是消费侧收窄（智能体配置裁插件能力），
   * 本层是生产侧收窄（插件声明能力只给谁用）。在 roleLayer 之后执行并追加拒绝，
   * 压过白名单 allow：智能体配置不能把限定作用域的工具包"复活"。
   *
   * 自治理（governance:"self"）工具包不适用：它们的可见性由各自 handler 裁决
   * （本期限定外部插件不可声明 governance，内建包不声明 visibleTo）。
   */
  private applyVisibilityLayer(
    stateMap: Map<string, PluginResolutionState>,
    agentId: string | null | undefined,
  ): void {
    for (const [id, state] of stateMap) {
      if (!state.enabled) continue;
      for (const kitReg of PluginRegistry.getToolKits(id)) {
        if (kitReg.def.governance === "self") continue;
        if (
          !isVisibleToAgent(kitReg.def.visibleTo, id, agentId) &&
          !state.deniedToolkits.has(kitReg.def.id)
        ) {
          state.deniedToolkits.add(kitReg.def.id);
        }
      }
    }
  }

  /**
   * 根据插件状态构建 ResolvedPluginInfo
   *
   * enabledToolKits 返回全部工具包：被智能体层裁剪的以 enabled=false 标记，
   * 且不解析其 handler（loadMode/activator 取注册默认值），其工具与提示词
   * 均不进入运行时。
   */
  private async buildPluginResult(
    state: PluginResolutionState,
    skipHandler: boolean,
    session?: ISessionContext,
    roleCfg?: RolePluginConfig,
    kitAvailability?: Map<string, boolean>,
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
    ].filter(
      // v4：顶层工具的作用域声明——其他智能体/无智能体上下文时不可见。
      // findTool 执行侧同样从 enabledTools 查找，自然 fail-closed。
      (t) => isVisibleToAgent(t.visibleTo, manifest.id, session?.agentId ?? null),
    );
    const enabledToolKits: ResolvedPluginInfo["enabledToolKits"] = [];

    for (const kitReg of PluginRegistry.getToolKits(manifest.id)) {
      // 自治理工具包不参与智能体层过滤：applyRoleLayer 写入的 deniedToolkits 对其无效。
      // 这是 handler 必然被执行的前提——被 deny 的工具包会跳过 handler 直接取静态默认值。
      const isSelfGoverned = kitReg.def.governance === "self";
      const denied =
        !isSelfGoverned && state.deniedToolkits.has(kitReg.def.id);
      // requiresAnyKits 依赖判定（OR 语义）：声明的生产者工具包全部不可用时整包隐藏。
      // enabled 保持 true——配置层并未拒绝本包，只是"依赖缺失"；loadMode=none
      // 让工具不进 enabledTools、提示词不进 PromptCollector，等价于"从未注册"。
      const depsUnmet =
        !!kitReg.def.requiresAnyKits?.length &&
        !kitReg.def.requiresAnyKits.some((dep) => kitAvailability?.get(dep));
      let loadMode: ToolKitLoadMode = kitReg.def.loadMode || "eager";
      let activator = kitReg.def.activator;

      if (depsUnmet) {
        loadMode = "none";
      } else if (!denied) {
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
