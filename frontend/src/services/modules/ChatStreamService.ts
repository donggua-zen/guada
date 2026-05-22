/**
 * 流式对话服务
 * 封装 chat 流式生成器及相关取消/中止逻辑
 */

import type { StreamEvent } from "@/types/service";

export class ChatStreamService {
  private abortControllerMap: Map<string, AbortController>;

  constructor(private getBaseURL: () => string) {
    this.abortControllerMap = new Map();
  }

  /**
   * 流式对话生成器
   */
  async *chat(
    sessionId: string,
    messageId: string,
    regenerationMode: string | null = null,
    assistantMessageId: string | null = null,
    enableReasoning: boolean = false,
    resumeData?: any,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    try {
      this.cancelResponse(sessionId);
      const controller = new AbortController();
      this.abortControllerMap.set(sessionId, controller);
      // 优先从 localStorage 读取（记住我），否则使用 sessionStorage
      const accessToken =
        localStorage.getItem("token") || sessionStorage.getItem("token");

      const response = await fetch(`${this.getBaseURL()}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId: sessionId,
          messageId: messageId,
          assistantMessageId: assistantMessageId,
          regenerationMode: regenerationMode,
          stream: true,
          enableReasoning: enableReasoning,
          resumeData: resumeData,
        }),
        signal: controller.signal,
      });

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
    } finally {
      this.abortControllerMap.delete(sessionId);
    }
  }

  /**
   * 取消指定会话的响应
   */
  async cancelResponse(sessionId: string): Promise<void> {
    const abortController = this.abortControllerMap.get(sessionId);
    if (abortController) {
      abortController.abort();
    }
  }
}
