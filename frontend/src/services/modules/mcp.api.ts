import type { ApiContext } from "./api-context";
import type { McpServer } from "@/types/api";
import type { PaginatedResponse } from "@/types/common";

export interface McpApi {
  fetchMcpServers(): Promise<PaginatedResponse<McpServer>>;
  fetchMcpServer(serverId: string): Promise<McpServer>;
  fetchMcpServerById(serverId: string): Promise<McpServer>;
  createMcpServer(data: any): Promise<McpServer>;
  updateMcpServer(serverId: string, data: any): Promise<McpServer>;
  deleteMcpServer(serverId: string): Promise<boolean>;
  toggleMcpServer(serverId: string, enabled: boolean): Promise<McpServer>;
  refreshMcpTools(serverId: string): Promise<McpServer>;
  getMcpServers(): Promise<PaginatedResponse<McpServer>>;
}

export const mcpApi: McpApi = {
  async fetchMcpServers(this: ApiContext & McpApi) {
    return await this._request("/mcp-servers");
  },

  async fetchMcpServer(this: ApiContext, serverId: string) {
    return await this._request(`/mcp-servers/${serverId}`);
  },

  fetchMcpServerById(this: ApiContext & McpApi, serverId: string) {
    return this.fetchMcpServer(serverId);
  },

  async createMcpServer(this: ApiContext, data: any) {
    return await this._request("/mcp-servers", { method: "POST", data });
  },

  async updateMcpServer(this: ApiContext, serverId: string, data: any) {
    return await this._request(`/mcp-servers/${serverId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteMcpServer(this: ApiContext, serverId: string) {
    return await this._request(`/mcp-servers/${serverId}`, {
      method: "DELETE",
    });
  },

  async toggleMcpServer(this: ApiContext, serverId: string, enabled: boolean) {
    return await this._request(`/mcp-servers/${serverId}/toggle`, {
      method: "PATCH",
      data: { enabled },
    });
  },

  async refreshMcpTools(this: ApiContext, serverId: string) {
    return await this._request(`/mcp-servers/${serverId}/refresh-tools`, {
      method: "POST",
    });
  },

  getMcpServers(this: ApiContext & McpApi) {
    return this.fetchMcpServers();
  },
};
