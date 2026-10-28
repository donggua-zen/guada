import type { ApiContext } from "./api-context";
import type { Session } from "@/types/session";
import type { PaginatedResponse } from "@/types/common";
import type {
  BotInstance,
  PlatformMetadata,
  CreateBotRequest,
  UpdateBotRequest,
  BotChatGroupsResponse,
  BotSessionDetail,
  BotSendMessageRequest,
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
  /** 按拖拽结果重排机器人实例，返回后端落定后的顺序 */
  reorderBotInstances(orderedIds: string[]): Promise<{ id: string; sortOrder: number }[]>;
  fetchBotQrCode(id: string): Promise<
    | { status: 'qr_ready'; qrCodeUrl: string }
    | { status: 'verify_code_required'; message: string }
    | { status: 'logged_in' | 'pending' | 'unavailable'; message: string }
  >;
  submitBotVerification(id: string, code: string): Promise<{ success: boolean; message: string }>;
  logoutBot(id: string): Promise<{ success: boolean; message: string }>;
  deleteBotInstance(id: string): Promise<{ success: boolean }>;
  fetchBotSessions(skip?: number, limit?: number, botId?: string): Promise<PaginatedResponse<Session>>;
  /** 微信式会话工作台：按机器人 → 用户聚合 */
  fetchBotChatGroups(perBotLimit?: number): Promise<BotChatGroupsResponse>;
  /** 单个 Bot 会话详情（动态 enrich agent/model） */
  fetchBotSessionDetail(sessionId: string): Promise<BotSessionDetail>;
  /** 在 Bot 会话中续聊（本期仅本地会话，不回推 IM） */
  sendBotSessionMessage(
    sessionId: string,
    data: BotSendMessageRequest,
  ): Promise<{ ok: boolean; started?: boolean }>;
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

  async reorderBotInstances(this: ApiContext, orderedIds: string[]) {
    return await this._request("/bot-admin/instances/reorder", {
      method: "POST",
      data: { orderedIds },
    });
  },

  async fetchBotQrCode(this: ApiContext, id: string) {
    return await this._request(`/bot-admin/instances/${id}/qr`);
  },

  async submitBotVerification(this: ApiContext, id: string, code: string) {
    return await this._request(`/bot-admin/instances/${id}/verification`, {
      method: 'POST',
      data: { code },
    });
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

  async fetchBotChatGroups(this: ApiContext, perBotLimit?: number) {
    const query =
      perBotLimit !== undefined ? `?perBotLimit=${perBotLimit}` : "";
    return await this._request(`/bot-admin/chat-groups${query}`);
  },

  async fetchBotSessionDetail(this: ApiContext, sessionId: string) {
    return await this._request(`/bot-admin/sessions/${sessionId}`);
  },

  async sendBotSessionMessage(
    this: ApiContext,
    sessionId: string,
    data: BotSendMessageRequest,
  ) {
    return await this._request(`/bot-admin/sessions/${sessionId}/messages`, {
      method: "POST",
      data,
    });
  },
};
