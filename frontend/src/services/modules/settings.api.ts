import type { ApiContext } from "./api-context";
import type { GlobalSettings, User } from "@/types/service";
import type { ToolDisplayConfig } from "@/utils/toolDisplay";

export interface SettingsApi {
  fetchSettings(): Promise<GlobalSettings>;
  updateSettings(data: Partial<GlobalSettings>): Promise<GlobalSettings>;
  /** 分组设置：调用方以泛型给出该组的已知键形状（见 types/service.ts 的 *GroupSettings） */
  fetchGroupSettings<T = Record<string, unknown>>(group: string): Promise<T>;
  updateGroupSettings(group: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  fetchWorkspaceBaseDir(): Promise<{ workspaceBaseDir: string | null }>;
  updateWorkspaceBaseDir(workspaceBaseDir: string | null): Promise<{ success: boolean }>;
  /** 按角色配置查询插件与工具包视图（智能体面板的工具包卡片数据源） */
  queryPlugins(config?: PluginQueryConfig, lang?: string): Promise<PluginQueryResult>;
  updateGlobalToolStatus(pluginId: string, enabled: boolean): Promise<{ success: boolean }>;
  reloadPlugin(pluginId: string): Promise<{ success: boolean }>;
  fetchToolDisplays(lang?: string): Promise<Record<string, ToolDisplayConfig>>;
}

/** /plugins/query 的工具包条目（与后端 plugins.controller 的视图同构） */
export interface PluginQueryToolkit {
  id: string
  name?: string
  description?: string
  loadMode?: string
  enabled?: boolean
  toolCount?: number
  promptCount?: number
}

/** /plugins/query 的插件条目 */
export interface PluginQueryPlugin {
  pluginId: string
  name?: string
  displayName?: string
  description?: string
  category?: string
  enabled: boolean
  icon?: string
  source?: string
  version?: string
  author?: string
  tools?: PluginQueryTool[]
  toolkits: PluginQueryToolkit[]
}

/** /plugins/query 的工具条目 */
export interface PluginQueryTool {
  name: string
  description?: string
  parameters?: unknown
  display?: Record<string, unknown>
}

export interface PluginQueryResult {
  plugins: PluginQueryPlugin[]
}

/**
 * 角色/智能体层插件配置（settings.plugins 的查询形态）：
 * __strategy/__default 为系统键，其余键为插件条目
 * （toolkits_filter/toolkits_allow/toolkits_deny 等，语义见 utils/agentPluginConfig）。
 */
export interface PluginQueryConfig {
  __strategy?: string
  __default?: boolean
  [pluginId: string]: unknown
}

export const settingsApi: SettingsApi = {
  async fetchSettings(this: ApiContext) {
    return await this._request<GlobalSettings>("/settings");
  },

  async updateSettings(this: ApiContext, data: Partial<GlobalSettings>) {
    return await this._request<GlobalSettings>("/settings", { method: "PUT", data });
  },

  async fetchGroupSettings<T = Record<string, unknown>>(this: ApiContext, group: string) {
    return await this._request<T>(`/settings/${group}`);
  },

  async updateGroupSettings(this: ApiContext, group: string, data: Record<string, unknown>) {
    return await this._request<Record<string, unknown>>(`/settings/${group}`, { method: "PUT", data });
  },

  async fetchWorkspaceBaseDir(this: ApiContext) {
    return await this._request<{ workspaceBaseDir: string | null }>("/settings/workspace-base-dir");
  },

  async updateWorkspaceBaseDir(this: ApiContext, workspaceBaseDir: string | null) {
    return await this._request<{ success: boolean }>("/settings/workspace-base-dir", {
      method: "PUT",
      data: { workspaceBaseDir },
    });
  },

  async queryPlugins(this: ApiContext, config?: PluginQueryConfig, lang?: string) {
    return await this._request<PluginQueryResult>("/plugins/query", {
      method: "POST",
      data: { config, ...(lang ? { lang } : {}) },
    });
  },

  async updateGlobalToolStatus(this: ApiContext, pluginId: string, enabled: boolean) {
    return await this._request<{ success: boolean }>("/plugins/global", {
      method: "PUT",
      data: { pluginId, enabled },
    });
  },

  async reloadPlugin(this: ApiContext, pluginId: string) {
    return await this._request<{ success: boolean }>(`/plugins/reload/${pluginId}`, {
      method: "POST",
    });
  },

  async fetchToolDisplays(this: ApiContext, lang?: string) {
    return await this._request<Record<string, ToolDisplayConfig>>("/plugins/tool-displays", {
      params: lang ? { lang } : undefined,
    });
  },
};
