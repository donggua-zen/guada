import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  UseGuards,
  Logger,
  Inject,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from "../../common/persistence/message-store.interface";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionReplayService } from "./session-replay.service";
import { EventBusService } from "../../common/events/event-bus.service";

@Controller()
@UseGuards(AuthGuard)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);
  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly streamManager: SessionStreamManager,
    private readonly replayService: SessionReplayService,
    private readonly eventBus: EventBusService,
  ) {}

  /** 确保会话有持久化存储（新会话自动创建） */
  private async ensureSession(sessionId: string): Promise<void> {
    await this.messageStore.ensureSession(sessionId);
  }

  /**
   * 获取会话事件页（前端自折叠的加载源）
   *
   * 返回尾部 N 个有效回合的**领域事件原样**（seq 序），前端用同一折叠器折叠出 turn 树
   * （被删回合/被压缩消息由前端经 turn/delete / compaction/summary 自行消解）。
   * 页边界按回合括号对齐（不切括号）。
   * @param beforeSeq 页尾上限（含）；缺省 = 当前最后 seq（初始加载）
   * @param turns 本页有效回合数（缺省 30，上限 100）
   * @returns { events, endSeq, nextBeforeSeq, hasMore }
   */
  @Get("sessions/:sessionId/events")
  async getEvents(
    @Param("sessionId") sessionId: string,
    @Query("beforeSeq") beforeSeq?: string,
    @Query("turns") turns?: string,
  ) {
    await this.ensureSession(sessionId);
    return this.replayService.getEventPage(sessionId, {
      beforeSeq: beforeSeq !== undefined ? parseInt(beforeSeq, 10) : undefined,
      turns: turns !== undefined ? parseInt(turns, 10) : 30,
    });
  }

  /**
   * 前向增量读（断点续传）：返回 `seq > afterSeq` 的领域事件。
   *
   * 与事件页的区别：不按回合对齐、不重拉已加载历史，只补缺失尾部；客户端据此
   * 就地应用到现有树（无需全量 fold）。`hasMoreAfter` 为 true 表示缺口超过单批
   * 上限，调用方应改为整页重拉。
   *
   * @param afterSeq 客户端已应用到的最高 seq（缺省 -1 = 全量）
   * @param limit 单批上限（缺省 500，上限 2000）
   * @returns { events, endSeq, tailSeq, hasMoreAfter }
   */
  @Get("sessions/:sessionId/events/tail")
  async getEventsTail(
    @Param("sessionId") sessionId: string,
    @Query("afterSeq") afterSeq?: string,
    @Query("limit") limit?: string,
  ) {
    await this.ensureSession(sessionId);
    const parsedAfter = afterSeq !== undefined ? parseInt(afterSeq, 10) : undefined;
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined;
    return this.replayService.getEventsAfter(sessionId, {
      afterSeq:
        parsedAfter !== undefined && Number.isFinite(parsedAfter)
          ? parsedAfter
          : undefined,
      limit:
        parsedLimit !== undefined && Number.isFinite(parsedLimit)
          ? parsedLimit
          : undefined,
    });
  }

  /**
   * 删除本轮对话（按回合 id 整轮遮蔽）
   */
  @Delete("sessions/:sessionId/turns/:turnId")
  async deleteTurn(
    @Param("sessionId") sessionId: string,
    @Param("turnId") turnId: string,
  ) {
    await this.ensureSession(sessionId);
    return this.messageStore.deleteTurn(sessionId, turnId);
  }

  /**
   * 清空会话的所有轮次
   *
   * 物理删除整个 JSONL 目录（seq 换代）：其他窗口必须清空本地树/水位并按新日志重拉，
   * 因此成功后广播 session.cleared。流式输出中禁止清空（对齐删除会话的护栏）——
   * 否则引擎仍会向已删除/重建的日志追加事件，落盘内容与回合状态互相错乱。
   */
  @Delete("sessions/:sessionId/messages")
  async clearSessionMessages(
    @Param("sessionId") sessionId: string,
    @Headers("x-client-id") clientId?: string,
  ) {
    await this.ensureSession(sessionId);
    if (this.streamManager.hasActiveStream(sessionId)) {
      throw new HttpException(
        {
          error: "会话正在流式输出中，无法清空聊天记录",
          code: "SESSION_STREAMING",
          activeSessionId: sessionId,
        },
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.messageStore.clearSessionTurns(sessionId);
    this.eventBus.emit("session.cleared", {
      sessionId,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
    });
    return result;
  }

  /**
   * 批量导入轮次
   */
  @Post("sessions/:sessionId/messages/import")
  async importMessages(
    @Param("sessionId") sessionId: string,
    @Body() messages: any[],
  ) {
    await this.ensureSession(sessionId);
    return this.messageStore.importTurns(sessionId, messages as any);
  }
}
