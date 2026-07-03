import {
  PluginConfig,
  PluginEntryConfig,
} from "../types/plugin.types";

/**
 * 插件配置解析器
 */
export class PluginConfigParser {
  /**
   * 规范化单条配置值
   */
  static normalizeEntry(
    val: PluginEntryConfig | boolean | string | undefined,
  ): PluginEntryConfig {
    if (!val || typeof val !== "object") {
      // undefined/null → 禁用
      if (val === undefined || val === null) return { enabled: false, toolkits_filter: "deny", toolkits_deny: [], toolkits_allow: [], params: undefined };
      // 旧格式兼容：true / false / string
      return { enabled: val !== false && val !== "false" };
    }
    return {
      enabled: val.enabled !== false,
      toolkits_filter: val.toolkits_filter ?? "deny",
      toolkits_deny: val.toolkits_deny || [],
      toolkits_allow: val.toolkits_allow || [],
      params: val.params || undefined,
    };
  }

  /**
   * 规范化整个配置对象
   */
  static normalize(
    config: PluginConfig | undefined,
  ): PluginConfig {
    if (!config) return {};
    const result: PluginConfig = {};
    // 保留系统字段
    if (config.__strategy) result.__strategy = config.__strategy;
    if (config.__default !== undefined) result.__default = config.__default;

    for (const [key, val] of Object.entries(config)) {
      if (key.startsWith("__")) continue;
      result[key] = this.normalizeEntry(val);
    }
    return result;
  }

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
}
