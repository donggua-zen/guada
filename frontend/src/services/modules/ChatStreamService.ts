/**
 * 流式对话服务
 * 封装 chat 流式生成器及相关取消/中止逻辑
 *
 * 支持多客户端订阅和断线重连：
 * - 刷新页面后可自动重新订阅到同一会话的活跃流
 * - 同一会话的多个窗口可以实时同步流式输出
 */

import type { StreamEvent } from "@/types/service";
import { getClientId } from "@/utils/clientId";

/**
 * 流式对话参数
 */
export interface ChatStreamParams {
  sessionId: string;
  regenerationMode?: string | null;
  assistantMessageId?: string | null;
  resumeData?: any;
  lastContentId?: string | null;
  // 用户消息参数
  // overwrite 模式：按需设置 content/files/replaceMessageId/knowledgeBaseIds，不设置 id
  // multi_version/resume/subscribe 模式：只需设置 id
  userMessage?: {
    id?: string;
    content?: string;
    files?: string[];
    replaceMessageId?: string;
    knowledgeBaseIds?: string[];
  };
}

export class ChatStreamService {
  private abortControllerMap: Map<string, AbortController>;

  constructor(private getBaseURL: () => string) {
    this.abortControllerMap = new Map();
  }

  /**
   * 获取访问令牌
   */
  private getAccessToken(): string | null {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
  }

  /**
   * 流式对话生成器
   *
   * 支持两种模式：
   * - 发起模式（默认）：regenerationMode 不为 'subscribe'，如果会话已有活跃流则报错
   * - 订阅模式：regenerationMode === 'subscribe'，订阅已有流（用于刷新重连/多窗口观察）
   *
   * 通过 regenerationMode 参数区分，避免竞态条件（不先 check 再请求，而是直接带 regenerationMode 请求）。
   */
  async *chat(params: ChatStreamParams): AsyncGenerator<StreamEvent, void, unknown> {
    const {
      sessionId,
      regenerationMode = null,
      assistantMessageId = null,
      resumeData,
      lastContentId,
      userMessage,
    } = params;

    const isSubscribeMode = regenerationMode === "subscribe";

    try {
      // 发起模式时先取消同一会话的本地 fetch，避免重复连接
      if (!isSubscribeMode) {
        this.cancelLocalFetch(sessionId);
      }

      const controller = new AbortController();
      this.abortControllerMap.set(sessionId, controller);

      const accessToken = this.getAccessToken();

      const response = await fetch(`${this.getBaseURL()}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({
          sessionId,
          assistantMessageId,
          regenerationMode,
          stream: true,
          resumeData,
          lastContentId,
          userMessage,
        }),
        signal: controller.signal,
      });

      yield* this.parseStream(response, sessionId);
    } finally {
      this.abortControllerMap.delete(sessionId);
    }
  }

  /**
   * 解析 SSE 流
   */
  private async *parseStream(
    response: Response,
    sessionId: string,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    // 检查响应头中的 Content-Type
    const contentType = response.headers.get("Content-Type");

    if (contentType && contentType.includes("application/json")) {
      const errorData = await response.json();
      if (response.status === 409) {
        throw new Error(
          "SessionBusyError: " + (errorData.error || "Session is busy"),
        );
      }
      throw new Error(errorData.error || `获取响应失败：${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 1);

          if (line === "data: [DONE]") return;

          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.substring(6));
              yield json as StreamEvent;
            } catch (e) {
              console.error("JSON 解析失败:", e, line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 取消本地 fetch 请求（不通知后端停止）
   */
  private cancelLocalFetch(sessionId: string): void {
    const abortController = this.abortControllerMap.get(sessionId);
    if (abortController) {
      abortController.abort();
    }
  }

  /**
   * 取消指定会话的响应
   *
   * 只通知后端停止 Agent 循环，不中断本地 fetch。
   * 后端会发送 finish 事件后自然关闭 SSE 流，前端能正确收到最终状态。
   */
  async cancelResponse(sessionId: string): Promise<void> {
    try {
      const accessToken = this.getAccessToken();
      await fetch(`${this.getBaseURL()}/chat/stream/${sessionId}/stop`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Client-Id": getClientId(),
        },
      });
    } catch (error) {
      console.error("Failed to stop stream:", error);
      // 后端 stop 请求失败时，降级为本地中止
      this.cancelLocalFetch(sessionId);
    }
  }

  /**
   * 发送消息（不接收 SSE 流）
   *
   * 用于非活动会话的队列消息发送：只创建用户消息并启动 Agent 循环。
   * 前端通过全局 stream_started/stream_finished 事件感知状态。
   */
  async sendMessage(params: {
    sessionId: string;
    content: string;
    fileIds?: string[];
    knowledgeBaseIds?: string[];
    replaceMessageId?: string;
  }): Promise<{ success: boolean }> {
    const accessToken = this.getAccessToken();
    const response = await fetch(`${this.getBaseURL()}/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Client-Id": getClientId(),
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 409) {
        throw new Error(
          "SessionBusyError: " + (errorData.error || "Session is busy"),
        );
      }
      throw new Error(errorData.error || `发送失败: ${response.status}`);
    }

    return response.json();
  }
}
