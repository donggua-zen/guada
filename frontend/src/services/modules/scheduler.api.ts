import type { ApiContext } from "./api-context";
import type {
  CronPreset,
  ScheduledTask,
  ScheduledTaskLog,
  ScheduledTaskLogListResponse,
  ScheduledTaskListResponse,
  CreateTaskRequest,
  UpdateTaskRequest,
} from "@/types/scheduler";

export interface SchedulerApi {
  fetchScheduledTasks(): Promise<ScheduledTaskListResponse>;
  fetchScheduledTask(taskId: string): Promise<ScheduledTask>;
  createScheduledTask(data: CreateTaskRequest): Promise<ScheduledTask>;
  updateScheduledTask(taskId: string, data: UpdateTaskRequest): Promise<ScheduledTask>;
  deleteScheduledTask(taskId: string): Promise<void>;
  toggleScheduledTask(taskId: string): Promise<ScheduledTask>;
  runScheduledTask(taskId: string): Promise<{ success: boolean; message: string }>;
  testScheduledTask(taskId: string): Promise<{ success: boolean; message: string }>;
  fetchScheduledTaskLogs(taskId: string): Promise<ScheduledTaskLogListResponse>;
  fetchAllScheduledTaskLogs(
    cursor?: string,
    limit?: number,
  ): Promise<{ items: ScheduledTaskLog[]; hasMore: boolean; nextCursor: string | null }>;
  fetchCronPresets(): Promise<CronPreset[]>;
}

export const schedulerApi: SchedulerApi = {
  async fetchScheduledTasks(this: ApiContext) {
    return await this._request<ScheduledTaskListResponse>("/scheduler/tasks");
  },

  async fetchScheduledTask(this: ApiContext, taskId: string) {
    return await this._request<ScheduledTask>(`/scheduler/tasks/${taskId}`);
  },

  async createScheduledTask(this: ApiContext, data: CreateTaskRequest) {
    return await this._request<ScheduledTask>("/scheduler/tasks", { method: "POST", data });
  },

  async updateScheduledTask(this: ApiContext, taskId: string, data: UpdateTaskRequest) {
    return await this._request<ScheduledTask>(`/scheduler/tasks/${taskId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteScheduledTask(this: ApiContext, taskId: string) {
    return await this._request<void>(`/scheduler/tasks/${taskId}`, {
      method: "DELETE",
    });
  },

  async toggleScheduledTask(this: ApiContext, taskId: string) {
    return await this._request<ScheduledTask>(`/scheduler/tasks/${taskId}/toggle`, {
      method: "POST",
    });
  },

  async runScheduledTask(this: ApiContext, taskId: string) {
    return await this._request<{ success: boolean; message: string }>(`/scheduler/tasks/${taskId}/run`, {
      method: "POST",
    });
  },

  async testScheduledTask(this: ApiContext, taskId: string) {
    return await this._request<{ success: boolean; message: string }>(`/scheduler/tasks/${taskId}/test`, {
      method: "POST",
    });
  },

  async fetchScheduledTaskLogs(this: ApiContext, taskId: string) {
    return await this._request<ScheduledTaskLogListResponse>(`/scheduler/tasks/${taskId}/logs`);
  },

  async fetchAllScheduledTaskLogs(this: ApiContext, cursor?: string, limit?: number) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const query = params.toString();
    return await this._request<{ items: ScheduledTaskLog[]; hasMore: boolean; nextCursor: string | null }>(
      `/scheduler/logs${query ? `?${query}` : ""}`,
    );
  },

  async fetchCronPresets(this: ApiContext) {
    return await this._request<CronPreset[]>("/scheduler/cron-presets");
  },
};
