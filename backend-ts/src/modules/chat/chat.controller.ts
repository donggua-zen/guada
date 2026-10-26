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
  Query,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";

import { SessionService } from "./session.service";
import { FileRef } from "../../common/types/conversation.types";
import { Response, Request } from "express";
import { SessionStreamManager } from "./session-stream.manager";
import { ChatRunnerService } from "./chat-runner.service";
import { TagParserPipeline } from "./parsers/tag-parser-pipeline.service";
import { InteractionWaitService } from "../../common/services/interaction-wait.service";
import { parseLocalSlashCommand } from "./commands/local-slash-command";
import { normalizeTurnSettingsOverride } from "./types/turn-settings-override";
import { UserInputQueueService } from "./user-input-queue.service";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private sessionService: SessionService,
    private streamManager: SessionStreamManager,
    private chatRunner: ChatRunnerService,
    private tagParserPipeline: TagParserPipeline,
    private interactionWait: InteractionWaitService,
    private userInputQueue: UserInputQueueService,
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
        files?: FileRef[];
        replaceTurnId?: string;
        knowledgeBaseIds?: string[];
      };
      /**
       * 排队消息补发的回合级设置覆盖（只影响本回合，不写回会话设置）。
       * 白名单校验见 types/turn-settings-override.ts。
       */
      settingsOverride?: Record<string, unknown>;
    },
    @Res() res: Response,
    @Req() req: Request,
    @Headers("x-client-id") clientId: string,
  ) {
    const {
      sessionId,
      regenerationMode = "overwrite",
      resumeData,
      userMessage,
      settingsOverride: rawSettingsOverride,
    } = body;

    // 白名单归一化：非法字段/类型直接 400，坏值不进入回合上下文。
    const settingsOverride = normalizeTurnSettingsOverride(rawSettingsOverride);

    // 本地斜杠命令（/compact、/compress）：控制指令，**不写用户消息、不进 LLM 上下文**。
    // 必须在标签解析与 chatRunner.startStream 之前拦截——一旦进入 startStream，
    // agent-engine 会先 addUserMessage 落库，再想"不发给模型"就只能删回合（zcode 同款做法是
    // 在 core runtime 的 addUser/persistUserPrompt 之前短路，见 zcode turn.ts executeTurnCommand）。
    const localCommand = parseLocalSlashCommand(userMessage?.content);
    if (localCommand) {
      if (userMessage?.files?.length) {
        throw new BadRequestException({
          error: "斜杠命令不支持附件，请移除附件后重试",
          code: "LOCAL_COMMAND_WITH_FILES",
        });
      }
      try {
        const result = await this.sessionService.compressSession(sessionId, {
          instructions: localCommand.instructions,
        });
        if (!res.writableEnded) {
          res.status(200).json({
            ok: true,
            localCommand: {
              name: localCommand.name,
              ...(localCommand.instructions === undefined
                ? {}
                : { instructions: localCommand.instructions }),
              started: result?.started === true,
            },
          });
        }
      } catch (error: any) {
        this.respondStartError(res, error, "压缩启动失败");
      }
      return;
    }

    // 构建 source 对象（包含客户端 ID 和命令标记解析产物）
    const source: Record<string, any> = { clientId: clientId || null };

    // 解析命令标记：正文永不改写，解析产物以注入块随消息落库（写入时冻结）
    if (userMessage?.content) {
      try {
        const parsed = await this.tagParserPipeline.parse(userMessage.content, {
          sessionId,
        });
        if (parsed.injectionBlocks.length > 0) {
          source.injectedBlocks = parsed.injectionBlocks;
        }
      } catch (error: any) {
        this.logger.warn(
          `命令标记解析失败，正文原样保留: ${error?.message || error}`,
        );
      }
    }

    // 可入队判定：resume/regenerate 等无用户正文的请求保持原行为（忙碌时 409）。
    const canQueueUserInput = !!(
      userMessage?.content?.trim() || userMessage?.files?.length
    );
    const enqueueUserInput = () =>
      this.userInputQueue.enqueue({
        sessionId,
        content: userMessage?.content ?? "",
        ...(userMessage?.files?.length ? { files: userMessage.files } : {}),
        ...(source.injectedBlocks?.length
          ? { injectedBlocks: source.injectedBlocks }
          : {}),
        ...(userMessage?.knowledgeBaseIds?.length
          ? { knowledgeBaseIds: userMessage.knowledgeBaseIds }
          : {}),
        ...(userMessage?.replaceTurnId
          ? { replaceTurnId: userMessage.replaceTurnId }
          : {}),
        ...(settingsOverride ? { settingsOverride } : {}),
        ...(clientId ? { clientId } : {}),
      });

    // M3：会话忙碌时用户消息不再 409，而是进入后端用户队列（多窗口共用一条 FIFO）。
    if (canQueueUserInput && this.streamManager.hasActiveStream(sessionId)) {
      const { item, snapshot } = enqueueUserInput();
      if (!res.writableEnded) {
        res.status(200).json({
          ok: true,
          queued: true,
          itemId: item.id,
          revision: snapshot.revision,
          epoch: snapshot.epoch,
        });
      }
      return;
    }

    // 合并后:/chat/stream 降级为 RPC,不再持有 SSE 长连接。
    // 流式事件经 chat-runner 单点发布 streamManager.publish(eventBuffer 补发 + SSE 直投合一)。
    try {
      await this.chatRunner.startStream(
        {
          sessionId,
          userMessage,
          regenerationMode: regenerationMode || "overwrite",
          resumeData,
          source,
          // 直发与入队使用同一份回合级快照：客户端改完设置立即发送时，
          // 不依赖此前 PUT 是否已经落盘，本回合仍按输入区当前值执行。
          ...(settingsOverride ? { settingsOverride } : {}),
        },
        undefined, // 不再通过 HTTP 长连接接收事件,事件走全局 SSE
      );

      // 立即返回,不再阻塞到流结束
      if (!res.writableEnded) {
        res.status(200).json({ ok: true, started: true });
      }
    } catch (error: any) {
      // 竞态：预检空闲但 startStream 时已被另一窗口抢占 → 入队而不是把 409 抛给用户。
      const code = error?.response?.code || error?.code;
      if (
        canQueueUserInput &&
        (code === "SESSION_BUSY" || code === "STREAM_START_FAILED")
      ) {
        const { item, snapshot } = enqueueUserInput();
        if (!res.writableEnded) {
          res.status(200).json({
            ok: true,
            queued: true,
            itemId: item.id,
            revision: snapshot.revision,
            epoch: snapshot.epoch,
          });
        }
        return;
      }
      this.respondStartError(res, error, "启动流失败");
    }
  }

  /**
   * 启动类请求的统一错误响应（chat 流 / 本地命令共用）。
   * HttpException（如压缩的 409 SESSION_STREAMING/SESSION_BUSY）原样透传状态与 body，
   * 其余按 500 返回，便于前端按 code 区分提示。
   */
  private respondStartError(
    res: Response,
    error: any,
    fallbackMessage: string,
  ): void {
    if (res.writableEnded) return;
    if (error instanceof HttpException) {
      const response = error.getResponse() as any;
      res.status(error.getStatus()).json(response);
      return;
    }
    // 模型引用不可解析（含排队消息冻结的 modelId 已被删除/改名）：按客户端错误返回，
    // 便于前端提示"模型不可用"而不是笼统的启动失败。
    if (error?.code === "MODEL_NOT_RESOLVED") {
      res.status(400).json({
        error: error.message || "模型不可用",
        code: "MODEL_NOT_RESOLVED",
      });
      return;
    }
    this.logger.error(
      `${fallbackMessage}: ${error?.message || 'Unknown error'}`,
      error instanceof Error ? error.stack : JSON.stringify(error, null, 2),
    );
    res.status(500).json({
      error: error.message || fallbackMessage,
      code: "STREAM_START_FAILED",
    });
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
  ) {
    await this.sessionService.getSessionById(sessionId);
    return (
      this.streamManager.getStreamStatus(sessionId) || {
        isRunning: false,
        subscriberCount: 0,
        bufferedEventCount: 0,
      }
    );
  }

  /**
   * 挂起中的交互列表（**重连后恢复待答卡片**用）。
   *
   * 背景：`ask_requested` 是流帧，页面刷新 / SSE 丢帧后前端拿不到它；历史重放又刻意不重建
   * 待答卡片（无从判断该 ask 是否仍在等待）。于是"审批卡弹出时刷新"会永久挂住（后端无超时）。
   * 这里直接读进程内等待表补一刀：前端每次（重）建连后拉一次并 upsert（幂等）。
   *
   * `sessionId` 可选：不传返回全部会话的待答（多窗口 / 后台会话也能自愈）。
   */
  @Get("pending-asks")
  async pendingAsks(@Query("sessionId") sessionId?: string) {
    const pending = this.interactionWait.listPending(sessionId?.trim() || undefined);
    return { pending };
  }

  /**
   * 统一交互应答接口（审批 / 询问共用，对齐 DSH POST /api/respond）
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
