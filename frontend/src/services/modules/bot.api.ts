import type { ApiContext } from "./api-context";
import type { Session } from "@/types/session";
import type { PaginatedResponse } from "@/types/common";
import type {
  BotInstance,
  PlatformMetadata,
  CreateBotRequest,
  UpdateBotRequest,
} from "@/types/bot";

export interface BotApi {
  fetchBotPlatforms(): Promise<PlatformMetadata[]>;
  fetchBotInstances(): Promise<BotInstance[]>;
  fetchBotInstance(id: string): Promise<BotInstance>;
  createBotInstance(data: CreateBotRequest): Promise<BotInstance>;
  updateBotInstance(id: string, data: UpdateBotRequest): Promise<BotInstance>;
  startBotInstance(id: string): Promise<{ success: boolean }>;
  stopBotInstance(id: string): Promise<{ success: boolean }>;
  restartBotInstance(id: string): Promise<{ success: boolean }>;
  fetchBotQrCode(id: string): Promise<
    | { status: 'qr_ready'; qrCodeUrl: string }
    | { status: 'logged_in' | 'pending' | 'unavailable'; message: string }
  >;
  logoutBot(id: string): Promise<{ success: boolean; message: string }>;
  deleteBotInstance(id: string): Promise<{ success: boolean }>;
  fetchBotSessions(skip?: number, limit?: number, botId?: string): Promise<PaginatedResponse<Session>>;
}

export const botApi: BotApi = {
  async fetchBotPlatforms(this: ApiContext) {
    return await this._request("/bot-admin/platforms");
  },

  async fetchBotInstances(this: ApiContext) {
    return await this._request("/bot-admin/instances");
  },

  async fetchBotInstance(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}`);
  },

  async createBotInstance(this: ApiContext, data: CreateBotRequest) {
    return await this._request("/bot-admin/instances", {
      method: "POST",
      data,
    });
  },

  async updateBotInstance(this: ApiContext, id: string, data: UpdateBotRequest) {
    return await this._request(`/bot-admin/instances/${id}`, {
      method: "PUT",
      data,
    });
  },

  async startBotInstance(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/start`, {
      method: "POST",
    });
  },

  async stopBotInstance(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/stop`, {
      method: "POST",
    });
  },

  async restartBotInstance(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/restart`, {
      method: "POST",
    });
  },

  async fetchBotQrCode(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/qr`);
  },

  async logoutBot(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/logout`, {
      method: 'POST',
    });
  },

  async deleteBotInstance(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}`, {
      method: "DELETE",
    });
  },

  async fetchBotSessions(this: ApiContext, skip?: number, limit?: number, botId?: string) {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());
    if (botId) params.append("botId", botId);

    const queryString = params.toString();
    const url = queryString
      ? `/bot-admin/sessions?${queryString}`
      : "/bot-admin/sessions";

    return await this._request(url);
  },
};
