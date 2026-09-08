import type { ApiContext } from "./api-context";
import type { Session, SessionGroup, SessionListResponse, SearchSessionResponse, SidebarSessionsResponse } from "@/types/session";

export interface SessionApi {
  createSession(data: any): Promise<Session>;
  deleteSession(sessionId: string, deleteWorkspace?: boolean): Promise<{ success: boolean }>;
  fetchSession(sessionId: string): Promise<Session>;
  fetchSessions(skip?: number, limit?: number, groupId?: string | null, keyword?: string, includeArchived?: boolean): Promise<SessionListResponse>;
  fetchSidebarSessions(limit?: number): Promise<SidebarSessionsResponse>;
  fetchArchivedSessions(skip?: number, limit?: number, keyword?: string, groupId?: string | null): Promise<SessionListResponse>;
  searchSessions(keyword: string, cursor?: string, limit?: number, includeArchived?: boolean): Promise<SearchSessionResponse>;
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
  getWorkspacePath(sessionId: string): Promise<{ workspacePath: string }>;
  getSessionTodo(sessionId: string): Promise<{ items: Array<{ content: string; status: string }> }>;
  getSessionProcesses(sessionId: string): Promise<{ processes: UiProcessInfo[] }>;
  killSessionProcess(sessionId: string, processId: string): Promise<{ success: boolean; status: string }>;
  getSessionProcessLog(sessionId: string, processId: string, tailBytes?: number): Promise<UiProcessLog>;
  getWorkflowRuns(sessionId: string): Promise<{ runs: import("@/types/stream/workflow.types").WorkflowRunState[] }>;
}

/** 后台进程条目（GET /sessions/:id/processes 返回） */
export interface UiProcessInfo {
  id: string;
  command: string;
  status: string;
  sessionId: string;
  isBackgrounded: boolean;
  startedAt: string;
  finishedAt?: string;
}

/** 后台进程日志尾部（GET /sessions/:id/processes/:pid/log 返回） */
export interface UiProcessLog {
  processId: string;
  command: string;
  status: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  size: number;
  truncated: boolean;
  content: string;
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

  async fetchSidebarSessions(this: ApiContext, limit?: number) {
    const url = limit ? `/sessions/sidebar?limit=${limit}` : "/sessions/sidebar";
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

  async searchSessions(this: ApiContext, keyword: string, cursor?: string, limit?: number, includeArchived?: boolean) {
    const params = new URLSearchParams();
    params.append("keyword", keyword);
    if (cursor) params.append("cursor", cursor);
    if (limit) params.append("limit", limit.toString());
    if (includeArchived) params.append("includeArchived", "true");
    return await this._request(`/sessions/search?${params.toString()}`);
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

  async getWorkspacePath(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/workspace-path`);
  },

  async getSessionTodo(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/todo`);
  },

  async getSessionProcesses(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/processes`);
  },

  async killSessionProcess(this: ApiContext, sessionId: string, processId: string) {
    return await this._request(`/sessions/${sessionId}/processes/${processId}/kill`, {
      method: "POST",
    });
  },

  async getSessionProcessLog(this: ApiContext, sessionId: string, processId: string, tailBytes?: number) {
    const query = tailBytes ? `?tail=${tailBytes}` : "";
    return await this._request(`/sessions/${sessionId}/processes/${processId}/log${query}`);
  },

  async getWorkflowRuns(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/workflow/runs`);
  },
};
