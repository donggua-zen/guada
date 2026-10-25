import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ChatRunnerService } from "./chat-runner.service";
import {
  UserInputQueueService,
  type UserQueueSnapshot,
} from "./user-input-queue.service";

/**
 * 会话级用户输入队列（M3：队列所有权在后端）
 *
 * 前端只做快照投影：所有写操作都返回最新快照，配合 SSE "queue_updated" 增量，
 * 多窗口/刷新后以服务端为准。
 */
@Controller("sessions/:sessionId/queue")
@UseGuards(AuthGuard)
export class SessionQueueController {
  constructor(
    private readonly userInputQueue: UserInputQueueService,
    private readonly chatRunner: ChatRunnerService,
  ) {}

  @Get()
  getQueue(@Param("sessionId") sessionId: string): UserQueueSnapshot {
    return this.userInputQueue.getSnapshot(sessionId);
  }

  @Delete(":itemId")
  removeItem(
    @Param("sessionId") sessionId: string,
    @Param("itemId") itemId: string,
  ): UserQueueSnapshot {
    return this.userInputQueue.remove(sessionId, itemId);
  }

  @Post(":itemId/send-now")
  sendNow(
    @Param("sessionId") sessionId: string,
    @Param("itemId") itemId: string,
  ): Promise<UserQueueSnapshot> {
    return this.chatRunner.sendQueuedNow(sessionId, itemId);
  }

  @Post("reorder")
  reorder(
    @Param("sessionId") sessionId: string,
    @Body() body: { itemId?: string; direction?: number },
  ): UserQueueSnapshot {
    if (!body?.itemId) {
      throw new BadRequestException({
        error: "缺少 itemId",
        code: "QUEUE_ITEM_NOT_FOUND",
      });
    }
    if (body.direction !== -1 && body.direction !== 1) {
      throw new BadRequestException({
        error: "direction 只能是 -1 或 1",
        code: "QUEUE_REORDER_INVALID_DIRECTION",
      });
    }
    return this.userInputQueue.reorder(
      sessionId,
      body.itemId,
      body.direction as -1 | 1,
    );
  }

  @Post("pause")
  pause(@Param("sessionId") sessionId: string): UserQueueSnapshot {
    return this.userInputQueue.pause(sessionId, "manual");
  }

  @Post("resume")
  resume(@Param("sessionId") sessionId: string): UserQueueSnapshot {
    return this.userInputQueue.resume(sessionId);
  }
}
