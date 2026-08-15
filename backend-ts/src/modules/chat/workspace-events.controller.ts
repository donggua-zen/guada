import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  Body,
  Sse,
  UseGuards,
  MessageEvent,
  Req,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "./session.service";
import {
  WorkspaceWatcherService,
  FileChangeEvent,
  WatchScope,
  normalizeWatchScope,
} from "../../common/services/workspace-watcher.service";
import { WorkspaceService } from "../../common/services/workspace.service";

/**
 * 工作目录实时事件控制器
 * 使用 SSE (Server-Sent Events) 向前端推送文件变化
 */
@Controller()
@UseGuards(AuthGuard)
export class WorkspaceEventsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly workspaceWatcherService: WorkspaceWatcherService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * 设置 watcher 订阅范围（连接级，按 x-client-id 关联）：
   * body: { scope: 'file' | 'git', enabled?: boolean }
   * - 同一 clientId 多次调用取并集；enabled=false 移除该范围；
   * - SSE 断开时该 clientId 的全部订阅自动清除（连接级引用计数）。
   */
  @Post("sessions/:id/workspace/watch")
  async setWatchScope(
    @Param("id") id: string,
    @Headers("x-client-id") clientId: string,
    @Body() body: { scope?: string; enabled?: boolean },
    @CurrentUser() user: any,
  ) {
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }
    const scope = normalizeWatchScope(body.scope);
    if (!scope) {
      throw new Error("Invalid watch scope (expect 'file' or 'git')");
    }
    const finalClientId = clientId || "default";
    this.workspaceWatcherService.setWatchScope(
      id,
      finalClientId,
      scope as WatchScope,
      body.enabled !== false,
    );
    return { success: true };
  }

  /**
   * 订阅工作目录实时事件
   * 前端通过 EventSource 连接此端点
   */
  @Sse("sessions/:id/workspace/events")
  async subscribeWorkspaceEvents(
    @Param("id") id: string,
    @Headers("x-client-id") clientId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspacePath = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 使用 clientId 区分不同页面，支持多页面共享 watcher
    const finalClientId = clientId || "default";

    return new Observable<MessageEvent>((subscriber) => {
      const response = req.res;
      if (response?.destroyed) {
        subscriber.complete();
        return undefined;
      }

      // 开始监听工作目录（初始只监听根目录）
      const releaseWatching = this.workspaceWatcherService.startWatching(
        id,
        workspacePath,
        finalClientId,
        () => subscriber.complete(),
      );

      // 注册文件变化监听器
      const unsubscribe = this.workspaceWatcherService.onFileChange(
        id,
        (event: FileChangeEvent) => {
          subscriber.next({ data: event } as MessageEvent);
        },
      );

      // 每 90 秒发送一次心跳，防止前端超时断开
      const heartbeatTimer = setInterval(() => {
        subscriber.next({
          data: JSON.stringify({
            type: "heartbeat",
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      }, 90000);

      const handleResponseClose = () => {
        subscriber.complete();
      };
      response?.once("close", handleResponseClose);

      let cleanedUp = false;
      return () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        response?.off("close", handleResponseClose);
        clearInterval(heartbeatTimer);
        unsubscribe();
        releaseWatching();
      };
    });
  }
}
