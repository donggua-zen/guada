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
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

import { SessionService } from "./session.service";
import { MessageRepository } from "../../common/database/message.repository";
import { MessageFile } from "../../common/persistence/types";
import { Response, Request } from "express";
import { SessionStreamManager } from "./session-stream.manager";
import { ChatRunnerService } from "./chat-runner.service";
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";
import { InteractionWaitService } from "../../common/services/interaction-wait.service";

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
    private interactionWait: InteractionWaitService,
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
      userMessage?: {
        id?: string;
        content?: string;
        files?: MessageFile[];
        replaceTurnId?: string;
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

    // 合并后:/chat/stream 降级为 RPC,不再持有 SSE 长连接。
    // 流式事件经 chat-runner 单点发布 streamManager.publish(eventBuffer 补发 + SSE 直投合一)。
    try {
      await this.chatRunner.startStream(
        {
          sessionId,
          userId: user.id,
          userMessage,
          regenerationMode: regenerationMode || "overwrite",
          resumeData,
          source,
        },
        undefined, // 不再通过 HTTP 长连接接收事件,事件走全局 SSE
      );

      // 立即返回,不再阻塞到流结束
      if (!res.writableEnded) {
        res.status(200).json({ ok: true });
      }
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
   * 统一交互应答接口（审批 / 询问 / 迭代暂停共用，对齐 DSH POST /api/respond）
   *
   * 前端回传 ask_requested 帧携带的凭证 requestId（uuid）与答案批。
   * 只做一件事：校验答案与挂起问题单匹配 → InteractionWaitService.resolveAnswers
   * 原地唤醒阻塞中的工具/引擎；无等待者 → 404。
   * 审计（ask/answered）与终结帧（ask_resolved）由 AskService 应答落地后统一写回，
   * 本端点不落库、不加载历史。
   */
  @Post("respond")
  async respond(
    @Body()
    body: {
      sessionId: string; // 会话 ID
      requestId: string; // 临时凭证（uuid，ask_requested 事件携带）
      answers: Array<{
        // 与问题单逐 id 对应
        id: string;
        selected: string[]; // 选中的 option label（custom 时可为空）
        custom?: string; // 自定义回复（单选时与 selected 互斥）
      }>;
    },
  ) {
    const { sessionId, requestId, answers } = body ?? ({} as any);
    if (!sessionId || !requestId) {
      throw new BadRequestException("sessionId and requestId are required");
    }
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new BadRequestException("answers are required");
    }

    // 轻校验：答案 id 与挂起问题单逐 id 对应，选中 label 必须是原题选项，
    // 单选至多一项且与 custom 互斥（对齐 DSH matchesQuestions）
    const questions = this.interactionWait.getPendingQuestions(sessionId, requestId);
    if (questions) {
      const byId = new Map(questions.map((q) => [q.id, q]));
      for (const a of answers) {
        const q = byId.get(a.id);
        if (!q) {
          throw new BadRequestException(`answer id mismatch: ${a.id}`);
        }
        const selected = Array.isArray(a.selected) ? a.selected : [];
        for (const label of selected) {
          if (!q.options.some((o) => o.label === label)) {
            throw new BadRequestException(`invalid option for question ${a.id}: ${label}`);
          }
        }
        if (!q.multiSelect && selected.length > 1) {
          throw new BadRequestException(`question ${a.id} is single-select`);
        }
        if (!q.multiSelect && selected.length > 0 && a.custom?.trim()) {
          throw new BadRequestException(`question ${a.id}: custom and selection are mutually exclusive`);
        }
      }
    }

    // 有等待者 → 唤醒原地阻塞的工具/引擎；无等待者 → 报错
    const delivered = this.interactionWait.resolveAnswers(sessionId, requestId, answers);
    if (!delivered) {
      throw new NotFoundException(
        `No pending ask wait for session ${sessionId}, request ${requestId}`,
      );
    }

    return { success: true, requestId, answersCount: answers.length };
  }

  /**
   * 发送消息（不返回 SSE 流）
   *
   * 用于非活动会话的队列消息：只创建用户消息并启动 Agent 循环，不返回 SSE。
   * 前端通过全局 stream_started/stream_finished SSE 事件感知状态。
   * 如果会话已有活跃流，返回 409 SESSION_BUSY。
   */
}
