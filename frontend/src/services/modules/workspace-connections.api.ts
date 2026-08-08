import type { ApiContext } from "./api-context";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "textarea";
  required?: boolean;
  default?: any;
  placeholder?: string;
  showIf?: { field: string; equals: any };
  options?: { label: string; value: any }[];
}

export interface ProviderInfo {
  scheme: string;
  label: string;
  configSchema: ConfigField[];
}

export interface SavedConnection {
  id: string;
  name: string;
  scheme: string;
  config: Record<string, any>;
  workspacePath: string;
}

export interface WorkspaceConnectionApi {
  getWorkspaceProviders(): Promise<ProviderInfo[]>;
  getWorkspaceConnections(): Promise<SavedConnection[]>;
  createWorkspaceConnection(data: { name: string; scheme: string; config: Record<string, any> }): Promise<SavedConnection>;
  updateWorkspaceConnection(id: string, data: { name?: string; config?: Record<string, any> }): Promise<SavedConnection>;
  deleteWorkspaceConnection(id: string): Promise<{ success: boolean }>;
  testWorkspaceConnection(data: { scheme: string; config: Record<string, any> }): Promise<{ success: boolean; error?: string }>;
  browseWorkspacePath(data: { scheme: string; config: Record<string, any>; path: string }): Promise<{ name: string; isDirectory: boolean; size: number }[]>;
}

export const workspaceConnectionApi: WorkspaceConnectionApi = {
  async getWorkspaceProviders(this: ApiContext) {
    return await this._request("/workspace/providers");
  },

  async getWorkspaceConnections(this: ApiContext) {
    return await this._request("/workspace/connections");
  },

  async createWorkspaceConnection(this: ApiContext, data: { name: string; scheme: string; config: Record<string, any> }) {
    return await this._request("/workspace/connections", { method: "POST", data });
  },

  async updateWorkspaceConnection(this: ApiContext, id: string, data: { name?: string; config?: Record<string, any> }) {
    return await this._request(`/workspace/connections/${id}`, { method: "PUT", data });
  },

  async deleteWorkspaceConnection(this: ApiContext, id: string) {
    return await this._request(`/workspace/connections/${id}`, { method: "DELETE" });
  },

  async testWorkspaceConnection(this: ApiContext, data: { scheme: string; config: Record<string, any> }) {
    return await this._request("/workspace/connections/test", { method: "POST", data });
  },

  async browseWorkspacePath(this: ApiContext, data: { scheme: string; config: Record<string, any>; path: string }) {
    return await this._request("/workspace/connections/browse", { method: "POST", data });
  },
};
