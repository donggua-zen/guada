import type { ApiContext } from "./api-context";
import type { Session, SessionGroup, SessionListResponse } from "@/types/session";

export interface SessionApi {
  createSession(data: any): Promise<Session>;
  deleteSession(sessionId: string, deleteWorkspace?: boolean): Promise<{ success: boolean }>;
  fetchSession(sessionId: string): Promise<Session>;
  fetchSessions(skip?: number, limit?: number, groupId?: string | null, keyword?: string, includeArchived?: boolean): Promise<SessionListResponse>;
  fetchArchivedSessions(skip?: number, limit?: number, keyword?: string, groupId?: string | null): Promise<SessionListResponse>;
  archiveSession(sessionId: string, archived: boolean): Promise<{ success: boolean; session?: any }>;
  batchArchiveSessions(sessionIds: string[], archived: boolean): Promise<{ success: boolean; skipped: string[] }>;
  updateSession(sessionId: string, data: any): Promise<Session>;
  fetchSessionGroups(): Promise<SessionGroup[]>;
  createSessionGroup(data: { name: string }): Promise<SessionGroup>;
  updateSessionGroup(groupId: string, data: { name: string }): Promise<SessionGroup>;
  deleteSessionGroup(groupId: string): Promise<{ success: boolean }>;
  reorderSessionGroups(groupIds: string[]): Promise<{ success: boolean }>;
  generateSessionTitle(sessionId: string): Promise<{ title: string; skipped?: boolean }>;
  























































































































































































































































  compressSession(sessionId: string): Promise<any>;
  fetchSessionSummaries(sessionId: string, limit?: number): Promise<{ items: any[]; total: number }>;
  updateSummary(summaryId: string, data: { summaryContent?: string }): Promise<any>;
  deleteSummary(summaryId: string): Promise<{ success: boolean }>;
  fetchSessionTokenStats(sessionId: string): Promise<{
    usedTokens: number;
    totalTokens: number;
    remainingTokens: number;
    percentage: number;
    modelName: string;
    messageCount: number;
    breakdown: {
      systemPrompt: number;
      summary: number;
      userPrompt: number;
      history: number;
      tools: number;
    };
  }>;
  getWorkspacePath(sessionId: string): Promise<{ workspacePath: string }>;
  updateSessionWorkspacePath(sessionId: string, workspacePath: string): Promise<{ success: boolean }>;
  getSessionPlan(sessionId: string): Promise<{ items: Array<{ content: string; status: string }> }>;
}

export const sessionApi: SessionApi = {
  async createSession(this: ApiContext, data: any) {
    return await this._request("/sessions", { method: "POST", data });
  },

  async deleteSession(this: ApiContext, sessionId: string, deleteWorkspace: boolean = false) {
    const url = deleteWorkspace
      ? `/sessions/${sessionId}?deleteWorkspace=true`
      : `/sessions/${sessionId}`;
    return await this._request(url, { method: "DELETE" });
  },

  async fetchSession(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}`);
  },

  async fetchSessions(this: ApiContext, skip?: number, limit?: number, groupId?: string | null, keyword?: string, includeArchived?: boolean) {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (groupId !== undefined) params.append("groupId", groupId === null ? "null" : groupId);
    if (keyword) params.append("keyword", keyword);
    if (includeArchived) params.append("includeArchived", "true");

    const queryString = params.toString();
    const url = queryString ? `/sessions?${queryString}` : "/sessions";

    return await this._request(url);
  },

  async fetchArchivedSessions(this: ApiContext, skip?: number, limit?: number, keyword?: string, groupId?: string | null) {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (keyword) params.append("keyword", keyword);
    if (groupId !== undefined) params.append("groupId", groupId === null ? "null" : groupId);

    const queryString = params.toString();
    const url = queryString ? `/sessions/archived?${queryString}` : "/sessions/archived";

    return await this._request(url);
  },

  async archiveSession(this: ApiContext, sessionId: string, archived: boolean) {
    return await this._request(`/sessions/${sessionId}/archive`, {
      method: "PUT",
      data: { archived },
    });
  },

  async batchArchiveSessions(this: ApiContext, sessionIds: string[], archived: boolean) {
    return await this._request(`/sessions/batch-archive`, {
      method: "POST",
      data: { sessionIds, archived },
    });
  },

  async updateSession(this: ApiContext, sessionId: string, data: any) {
    return await this._request(`/sessions/${sessionId}`, {
      method: "PUT",
      data,
    });
  },

  async fetchSessionGroups(this: ApiContext) {
    return await this._request("/session-groups");
  },

  async createSessionGroup(this: ApiContext, data: { name: string }) {
    return await this._request("/session-groups", {
      method: "POST",
      data,
    });
  },

  async updateSessionGroup(this: ApiContext, groupId: string, data: { name: string }) {
    return await this._request(`/session-groups/${groupId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteSessionGroup(this: ApiContext, groupId: string) {
    return await this._request(`/session-groups/${groupId}`, {
      method: "DELETE",
    });
  },

  async reorderSessionGroups(this: ApiContext, groupIds: string[]) {
    return await this._request("/session-groups/reorder", {
      method: "POST",
      data: { groupIds },
    });
  },

  async generateSessionTitle(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/generate-title`, {
      method: "POST",
    });
  },

  async compressSession(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/compress`, {
      method: "POST",
    });
  },

  async fetchSessionSummaries(this: ApiContext, sessionId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return await this._request(`/sessions/${sessionId}/summaries${params}`, {
      method: "GET",
    });
  },

  async updateSummary(this: ApiContext, summaryId: string, data: { summaryContent?: string }) {
    return await this._request(`/sessions/summaries/${summaryId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteSummary(this: ApiContext, summaryId: string) {
    return await this._request(`/sessions/summaries/${summaryId}`, {
      method: "DELETE",
    });
  },

  async fetchSessionTokenStats(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/token-stats`);
  },

  async getWorkspacePath(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/workspace-path`);
  },

  async updateSessionWorkspacePath(this: ApiContext, sessionId: string, workspacePath: string) {
    return await this._request(`/sessions/${sessionId}/workspace-path`, {
      method: "PUT",
      data: { workspacePath },
    });
  },

  async getSessionPlan(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/plan`);
  },
};
