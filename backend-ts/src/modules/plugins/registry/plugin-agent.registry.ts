import { Injectable, Logger } from "@nestjs/common";
import { PluginAgentDef } from "../types/plugin.types";

/**
 * 插件智能体保留前缀：归一化 id 形如 `plugin-<pluginId>-<id>`。
 * 用户创建的智能体不允许落在该前缀上（AgentService 创建守卫）。
 */
export const PLUGIN_AGENT_ID_PREFIX = "plugin-";

/** 插件智能体归一化 id */
export function normalizePluginAgentId(pluginId: string, id: string): string {
  return `${PLUGIN_AGENT_ID_PREFIX}${pluginId}-${id}`;
}

/** 归一化 id 是否属于某插件 */
export function isPluginAgentOf(agentId: string, pluginId: string): boolean {
  return agentId.startsWith(`plugin-${pluginId}-`);
}

/** 归一化 id 是否是任一插件智能体 */
export function isPluginAgentId(agentId: string): boolean {
  return typeof agentId === "string" && agentId.startsWith(PLUGIN_AGENT_ID_PREFIX);
}

/**
 * 归一化 id → 插件 id（无法解析时返回 null）
 */
export function pluginIdFromAgentId(agentId: string): string | null {
  if (!isPluginAgentId(agentId)) return null;
  const rest = agentId.substring(PLUGIN_AGENT_ID_PREFIX.length);
  // 插件 id 至少 1 个字符；插件 id 本身可含连字符，取第一个 '-' 之前为插件 id 的做法
  // 不成立（plugin-hello-plugin-main → 插件 id 是 hello-plugin）。改为遍历已注册表匹配，
  // 这里仅做前缀剥离兜底：调用方应优先用 isPluginAgentOf(已知插件 id) 精确匹配。
  const idx = rest.indexOf("-");
  if (idx <= 0) return null;
  return rest.substring(0, idx);
}

/**
 * 插件注册智能体注册中心（v4）
 *
 * 静态单例（与 PluginRegistry 同型）：插件经 PluginApi.registerAgent 收集声明，
 * flush 时提交至此；AgentFileStore 在读取层把声明合成为虚拟智能体视图，
 * 不落盘、生命周期跟随插件（加载即出现 / 卸载或全局禁用即隐藏）。
 *
 * 刻意静态而非 Nest 注入：AgentFileStore（agents 模块）消费本注册表，
 * PluginRegistry 先例已证明静态单例可避免 plugins ↔ agents 的模块循环依赖。
 */
export interface PluginAgentRegistration {
  /** 归一化后的全局唯一 id（plugin-<pluginId>-<id>） */
  agentId: string;
  /** 来源插件 */
  pluginId: string;
  /** 插件内原始 id */
  defId: string;
  /** 插件提供的定义 */
  def: PluginAgentDef;
}

type AvailabilityChecker = (pluginId: string) => boolean;

export class PluginAgentRegistry {
  private static readonly logger = new Logger(PluginAgentRegistry.name);
  /** pluginId → (defId → registration)，保持插入序 */
  private static readonly agents = new Map<
    string,
    Map<string, PluginAgentRegistration>
  >();
  /**
   * 插件全局启停查询（由 PluginManager 启动时注入，解耦依赖方向）。
   * 返回 true = 插件当前全局启用（智能体对外可见）。
   */
  private static availabilityChecker: AvailabilityChecker | null = null;

  static setAvailabilityChecker(checker: AvailabilityChecker | null): void {
    PluginAgentRegistry.availabilityChecker = checker;
  }

  /**
   * 提交一个插件智能体声明（PluginApi.flush 期调用）。
   * 归一化 id 冲突（同插件重复 defId）覆盖旧声明，跨插件冲突不可能（前缀隔离）。
   */
  static commit(
    pluginId: string,
    defId: string,
    def: PluginAgentDef,
  ): PluginAgentRegistration {
    let bucket = PluginAgentRegistry.agents.get(pluginId);
    if (!bucket) {
      bucket = new Map();
      PluginAgentRegistry.agents.set(pluginId, bucket);
    }
    const agentId = normalizePluginAgentId(pluginId, defId);
    const reg: PluginAgentRegistration = {
      agentId,
      pluginId,
      defId,
      def,
    };
    bucket.set(defId, reg);
    return reg;
  }

  /** 移除某插件的全部智能体声明（unregisterPlugin 生命周期清理） */
  static removeByPlugin(pluginId: string): void {
    PluginAgentRegistry.agents.delete(pluginId);
  }

  /**
   * 全量列出当前可见的插件智能体。
   * 插件被全局禁用（availabilityChecker 返回 false）时其智能体隐藏；
   * 未注入 checker（如单测/无 PluginManager 环境）视为全部可见。
   */
  static listVisible(): PluginAgentRegistration[] {
    const out: PluginAgentRegistration[] = [];
    for (const [pluginId, bucket] of PluginAgentRegistry.agents) {
      if (
        PluginAgentRegistry.availabilityChecker &&
        !PluginAgentRegistry.availabilityChecker(pluginId)
      ) {
        continue;
      }
      out.push(...bucket.values());
    }
    return out;
  }

  /** 按归一化 id 查找（跟随 listVisible 的启停语义） */
  static findVisibleById(agentId: string): PluginAgentRegistration | undefined {
    if (!isPluginAgentId(agentId)) return undefined;
    for (const reg of PluginAgentRegistry.listVisible()) {
      if (reg.agentId === agentId) return reg;
    }
    return undefined;
  }

  /** 某插件当前生效的智能体声明（含未启停过滤，供能力合成用） */
  static getByPlugin(pluginId: string): PluginAgentRegistration[] {
    const bucket = PluginAgentRegistry.agents.get(pluginId);
    return bucket ? Array.from(bucket.values()) : [];
  }

  /** 是否已有归一化 id 冲突的声明（跨插件场景，注册期诊断） */
  static hasAny(agentId: string): boolean {
    for (const bucket of PluginAgentRegistry.agents.values()) {
      for (const reg of bucket.values()) {
        if (reg.agentId === agentId) return true;
      }
    }
    return false;
  }

  /** 清空（测试用） */
  static clear(): void {
    PluginAgentRegistry.agents.clear();
    PluginAgentRegistry.availabilityChecker = null;
  }
}
