import type { ApiContext } from "./api-context";
import type { Session, SessionGroup, SessionListResponse, SearchSessionResponse, SidebarSessionsResponse, SidebarProjectSessionsResponse, ProjectGroup, GroupStats, ArchiveSessionGroupResult, ArchiveProjectGroupResult, DeleteProjectGroupResult, CreateSessionRequest, UpdateSessionRequest, SessionPlanItem } from "@/types/session";

export interface SessionApi {
  createSession(data: CreateSessionRequest): Promise<Session>;
  /** 分支会话：以指定回合（助手消息所在回合）为节点完整复制源会话 */
  branchSession(sessionId: string, data: { turnId: string; title?: string }): Promise<Session>;
  deleteSession(sessionId: string, deleteWorkspace?: boolean): Promise<{ success: boolean }>;
  fetchSession(sessionId: string): Promise<Session>;
  /** 计划历史（转录构建：身份 = ExitPlanMode toolCallId，含状态与正文；「计划」面板用） */
  fetchSessionPlans(sessionId: string): Promise<{ plans: SessionPlanItem[] }>;
  fetchSessions(skip?: number, limit?: number, groupId?: string | null, keyword?: string, includeArchived?: boolean, projectGroupId?: string): Promise<SessionListResponse>;
  /** 侧边栏批量加载；groupBy='workspace' 时返回目录分组（含虚拟「通用」桶） */
  fetchSidebarSessions(limit?: number, groupBy?: 'group' | 'workspace'): Promise<SidebarSessionsResponse | SidebarProjectSessionsResponse>;
  /** 目录分组清单（按 position 升序） */
  fetchProjectGroups(): Promise<ProjectGroup[]>;
  /** 手动注册项目目录 */
  createProjectGroup(path: string): Promise<ProjectGroup>;
  /** 置顶会话清单（侧边栏顶部「已置顶」分区；与分组区互斥） */
  fetchPinnedSessions(): Promise<{ items: Session[] }>;
  fetchArchivedSessions(skip?: number, limit?: number, keyword?: string, groupId?: string | null): Promise<SessionListResponse>;
  searchSessions(keyword: string, cursor?: string, limit?: number, includeArchived?: boolean): Promise<SearchSessionResponse>;
  archiveSession(sessionId: string, archived: boolean): Promise<{ success: boolean; session?: Session }>;
  batchArchiveSessions(sessionIds: string[], archived: boolean): Promise<{ success: boolean; skipped: string[] }>;
  updateSession(sessionId: string, data: UpdateSessionRequest): Promise<Session>;
  fetchSessionGroups(): Promise<SessionGroup[]>;
  createSessionGroup(data: { name: string; icon?: string | null }): Promise<SessionGroup>;
  updateSessionGroup(groupId: string, data: { name?: string; icon?: string | null }): Promise<SessionGroup>;
  deleteSessionGroup(groupId: string): Promise<{ success: boolean }>;
  reorderSessionGroups(groupIds: string[]): Promise<{ success: boolean }>;
  /** 手工分组统计（归档确认弹窗用） */
  fetchSessionGroupStats(groupId: string): Promise<GroupStats>;
  /** 归档本分组：归档组内全部对话（流式输出中的跳过，分组保留） */
  archiveSessionGroup(groupId: string): Promise<ArchiveSessionGroupResult>;
  /** 更新目录分组显示名和/或图标（不改磁盘目录） */
  updateProjectGroup(
    groupId: string,
    data: { name?: string; icon?: string | null },
  ): Promise<ProjectGroup>;
  /** 目录分组排序（需完整 id 集合） */
  reorderProjectGroups(groupIds: string[]): Promise<{ success: boolean }>;
  /** 项目统计（删除/归档确认弹窗用） */
  fetchProjectGroupStats(groupId: string): Promise<GroupStats>;
  /** 归档项目：归档其下全部对话（流式输出中的跳过） */
  archiveProjectGroup(groupId: string): Promise<ArchiveProjectGroupResult>;
  /** 删除项目：删除其下全部对话（工作目录与文件保留） */
  deleteProjectGroup(groupId: string): Promise<DeleteProjectGroupResult>;
  generateSessionTitle(sessionId: string): Promise<{ title: string; skipped?: boolean }>;
  























































































































































































































































