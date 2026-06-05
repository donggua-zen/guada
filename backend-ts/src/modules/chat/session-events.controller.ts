import {
  Controller,
  Sse,
  MessageEvent,
  UseGuards,
  Req,
  Headers,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionEventsService } from "./session-events.service";

/**
 * 用户级会话事件 SSE 控制器
 *
 * 前端通过 EventSource 连接此端点，接收：
 * - 会话创建/删除/重命名事件
 * - 流式消息开始/结束事件
 * - 其他用户消息创建事件（用于多窗口同步）
 */
@Controller("events")
@UseGuards(AuthGuard)
export class SessionEventsController {
  constructor(private readonly sessionEventsService: SessionEventsService) {}

  /**
   * 订阅用户级会话事件流
   *
   * 前端通过 EventSource 连接此端点，在 header 中携带 X-Client-Id：
   * const es = new EventSourcePolyfill(`/events/sessions`, {
   *   headers: { "X-Client-Id": clientId }
   * });
   *
   * @param clientId 客户端标识（前端从 header 传入）
   */
  @Sse("sessions")
  async subscribeSessionEvents(
    @Headers("x-client-id") clientId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const userId = user.id;
    const finalClientId = clientId || `default_${Date.now()}`;

    const observable = this.sessionEventsService.subscribe(userId, finalClientId);

    // 监听连接关闭，清理订阅
    req.on("close", () => {
      this.sessionEventsService.unsubscribe(userId, finalClientId);
    });

    return observable;
  }
}
