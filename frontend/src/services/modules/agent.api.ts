import type { ApiContext } from "./api-context";
import type {
  Agent,
  AgentListResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "@/types/agent";

export interface AgentApi {
  fetchAgents(): Promise<AgentListResponse>;
  fetchAgent(agentId: string): Promise<Agent>;
  createAgent(agentData: CreateAgentRequest): Promise<Agent>;
  updateAgent(agentId: string, agentData: UpdateAgentRequest): Promise<Agent>;
  deleteAgent(agentId: string): Promise<{ success: boolean }>;
  importAgents(files: { content: string; filename: string }[]): Promise<{ filename: string; status: string; agentId?: string; error?: string }[]>;
}

export const agentApi: AgentApi = {
  async fetchAgents(this: ApiContext) {
    return await this._request<AgentListResponse>(`/agents`);
  },

  async fetchAgent(this: ApiContext, agentId: string) {
    return await this._request<Agent>(`/agents/${encodeURIComponent(agentId)}`);
  },

  async createAgent(this: ApiContext, agentData: CreateAgentRequest) {
    return await this._request<Agent>("/agents", {
      method: "POST",
      data: agentData,
    });
  },

  async updateAgent(this: ApiContext, agentId: string, agentData: UpdateAgentRequest) {
    return await this._request<Agent>(`/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      data: agentData,
    });
  },

  async deleteAgent(this: ApiContext, agentId: string) {
    return await this._request<{ success: boolean }>(`/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    });
  },

  async importAgents(this: ApiContext, files: { content: string; filename: string }[]) {
    return await this._request<{ filename: string; status: string; agentId?: string; error?: string }[]>(
      "/agents/import",
      {
        method: "POST",
        data: { files },
      },
    );
  },
};
