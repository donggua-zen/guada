import type { ApiContext } from "./api-context";
import type { McpServer } from "@/types/api";
import type { PaginatedResponse } from "@/types/common";

/**
 * create/update MCP 服务器的请求体（镜像后端 mcp-server.service 的 createServer/updateServer
 * 字段白名单；type 缺省时后端按 command 存在与否推断 stdio）
 */
export interface McpServerPayload {
    name: string
    url?: string | null
    /** 传输类型（sse/streamable_http/stdio 等）；缺省按 command 推断 */
    type?: string | null
    description?: string | null
    headers?: Record<string, string> | null
    /** stdio 传输的启动命令 */
    command?: string | null
    args?: string[] | null
    env?: Record<string, string> | null
    cwd?: string | null
    enabled?: boolean
}

export interface McpApi {
  fetchMcpServers(): Promise<PaginatedResponse<McpServer>>;
  fetchMcpServer(serverId: string): Promise<McpServer>;
  fetchMcpServerById(serverId: string): Promise<McpServer>;
  createMcpServer(data: McpServerPayload): Promise<McpServer>;
  updateMcpServer(serverId: string, data: McpServerPayload): Promise<McpServer>;
  deleteMcpServer(serverId: string): Promise<boolean>;
  toggleMcpServer(serverId: string, enabled: boolean): Promise<McpServer>;
  refreshMcpTools(serverId: string): Promise<McpServer>;
  getMcpServers(): Promise<PaginatedResponse<McpServer>>;
}

export const mcpApi: McpApi = {
  async fetchMcpServers(this: ApiContext & McpApi) {
    return await this._request<PaginatedResponse<McpServer>>("/mcp-servers");
  },

  async fetchMcpServer(this: ApiContext, serverId: string) {
    return await this._request<McpServer>(`/mcp-servers/${serverId}`);
  },

  fetchMcpServerById(this: ApiContext & McpApi, serverId: string) {
    return this.fetchMcpServer(serverId);
  },

  async createMcpServer(this: ApiContext, data: McpServerPayload) {
    return await this._request<McpServer>("/mcp-servers", { method: "POST", data });
  },

  async updateMcpServer(this: ApiContext, serverId: string, data: McpServerPayload) {
    return await this._request<McpServer>(`/mcp-servers/${serverId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteMcpServer(this: ApiContext, serverId: string) {
    return await this._request<boolean>(`/mcp-servers/${serverId}`, {
      method: "DELETE",
    });
  },

  async toggleMcpServer(this: ApiContext, serverId: string, enabled: boolean) {
    return await this._request<McpServer>(`/mcp-servers/${serverId}/toggle`, {
      method: "PATCH",
      data: { enabled },
    });
  },

  async refreshMcpTools(this: ApiContext, serverId: string) {
    return await this._request<McpServer>(`/mcp-servers/${serverId}/refresh-tools`, {
      method: "POST",
    });
  },

  getMcpServers(this: ApiContext & McpApi) {
    return this.fetchMcpServers();
  },
};
