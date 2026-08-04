import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  Req,
  Get,
  Param,
  Logger,
  HttpException,
  HttpStatus,
  Headers,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

import { SessionService } from "./session.service";
import { MessageRepository } from "../../common/database/message.repository";
import { Response, Request } from "express";
import { SessionStreamManager } from "./session-stream.manager";
import { ChatRunnerService } from "./chat-runner.service";
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private sessionService: SessionService,
    private messageRepo: MessageRepository,
    private streamManager: SessionStreamManager,
    private chatRunner: ChatRunnerService,
    private tagParserPipeline: TagParserPipeline,
  ) {}

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
      regenerationMode?: string;
      resumeData?: any;
      lastContentId?: string | null;
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
    @Headers("x-client-id") clientId: string,
  ) {
    const {
      sessionId,
      regenerationMode = "overwrite",
      resumeData,
      lastContentId,
      userMessage,
    } = body;

    // 构建 source 对象（包含客户端 ID 和标签解析结果）
    const source: Record<string, any> = { clientId: clientId || null };

    // 如果需要解析标签，对用户消息内容进行解析
    if (userMessage?.content) {
      try {
        const parsed = await this.tagParserPipeline.parse(userMessage.content, {
          sessionId,
          userId: user.id,
        });
        if (parsed.content !== parsed.originalText) {
          source.parseResult = { content: parsed.content };
        }
      } catch (error: any) {
        this.logger.warn(
          `标签解析失败，使用原始内容: ${error?.message || error}`,
        );
      }
    }

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 定义回调函数，将流事件写入 HTTP 响应
    const callbacks = {
      onEvent: (data) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
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
          regenerationMode: regenerationMode || "overwrite",
          resumeData,
          lastContentId: lastContentId || null,
          source,
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
        this.logger.error(
          `启动流失败: ${error?.message || 'Unknown error'}`,
          error instanceof Error ? error.stack : JSON.stringify(error, null, 2),
        );
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
   *
   * 仅中止底层 LLM 请求，不直接关闭 SSE 连接。
   * Agent 引擎捕获中止后会生成 finish 事件并广播，
   * runAgentEngine 循环结束后才调用 stopStream 关闭流。
   * 这确保前端能收到完整的 finish 事件。
   */
  @Post("stream/:sessionId/stop")
  async stopStream(@Param("sessionId") sessionId: string) {
    const status = this.streamManager.getStreamStatus(sessionId);

    if (!status?.isRunning) {
      return { success: false, message: "No active stream" };
    }

    // 只中止底层 LLM 请求，不关闭流
    this.streamManager.abortStream(sessionId);
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
   * 工具审批接口
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
    });

    if (!message || !message.contents || message.contents.length === 0) {
      throw new Error("Message not found");
    }

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

  /**
   * 发送消息（不返回 SSE 流）
   *
   * 用于非活动会话的队列消息：只创建用户消息并启动 Agent 循环，不返回 SSE。
   * 前端通过全局 stream_started/stream_finished SSE 事件感知状态。
   * 如果会话已有活跃流，返回 409 SESSION_BUSY。
   */
  @Post("send")
  async sendMessage(
    @Body()
    body: {
      sessionId: string;
      content: string;
      fileIds?: string[];
      knowledgeBaseIds?: string[];
      replaceMessageId?: string;
    },
    @CurrentUser() user: any,
  ) {
    const { sessionId, content, fileIds, knowledgeBaseIds, replaceMessageId } =
      body;

    const source: Record<string, any> = { clientId: null };

    if (content) {
      try {
        const parsed = await this.tagParserPipeline.parse(content, {
          sessionId,
          userId: user.id,
        });
        if (parsed.content !== parsed.originalText) {
          source.parseResult = { content: parsed.content };
        }
      } catch (error: any) {
        this.logger.warn(
          `标签解析失败，使用原始内容: ${error?.message || error}`,
        );
      }
    }

    try {
      await this.chatRunner.startStream(
        {
          sessionId,
          userId: user.id,
          userMessage: {
            content,
            files: fileIds,
            replaceMessageId,
            knowledgeBaseIds,
          },
          regenerationMode: "overwrite",
          source,
        },
        // 不传 callbacks → 后端启动流但不向此请求者推送 SSE
      );
      return { success: true, sessionId };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        { error: error.message || "发送失败", code: "SEND_FAILED" },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
