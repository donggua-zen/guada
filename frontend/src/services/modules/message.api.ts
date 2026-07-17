import type { ApiContext } from "./api-context";
import type { Message } from "@/types/message";
import type { PaginatedResponse } from "@/types/common";

export interface MessageApi {
  fetchSessionMessages(
    sessionId: string,
    options?: {
      limit?: number;
      beforeMessageId?: string;
      afterMessageId?: string;
    },
  ): Promise<PaginatedResponse<Message>>;
  importMessages(sessionId: string, messages: any[]): Promise<any>;
  createMessage(
    sessionId: string,
    content: string,
    files?: any[],
    replaceMessageId?: string | null,
    knowledgeBaseIds?: string[],
  ): Promise<Message>;
  clearSessionMessages(sessionId: string): Promise<boolean>;
  deleteMessage(messageId: string): Promise<{ success: boolean }>;
  updateMessage(messageId: string, data: any): Promise<Message>;
  fetchMessageContentToolDetails(contentId: string): Promise<{
    toolCalls: any[];
    toolCallsResponse: any[];
  }>;
  copyMessageFile(messageId: string, fileId: string): Promise<any>;
  webSearch(messageId: string): Promise<any>;
}

export const messageApi: MessageApi = {
  async fetchSessionMessages(
    this: ApiContext,
    sessionId: string,
    options?: {
      limit?: number;
      beforeMessageId?: string;
      afterMessageId?: string;
    },
  ) {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.append("limit", options.limit.toString());
    if (options?.beforeMessageId) params.append("beforeMessageId", options.beforeMessageId);
    if (options?.afterMessageId) params.append("afterMessageId", options.afterMessageId);

    const queryString = params.toString();
    const url = queryString
      ? `/sessions/${sessionId}/messages?${queryString}`
      : `/sessions/${sessionId}/messages`;

    return await this._request(url);
  },

  async importMessages(this: ApiContext, sessionId: string, messages: any[]) {
    return await this._request(`/sessions/${sessionId}/messages/import`, {
      method: "POST",
      data: messages,
    });
  },

  async createMessage(
    this: ApiContext,
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[],
  ) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: "POST",
      data: {
        content,
        files,
        replaceMessageId: replaceMessageId,
        knowledgeBaseIds: knowledgeBaseIds,
      },
    });
  },

  async clearSessionMessages(this: ApiContext, sessionId: string) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: "DELETE",
    });
  },

  async deleteMessage(this: ApiContext, messageId: string) {
    return await this._request(`/messages/${messageId}`, { method: "DELETE" });
  },

  async updateMessage(this: ApiContext, messageId: string, data: any) {
    return await this._request(`/messages/${messageId}`, {
      method: "PUT",
      data,
    });
  },

  async fetchMessageContentToolDetails(this: ApiContext, contentId: string) {
    return await this._request(`/message-content/${contentId}/tool-details`);
  },

  async copyMessageFile(this: ApiContext, messageId: string, fileId: string) {
    return await this._request(`/files/${fileId}`, {
      method: "PUT",
      data: { type: "copy", messageId: messageId },
    });
  },

  async webSearch(this: ApiContext, messageId: string) {
    return await this._request(`/messages/${messageId}/web_search`, {
      method: "GET",
    });
  },
};
