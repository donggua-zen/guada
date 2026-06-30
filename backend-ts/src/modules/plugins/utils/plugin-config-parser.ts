import {
  PluginEntryConfig,
} from "../types/plugin.types";

/**
 * 插件配置解析器
 *
 * 只支持新格式 v2：{ enabled, toolkits_filter, toolkits_deny, params }
 * 不再兼容旧格式（true / false / string[]）。
 */
export class PluginConfigParser {
  /**
   * 规范化单条配置值
   */
  static normalizeEntry(
    val: PluginEntryConfig | undefined,
  ): PluginEntryConfig {
    if (!val) return { enabled: false };
    return {
      enabled: val.enabled !== false,
      toolkits_filter: val.toolkits_filter !== false,
      toolkits_deny: val.toolkits_deny || [],
      params: val.params || undefined,
    };
  }

  /**
   * 规范化整个配置对象
   */
  static normalize(
    config: Record<string, PluginEntryConfig> | undefined,
  ): Record<string, PluginEntryConfig> {
    if (!config) return {};
    const result: Record<string, PluginEntryConfig> = {};
    for (const [key, val] of Object.entries(config)) {
      result[key] = this.normalizeEntry(val);
    }
    return result;
  }

  // ==================== 查询便利方法 ====================

  /**
   * 获取插件的 enabled 状态
   */
  static isEnabled(
    entry: PluginEntryConfig | undefined,
    defaultEnabled: boolean,
  ): boolean {
    if (!entry) return defaultEnabled;
    return entry.enabled !== false;
  }

  /**
   * 获取插件的 toolkits_filter（未设置返回 false = 不过滤）
   */
  static getToolkitsFilter(
    entry: PluginEntryConfig | undefined,
  ): boolean {
    return entry?.toolkits_filter === true;
  }

  /**
   * 获取插件的 toolkits_deny（未设置返回空数组 = 全部允许）
   */
  static getToolkitsDeny(
    entry: PluginEntryConfig | undefined,
  ): string[] {
    return entry?.toolkits_deny || [];
  }

  /**
   * 判断工具包是否被配置禁止
   */
  static isToolKitDenied(
    entry: PluginEntryConfig | undefined,
    toolkitId: string,
  ): boolean {
    if (!this.getToolkitsFilter(entry)) return false;
    const deny = this.getToolkitsDeny(entry);
    return deny.includes(toolkitId);
  }

  /**
   * 合并两级配置（global + role），role 优先
   *
   * 规则：
   * - 全局 disabled → 角色也无法开启
   * - 全局 enabled  → 角色可关闭、可缩小允许范围
   * - 角色未配置    → 继承全局设置
   */
  static merge(
    global: Record<string, PluginEntryConfig>,
    role?: Record<string, PluginEntryConfig>,
  ): Record<string, PluginEntryConfig> {
    if (!role) return { ...global };
    const merged = { ...global };
    for (const [key, val] of Object.entries(role)) {
      const globalEntry = global[key];

      // 全局 disabled → 角色无权开启
      if (globalEntry && globalEntry.enabled === false) {
        merged[key] = { ...globalEntry };
        continue;
      }

      // 角色明确禁用
      if (val.enabled === false) {
        merged[key] = { ...val, enabled: false };
        continue;
      }

      // 角色启用/未设置 → 合并
      (merged as any)[key] = {
        enabled: val.enabled ?? globalEntry?.enabled ?? true,
        toolkits_filter: val.toolkits_filter ?? globalEntry?.toolkits_filter ?? true,
        toolkits_deny: [
          ...(globalEntry?.toolkits_deny || []),
          ...(val.toolkits_deny || []),
        ],
        toolkits_deny_global: globalEntry?.toolkits_deny || [],
        toolkits_deny_role: val.toolkits_deny || [],
        params: val.params ?? globalEntry?.params ?? undefined,
      };
    }
    return merged;
  }
}
