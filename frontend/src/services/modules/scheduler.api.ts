import type { ApiContext } from "./api-context";
import type { PaginatedResponse } from "@/types/common";

export interface SchedulerApi {
  fetchScheduledTasks(): Promise<PaginatedResponse<any>>;
  fetchScheduledTask(taskId: string): Promise<any>;
  createScheduledTask(data: any): Promise<any>;
  updateScheduledTask(taskId: string, data: any): Promise<any>;
  deleteScheduledTask(taskId: string): Promise<void>;
  toggleScheduledTask(taskId: string): Promise<any>;
  runScheduledTask(taskId: string): Promise<{ success: boolean; message: string }>;
  testScheduledTask(taskId: string): Promise<{ success: boolean; message: string }>;
  fetchScheduledTaskLogs(taskId: string): Promise<PaginatedResponse<any>>;
  fetchCronPresets(): Promise<{ label: string; value: string }[]>;
}

export const schedulerApi: SchedulerApi = {
  async fetchScheduledTasks(this: ApiContext) {
    return await this._request("/scheduler/tasks");
  },

  async fetchScheduledTask(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}`);
  },

  async createScheduledTask(this: ApiContext, data: any) {
    return await this._request("/scheduler/tasks", { method: "POST", data });
  },

  async updateScheduledTask(this: ApiContext, taskId: string, data: any) {
    return await this._request(`/scheduler/tasks/${taskId}`, {
      method: "PUT",
      data,
    });
  },

  async deleteScheduledTask(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}`, {
      method: "DELETE",
    });
  },

  async toggleScheduledTask(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}/toggle`, {
      method: "POST",
    });
  },

  async runScheduledTask(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}/run`, {
      method: "POST",
    });
  },

  async testScheduledTask(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}/test`, {
      method: "POST",
    });
  },

  async fetchScheduledTaskLogs(this: ApiContext, taskId: string) {
    return await this._request(`/scheduler/tasks/${taskId}/logs`);
  },

  async fetchCronPresets(this: ApiContext) {
    return await this._request("/scheduler/cron-presets");
  },
};
