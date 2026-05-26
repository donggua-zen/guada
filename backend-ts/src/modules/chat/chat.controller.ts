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
  HttpException,
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
import { ChatRunnerService } from "./chat-runner.service";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private agentEngine: AgentEngine,
    private sessionService: SessionService,
    private messageRepo: MessageRepository,
    private streamManager: SessionStreamManager,
    private chatRunner: ChatRunnerService,
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
    const {
      sessionId,
      assistantMessageId,
      regenerationMode = "overwrite",
      resumeData,
      userMessage,
    } = body;

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 定义回调函数，将流事件写入 HTTP 响应
    const callbacks = {
      onEvent: (data: string) => {
        if (!res.writableEnded) {
          res.write(`data: ${data}\n\n`);
        }
      },
      onComplete: () => {
        if (!res.writableEnded) {
          res.write("data: [DONE]\n\n");
          res.end();
        }
      },
      onError: (err: any) => {
        this.logger.error(`Stream error for ${sessionId}:`, err);
        if (!res.writableEnded) {
          res.end();
        }
      },
    };

    // 调用 ChatRunnerService 处理全部业务逻辑
    try {
      const unsubscribe = await this.chatRunner.startStream(
        {
          sessionId,
          userId: user.id,
          userMessage,
          regenerationMode,
          assistantMessageId: assistantMessageId || null,
          resumeData,
        },
        callbacks,
      );

      // 客户端断开时取消订阅
      const handleClose = () => {
        unsubscribe();
        if (!res.writableEnded) {
          res.end();
        }
      };
      req.on("close", handleClose);
      res.on("close", handleClose);
    } catch (error: any) {
      if (error instanceof HttpException) {
        const response = error.getResponse() as any;
        const status = error.getStatus();
        if (!res.writableEnded) {
          res.status(status).json(response);
        }
      } else {
        this.logger.error(`启动流失败:`, error);
        if (!res.writableEnded) {
          res.status(500).json({
            error: error.message || "启动流失败",
            code: "STREAM_START_FAILED",
          });
        }
      }
    }
  }

  /**
   * 手动停止会话流
   */
  @Post("stream/:sessionId/stop")
  async stopStream(
    @Param("sessionId") sessionId: string,
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
