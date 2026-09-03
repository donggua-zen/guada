/**
 * 流式对话服务
 * 封装 chat 流式生成器及相关取消/中止逻辑
 *
 * 支持多客户端订阅和断线重连：
 * - 刷新页面后可自动重新订阅到同一会话的活跃流
 * - 同一会话的多个窗口可以实时同步流式输出
 */

import { getClientId } from "@/utils/clientId";
import { t } from "@/locales";
import type { FileRef } from "@/types/stream/content-block.types";

/**
 * 流式对话参数
 */
export interface ChatStreamParams {
  sessionId: string;
  regenerationMode?: string | null;
  assistantMessageId?: string | null;
  resumeData?: any;
  // 用户消息参数
  // overwrite 模式：按需设置 content/files/replaceTurnId/knowledgeBaseIds，不设置 id
  // resume 模式：只需设置 id;resume 复用既有回合,另带 turnId(回合外壳 id,与消息 id 解耦)
  userMessage?: {
    id?: string;
    content?: string;
    /** 附件元数据（FileRef self-contained 契约，与上传响应同形状） */
    files?: FileRef[];
    replaceTurnId?: string;
    knowledgeBaseIds?: string[];
    /** 非新建回合模式(resume)复用既有回合时,前端传入回合外壳 id */
    turnId?: string;
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
  /**
   * 发起/续传流式对话(合并后为 RPC,不再持有 SSE 长连接)
   *
   * 合并后:POST /chat/stream 立即返回 200,流式事件经全局 SSE(UnifiedEvent)
   * → SessionEventsService → StreamEventHub 路由到前端增量组装。
   * 此处只负责触发后端启动流,并处理业务错误(会话不存在/忙碌/无活跃流)。
   */
  async chat(params: ChatStreamParams): Promise<void> {
    const {
      sessionId,
      regenerationMode = null,
      assistantMessageId = null,
      resumeData,
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
          userMessage,
        }),
        signal: controller.signal,
      });

      // 合并后:后端立即返回 JSON(不再是 SSE),只处理业务错误
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 409) {
          throw new Error(
            "SessionBusyError: " + (errorData.error || "Session is busy"),
          );
        }
        throw new Error(errorData.error || t("session.api.responseFailed", { status: response.status }));
      }
    } finally {
      this.abortControllerMap.delete(sessionId);
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

}
