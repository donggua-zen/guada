import type { ApiContext } from "./api-context";

export interface RemoteConnection {
  id: string;
  name: string;
  config: {
    host: string;
    port: number;
    username: string;
    authMethod: "password" | "privateKey";
    password?: string;
    /** 私钥文件绝对路径(不再存储私钥内容明文) */
    privateKeyPath?: string;
    path: string;
    /** agent 权限模式:readonly | workspace | unrestricted(默认 workspace) */
    perm?: string;
  };
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

export interface DeployResult {
  success: boolean;
  installed: boolean;
  version: string;
  log: string[];
}

export interface RemoteWorkspaceApi {
  getConnections(): Promise<RemoteConnection[]>;
  createConnection(name: string, config: RemoteConnection["config"]): Promise<RemoteConnection>;
  updateConnection(id: string, data: { name?: string; config?: RemoteConnection["config"] }): Promise<RemoteConnection>;
  deleteConnection(id: string): Promise<{ success: boolean }>;
  testConnection(config: RemoteConnection["config"]): Promise<{ success: boolean; error?: string; log?: string }>;
  deployConnection(config: RemoteConnection["config"]): Promise<DeployResult>;
  browsePath(config: RemoteConnection["config"], path: string): Promise<DirEntry[]>;
}

export const remoteWorkspaceApi: RemoteWorkspaceApi = {
  async getConnections(this: ApiContext) {
    return await this._request("/remote-workspace/connections");
  },

  async createConnection(this: ApiContext, name: string, config: RemoteConnection["config"]) {
    return await this._request("/remote-workspace/connections", {
      method: "POST",
      data: { name, config },
    });
  },

  async updateConnection(this: ApiContext, id: string, data: { name?: string; config?: RemoteConnection["config"] }) {
    return await this._request(`/remote-workspace/connections/${id}`, {
      method: "PUT",
      data,
    });
  },

  async deleteConnection(this: ApiContext, id: string) {
    return await this._request(`/remote-workspace/connections/${id}`, {
      method: "DELETE",
    });
  },

  async testConnection(this: ApiContext, config: RemoteConnection["config"]) {
    return await this._request("/remote-workspace/connections/test", {
      method: "POST",
      data: { config },
    });
  },

  async deployConnection(this: ApiContext, config: RemoteConnection["config"]) {
    return await this._request("/remote-workspace/connections/deploy", {
      method: "POST",
      data: { config },
    });
  },

  async browsePath(this: ApiContext, config: RemoteConnection["config"], path: string) {
    return await this._request("/remote-workspace/connections/browse", {
      method: "POST",
      data: { config, path },
    });
  },
};
