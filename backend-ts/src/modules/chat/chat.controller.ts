import {
  Controller,
  Post,
  Body,
  Sse,
  MessageEvent,
  UseGuards,
  Res,
  Req,
  Get,
  Param,
  Logger,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AgentEngine } from "./agent-engine.service";
import { SessionService } from "./session.service";
import { MessageService } from "./message.service";
import { MessageRepository } from "../../common/database/message.repository";
import { Observable, Subscription } from "rxjs";
import { Response, Request } from "express";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private agentEngine: AgentEngine,
    private sessionService: SessionService,
    private messageService: MessageService,
    private messageRepo: MessageRepository,
    private streamManager: SessionStreamManager,
    private sessionEventsService: SessionEventsService,
  ) {}

  @Sse("completions")
  async completions(
    @Body()
    body: {
      sessionId: string;
      messageId: string;
      regenerationMode?: string; // 再生模式：'overwrite' | 'multi_version' | 'resume'
      assistantMessageId?: string; // 现有助手消息 ID
      resumeData?: any; // 【新增】断点续传数据（如审批决策）
    },
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const {
      sessionId,
      messageId,
      regenerationMode = "overwrite", // 默认 overwrite 模式
      assistantMessageId,
      resumeData, // 【新增】
    } = body;
    const session = await this.sessionService.getSessionById(
      sessionId,
      user.id,
    );

    // 创建 AbortController 用于中断 LLM 请求
    const abortController = new AbortController();

    // 监听客户端断开连接事件
    req.on("close", () => {
      if (!req.complete) {
        console.log("Client disconnected, aborting LLM request");
        abortController.abort();
      }
    });

    // 将 AgentService 的 AsyncGenerator 转换为 RxJS Observable
    return new Observable((observer) => {
      const iterator = this.agentEngine.completions(
        session,
        messageId,
        regenerationMode, // 传递再生模式
        assistantMessageId, // 传递现有助手消息 ID
        abortController.signal, // 传递中断信号
        resumeData, // 【新增】传递断点续传数据
      );

      let isCompleted = false;

      const push = async () => {
        if (isCompleted) return;

        try {
          const { value, done } = await iterator.next();
          if (done) {
            isCompleted = true;
            observer.next({ data: "[DONE]" });
            observer.complete();
          } else {
            observer.next({ data: JSON.stringify(value) });
            push();
          }
        } catch (error: any) {
          isCompleted = true;
          if (error.name === "AbortError") {
            console.log("LLM request aborted due to client disconnect");
            observer.complete();
          } else {
            observer.error(error);
          }
        }
      };

      push();

      // 清理函数：当 Observable 被取消订阅时中断请求
      return () => {
        if (!isCompleted) {
          console.log("Observable unsubscribed, aborting LLM request");
          abortController.abort();
        }
      };
    });
  }

  /**
   * 流式生成消息响应
   *
   * 支持多客户端订阅同一会话的流式输出：
   * - 如果会话已有活跃流，新客户端将订阅已有流并接收历史缓冲事件
   * - 如果会话没有活跃流，将启动新的 Agent 循环
   * - 客户端断开连接不会中止 Agent 循环，仅取消该客户端的订阅
   */
  @Post("stream")
  async streamMessage(
    @Body()
    body: {
      sessionId: string;
      assistantMessageId?: string;
      regenerationMode?: string;
      resumeData?: any;
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
    },
    @CurrentUser() user: any,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    let {
      sessionId,
      assistantMessageId,
      regenerationMode = "overwrite",
      resumeData,
      userMessage,
    } = body;
    let createdUserMessage: any = null;

    // 通过 regenerationMode 区分发起模式和订阅模式
    const isSubscribeMode = regenerationMode === "subscribe";

    const session = await this.sessionService.getSessionById(
      sessionId,
      user.id,
    );

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 生成唯一订阅者 ID
    const subscriberId = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const hasActiveStream = this.streamManager.hasActiveStream(sessionId);

    // 发起模式：如果已有活跃流，直接报错，不允许自动加入订阅
    if (!isSubscribeMode && hasActiveStream) {
      if (!res.writableEnded) {
        res.status(409).json({
          error: "当前已有任务正在进行，请等待结束",
          code: "SESSION_BUSY",
        });
      }
      return;
    }

    // 订阅模式：如果没有活跃流，直接报错（前端可忽略此错误）
    if (isSubscribeMode && !hasActiveStream) {
      if (!res.writableEnded) {
        res.status(409).json({
          error: "No active stream to subscribe",
          code: "NO_ACTIVE_STREAM",
        });
      }
      return;
    }

    // overwrite 模式下自动创建消息
    if (regenerationMode === "overwrite" || !regenerationMode) {
      if (!userMessage?.content) {
        if (!res.writableEnded) {
          res.status(400).json({
            error: "缺少消息内容",
            code: "MISSING_CONTENT",
          });
        }
        return;
      }
      try {
        const message = await this.messageService.addMessage(
          sessionId,
          "user",
          userMessage.content,
          userMessage.files || [],
          userMessage.replaceMessageId,
          userMessage.knowledgeBaseIds,
          user.id,
        );
        createdUserMessage = message;
      } catch (error: any) {
        this.logger.error(`Failed to create message for stream:`, error);
        if (!res.writableEnded) {
          res.status(500).json({
            error: "创建消息失败: " + (error.message || "Unknown error"),
            code: "MESSAGE_CREATE_FAILED",
          });
        }
        return;
      }
    }

    // 情况 1: 该会话已有活跃流，加入订阅
    if (hasActiveStream) {
      const unsubscribe = this.streamManager.subscribe(
        sessionId,
        subscriberId,
        (data) => {
          if (!res.writableEnded) {
            res.write(`data: ${data}\n\n`);
          }
        },
        () => {
          if (!res.writableEnded) {
            res.write("data: [DONE]\n\n");
            res.end();
          }
        },
        () => {
          if (!res.writableEnded) {
            res.end();
          }
        },
      );
      if (!unsubscribe) {
        if (!res.writableEnded) {
          res.status(409).json({ error: "Stream not available" });
        }
        return;
      }

      // 客户端断开时仅取消订阅，不中止流
      const handleClose = () => {
        unsubscribe();
        if (!res.writableEnded) {
          res.end();
        }
      };
      req.on("close", handleClose);
      res.on("close", handleClose);

      return;
    }

    // 情况 2: 该会话没有活跃流，需要启动新流
    const abortController = new AbortController();

    // 启动流式任务
    const started = this.streamManager.startStream(
      sessionId,
      user.id,
      abortController,
      assistantMessageId || null,
    );
    if (!started) {
      if (!res.writableEnded) {
        res.status(409).json({ error: "Session is busy" });
      }
      return;
    }

    // 将自己作为第一个订阅者
    const unsubscribe = this.streamManager.subscribe(
      sessionId,
      subscriberId,
      (data) => {
        if (!res.writableEnded) {
          res.write(`data: ${data}\n\n`);
        }
      },
      () => {
        if (!res.writableEnded) {
          res.write("data: [DONE]\n\n");
          res.end();
        }
      },
      (err) => {
        this.logger.error(`Stream error for ${sessionId}:`, err);
        if (!res.writableEnded) {
          res.end();
        }
      },
    )!;

    // 客户端断开时仅取消订阅，不中止 Agent 循环
    const handleClose = () => {
      unsubscribe();
      if (!res.writableEnded) {
        res.end();
      }
    };
    req.on("close", handleClose);
    res.on("close", handleClose);
    // 广播流开始事件（带 source 标识，前端可识别是否自身发起）
    this.sessionEventsService.broadcastToUser(user.id, {
      type: "stream_started",
      userId: user.id,
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        messageId: createdUserMessage?.id || userMessage?.id,
        source: subscriberId,
        replaceMessageId: userMessage?.replaceMessageId || null,
      },
    });

    // 如果有用户消息，广播给所有流订阅者
    if (createdUserMessage) {
      this.streamManager.broadcast(sessionId, {
        type: "user_message",
        message: createdUserMessage,
      });
    }
    // 在后台启动 Agent 循环
    this.runAgentEngine(
      sessionId,
      session,
      userMessage.id || createdUserMessage?.id,
      regenerationMode,
      assistantMessageId,
      abortController,
      user.id,
      resumeData,
    ).catch((error) => {
      this.logger.error(`Agent engine error for ${sessionId}:`, error);
      this.streamManager.broadcast(sessionId, {
        type: "error",
        error: error.message,
      });
      this.streamManager.stopStream(sessionId, "error");
    });
  }

  /**
   * 后台运行 Agent Engine，将事件广播到所有订阅者
   */
  private async runAgentEngine(
    sessionId: string,
    session: any,
    userMessageId: string,
    regenerationMode: string,
    assistantMessageId: string | null,
    abortController: AbortController,
    userId: string,
    resumeData?: any,
  ): Promise<void> {
    console.log("userMessageId", userMessageId);
    try {
      const iterator = this.agentEngine.completions(
        session,
        userMessageId,
        regenerationMode,
        assistantMessageId,
        abortController.signal,
        resumeData,
      );
      for await (const chunk of iterator) {
        this.streamManager.broadcast(sessionId, chunk);
      }

      this.streamManager.broadcast(sessionId, { type: "finish" });
      this.streamManager.stopStream(sessionId, "completed");

      // 广播流结束事件
      this.sessionEventsService.broadcastToUser(userId, {
        type: "stream_finished",
        userId: userId,
        sessionId,
        timestamp: new Date().toISOString(),
        payload: { reason: "completed" },
      });
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.logger.log(`Stream ${sessionId} aborted by user`);
        this.streamManager.stopStream(sessionId, "user_cancel");

        // 广播流结束事件（用户取消）
        this.sessionEventsService.broadcastToUser(userId, {
          type: "stream_finished",
          userId: userId,
          sessionId,
          timestamp: new Date().toISOString(),
          payload: { reason: "user_cancel" },
        });
      } else {
        // 广播流结束事件（错误）
        this.sessionEventsService.broadcastToUser(userId, {
          type: "stream_finished",
          userId: userId,
          sessionId,
          timestamp: new Date().toISOString(),
          payload: { reason: "error", error: error.message },
        });
        throw error;
      }
    }
  }

  /**
   * 手动停止会话流
   */
  @Post("stream/:sessionId/stop")
  async stopStream(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
  ) {
    const status = this.streamManager.getStreamStatus(sessionId);

    if (!status?.isRunning) {
      return { success: false, message: "No active stream" };
    }

    this.streamManager.stopStream(sessionId, "user_cancel");
    return { success: true };
  }

  /**
   * 查询会话流状态
   */
  @Get("stream/:sessionId/status")
  async getStreamStatus(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: any,
  ) {
    await this.sessionService.getSessionById(sessionId, user.id);
    return (
      this.streamManager.getStreamStatus(sessionId) || {
        isRunning: false,
        subscriberCount: 0,
        bufferedEventCount: 0,
      }
    );
  }

  /**
   * 【新增】工具审批接口
   *
   * 前端调用此接口批量提交审批决策。
   * 审批后，前端需要重新发起流式请求，Agent 循环会检测到 approvalContext.decisions
   * 并根据每个工具的决策执行相应的操作（approved: 执行工具, rejected: 生成错误响应）。
   */
  @Post("approve-tools")
  async approveTools(
    @Body()
    body: {
      messageId: string; // 助手消息 ID
      decisions: Array<{
        // 所有需要审批的工具的决策
        toolCallId: string;
        decision: "approve" | "reject";
        reason?: string; // 拒绝原因（可选）
      }>;
    },
  ) {
    const { messageId, decisions } = body;

    // 验证消息存在，并获取当前的 content
    const message = await this.messageRepo.findById(messageId, {
      withContents: true,
      onlyCurrentContent: true,
    });

    if (!message || !message.contents || message.contents.length === 0) {
      throw new Error("Message not found");
    }

    // TODO: 验证消息属于当前用户
    // const session = await this.sessionService.getSessionById(message.sessionId, user.id);
    // if (!session) {
    //   throw new Error('Unauthorized');
    // }

    // 获取当前 content 的最后一个轮次（ReAct 循环中最新的一轮）
    const currentContent = message.contents[message.contents.length - 1];
    const metadata = (currentContent.metadata as any) || {};
    const approvalContext = metadata.approvalContext;

    if (!approvalContext || approvalContext.type !== "approval") {
      throw new Error("No pending approval context found");
    }

    if (approvalContext.status !== "pending") {
      throw new Error(`Approval already ${approvalContext.status}`);
    }

    // 验证决策数量匹配
    const pendingToolCallIds = approvalContext.pendingToolCallIds || [];
    if (decisions.length !== pendingToolCallIds.length) {
      throw new Error(
        `Expected ${pendingToolCallIds.length} decisions, got ${decisions.length}`,
      );
    }

    // 验证所有决策的工具 ID 都在 pendingToolCallIds 中
    const pendingIds = new Set(pendingToolCallIds);
    for (const decision of decisions) {
      if (!pendingIds.has(decision.toolCallId)) {
        throw new Error(`Invalid toolCallId: ${decision.toolCallId}`);
      }
    }

    // 更新审批状态和决策
    metadata.approvalContext = {
      ...approvalContext,
      status: "completed", // 标记为已完成
      decisions: decisions,
      updatedAt: new Date().toISOString(),
    };

    // 保存更新后的 content metadata
    await this.messageRepo.update(currentContent.id, { metadata });

    return {
      success: true,
      messageId,
      contentId: currentContent.id,
      decisionsCount: decisions.length,
    };
  }
}
