import type { ApiContext } from "./api-context";
import type { GlobalSettings } from "@/types/service";

export interface SettingsApi {
  fetchSettings(): Promise<GlobalSettings>;
  updateSettings(data: any): Promise<GlobalSettings>;
  fetchGroupSettings(group: string): Promise<any>;
  updateGroupSettings(group: string, data: any): Promise<any>;
  fetchWorkspaceBaseDir(): Promise<{ workspaceBaseDir: string | null }>;
  updateWorkspaceBaseDir(workspaceBaseDir: string | null): Promise<{ success: boolean }>;
  queryPlugins(config?: any): Promise<any>;
  updateGlobalToolStatus(pluginId: string, enabled: boolean): Promise<{ success: boolean }>;
  reloadPlugin(pluginId: string): Promise<{ success: boolean }>;
}

export const settingsApi: SettingsApi = {
  async fetchSettings(this: ApiContext) {
    return await this._request("/settings");
  },

  async updateSettings(this: ApiContext, data: any) {
    return await this._request("/settings", { method: "PUT", data });
  },

  async fetchGroupSettings(this: ApiContext, group: string) {
    return await this._request(`/settings/${group}`);
  },

  async updateGroupSettings(this: ApiContext, group: string, data: any) {
    return await this._request(`/settings/${group}`, { method: "PUT", data });
  },

  async fetchWorkspaceBaseDir(this: ApiContext) {
    return await this._request("/settings/workspace-base-dir");
  },

  async updateWorkspaceBaseDir(this: ApiContext, workspaceBaseDir: string | null) {
    return await this._request("/settings/workspace-base-dir", {
      method: "PUT",
      data: { workspaceBaseDir },
    });
  },

  async queryPlugins(this: ApiContext, config?: any) {
    return await this._request("/plugins/query", {
      method: "POST",
      data: { config },
    });
  },

  async updateGlobalToolStatus(this: ApiContext, pluginId: string, enabled: boolean) {
    return await this._request("/plugins/global", {
      method: "PUT",
      data: { pluginId, enabled },
    });
  },

  async reloadPlugin(this: ApiContext, pluginId: string) {
    return await this._request(`/plugins/reload/${pluginId}`, {
      method: "POST",
    });
  },
};
