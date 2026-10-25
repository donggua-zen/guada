import type { ApiContext } from "./api-context";
import type { UserQueueSnapshot } from "@/types/session";

/**
 * 会话级用户输入队列（M3：队列所有权在后端）
 *
 * 所有写操作返回最新全量快照；前端整块替换本地投影，
 * 同时 SSE "queue_updated" 也会推送同一份快照（revision 去重）。
 */
export interface SessionQueueApi {
  fetchSessionQueue(sessionId: string): Promise<UserQueueSnapshot>;
  removeSessionQueueItem(
    sessionId: string,
    itemId: string,
  ): Promise<UserQueueSnapshot>;
  sendSessionQueueItemNow(
    sessionId: string,
    itemId: string,
  ): Promise<UserQueueSnapshot>;
  reorderSessionQueue(
    sessionId: string,
    itemId: string,
    direction: -1 | 1,
  ): Promise<UserQueueSnapshot>;
  pauseSessionQueue(sessionId: string): Promise<UserQueueSnapshot>;
  resumeSessionQueue(sessionId: string): Promise<UserQueueSnapshot>;
}

export const sessionQueueApi: SessionQueueApi = {
  async fetchSessionQueue(this: ApiContext, sessionId: string) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue`,
    );
  },

  async removeSessionQueueItem(
    this: ApiContext,
    sessionId: string,
    itemId: string,
  ) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue/${itemId}`,
      { method: "DELETE" },
    );
  },

  async sendSessionQueueItemNow(
    this: ApiContext,
    sessionId: string,
    itemId: string,
  ) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue/${itemId}/send-now`,
      { method: "POST" },
    );
  },

  async reorderSessionQueue(
    this: ApiContext,
    sessionId: string,
    itemId: string,
    direction: -1 | 1,
  ) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue/reorder`,
      { method: "POST", data: { itemId, direction } },
    );
  },

  async pauseSessionQueue(this: ApiContext, sessionId: string) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue/pause`,
      { method: "POST" },
    );
  },

  async resumeSessionQueue(this: ApiContext, sessionId: string) {
    return await this._request<UserQueueSnapshot>(
      `/sessions/${sessionId}/queue/resume`,
      { method: "POST" },
    );
  },
};