  /**
   * 手动压缩会话上下文。
   * @param instructions `/compact <instructions>` 的附加指令：只拼进摘要提示词，不落库
   */
  compressSession(
    sessionId: string,
    instructions?: string,
  ): Promise<{ success: boolean; started: boolean }>;
  fetchSessionSummaries(
    sessionId: string,
    limit?: number,
  ): Promise<{ items: SessionSummaryItem[]; total: number }>;
  getWorkspacePath(sessionId: string): Promise<{ workspacePath: string }>;
  getSessionTodo(sessionId: string): Promise<{ items: Array<{ content: string; status: string }> }>;
  /** bootId = 后端进程启动标识：变化即 revision 语义重置（后端重启后 revision 归零） */
  getSessionJobs(
    sessionId: string,
  ): Promise<{ bootId: string; revision: number; jobs: UiJobInfo[] }>;
  killSessionJob(
    sessionId: string,
    jobId: string,
    reason?: string,
  ): Promise<{ success: boolean; outcome: string; status: string }>;
  getSessionJobOutput(
    sessionId: string,
    jobId: string,
    opts?: { offset?: number; maxBytes?: number },
  ): Promise<UiJobOutput>;
  getWorkflowRuns(sessionId: string): Promise<{ runs: import("@/types/stream/workflow.types").WorkflowRunState[] }>;
}

export type UiJobKind =
  | "shell"
  | "remote-shell"
  | "pty"
  | "subagent"
  | "workflow"
  | "scheduler";

export type UiJobStatus =
  | "running"
  | "stopping"
  | "completed"
  | "killed"
  | "failed"
  | "lost";

/** 后端 JobSnapshot 的前端形态（GET /sessions/:id/jobs + jobs_snapshot） */
export interface UiJobInfo {
  id: string;
  kind: UiJobKind;
  label: string;
  sessionId: string;
  status: UiJobStatus;
  detail?: string;
  handle?: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  logFilePath?: string;
  logSize?: number;
}

/** GET /sessions/:id/jobs/:jobId/output */
export interface UiJobOutput {
  jobId: string;
  text: string;
  offset: number;
  nextOffset: number;
  size: number;
  truncated: boolean;
  logFilePath?: string;
  status: UiJobStatus;
  exitCode: number | null;
}

/** 压缩历史条目（GET /sessions/:id/summaries，与后端 CompactionHistoryItem 同构） */
export interface SessionSummaryItem {
  /** 摘要括号 = summaryMessageId；纯裁剪 = `prune_<seq>` */
  id: string;
  createdAt: string;
  /** 摘要文本；纯裁剪为 null */
  summaryContent: string | null;
  shadowedCount: number;
  cleaningStrategy: "summarized" | "discarded" | "pruned_only";
  compressionStats: {
    beforeTokenCount?: number;
    afterTokenCount?: number;
  };
}

export const sessionApi: SessionApi = {
  async createSession(this: ApiContext, data: CreateSessionRequest) {
    return await this._request<Session>("/sessions", { method: "POST", data });
  },

  async branchSession(this: ApiContext, sessionId: string, data: { turnId: string; title?: string }) {
    return await this._request(`/sessions/${sessionId}/branch`, { method: "POST", data });
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

  async fetchSessionPlans(this: ApiContext, sessionId: string) {
    return await this._request<{ plans: SessionPlanItem[] }>(
      `/sessions/${sessionId}/plans`,
    );
  },

  async fetchSessions(this: ApiContext, skip?: number, limit?: number, groupId?: string | null, keyword?: string, includeArchived?: boolean, projectGroupId?: string) {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (groupId !== undefined) params.append("groupId", groupId === null ? "null" : groupId);
    if (keyword) params.append("keyword", keyword);
    if (includeArchived) params.append("includeArchived", "true");
    if (projectGroupId) params.append("projectGroupId", projectGroupId);

    const queryString = params.toString();
    const url = queryString ? `/sessions?${queryString}` : "/sessions";

    return await this._request(url);
  },

  async fetchSidebarSessions(this: ApiContext, limit?: number, groupBy?: 'group' | 'workspace') {
    const params = new URLSearchParams();
    if (limit) params.append("limit", limit.toString());
    if (groupBy && groupBy !== 'group') params.append("groupBy", groupBy);
    const queryString = params.toString();
    const url = queryString ? `/sessions/sidebar?${queryString}` : "/sessions/sidebar";
    return await this._request(url);
  },

  async fetchProjectGroups(this: ApiContext) {
    return await this._request<ProjectGroup[]>("/project-groups");
  },

  async createProjectGroup(this: ApiContext, projectPath: string) {
    return await this._request<ProjectGroup>("/project-groups", {
      method: "POST",
      data: { path: projectPath },
    });
  },

  async fetchPinnedSessions(this: ApiContext) {
    return await this._request<{ items: Session[] }>("/sessions/pinned");
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

  async updateSession(this: ApiContext, sessionId: string, data: UpdateSessionRequest) {
    return await this._request<Session>(`/sessions/${sessionId}`, {
      method: "PUT",
      data,
    });
  },

  async fetchSessionGroups(this: ApiContext) {
    return await this._request("/session-groups");
  },

  async createSessionGroup(this: ApiContext, data: { name: string; icon?: string | null }) {
    return await this._request("/session-groups", {
      method: "POST",
      data,
    });
  },

  async updateSessionGroup(
    this: ApiContext,
    groupId: string,
    data: { name?: string; icon?: string | null },
  ) {
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

  async fetchSessionGroupStats(this: ApiContext, groupId: string) {
    return await this._request<GroupStats>(`/session-groups/${groupId}/stats`);
  },

  async archiveSessionGroup(this: ApiContext, groupId: string) {
    return await this._request<ArchiveSessionGroupResult>(
      `/session-groups/${groupId}/archive`,
      { method: "POST" },
    );
  },

  async updateProjectGroup(
    this: ApiContext,
    groupId: string,
    data: { name?: string; icon?: string | null },
  ) {
    return await this._request<ProjectGroup>(`/project-groups/${groupId}`, {
      method: "PUT",
      data,
    });
  },

  async reorderProjectGroups(this: ApiContext, groupIds: string[]) {
    return await this._request("/project-groups/reorder", {
      method: "POST",
      data: { groupIds },
    });
  },

  async fetchProjectGroupStats(this: ApiContext, groupId: string) {
    return await this._request<GroupStats>(
      `/project-groups/${groupId}/stats`,
    );
  },

  async archiveProjectGroup(this: ApiContext, groupId: string) {
    return await this._request<ArchiveProjectGroupResult>(
      `/project-groups/${groupId}/archive`,
      { method: "POST" },
    );
  },

  async deleteProjectGroup(this: ApiContext, groupId: string) {
    return await this._request<DeleteProjectGroupResult>(
      `/project-groups/${groupId}`,
      { method: "DELETE" },
    );
  },

  async generateSessionTitle(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/generate-title`, {
      method: "POST",
    });
  },

  async compressSession(
    this: ApiContext,
    sessionId: string,
    instructions?: string,
  ) {
    return await this._request(`/sessions/${sessionId}/compress`, {
      method: "POST",
      data: instructions === undefined ? {} : { instructions },
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

  async getSessionJobs(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/jobs`);
  },

  async killSessionJob(
    this: ApiContext,
    sessionId: string,
    jobId: string,
    reason?: string,
  ) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    return await this._request(`/sessions/${sessionId}/jobs/${jobId}/kill${query}`, {
      method: "POST",
    });
  },

  async getSessionJobOutput(
    this: ApiContext,
    sessionId: string,
    jobId: string,
    opts?: { offset?: number; maxBytes?: number },
  ) {
    const params = new URLSearchParams();
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts?.maxBytes !== undefined) params.set("maxBytes", String(opts.maxBytes));
    const query = params.toString();
    return await this._request(
      `/sessions/${sessionId}/jobs/${jobId}/output${query ? `?${query}` : ""}`,
    );
  },

  async getWorkflowRuns(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/workflow/runs`);
  },
};
