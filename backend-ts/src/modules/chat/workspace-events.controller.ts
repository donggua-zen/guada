import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  Sse,
  UseGuards,
  MessageEvent,
  Req,
} from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "./session.service";
import { FileWatcherService, FileChangeEvent } from "../../common/services/file-watcher.service";
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
    private readonly fileWatcherService: FileWatcherService,
    private readonly workspaceService: WorkspaceService,
  ) {}

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
    const workspacePath = this.workspaceService.resolveSessionWorkspaceDir(session);

    // 使用 clientId 区分不同页面，支持多页面共享 watcher
    const finalClientId = clientId || `default_${Date.now()}`;

    // 开始监听工作目录（初始只监听根目录）
    this.fileWatcherService.startWatching(id, workspacePath, finalClientId);

    // 创建 SSE 事件流
    const eventSubject = new Subject<MessageEvent>();

    // 注册文件变化监听器
    const unsubscribe = this.fileWatcherService.onFileChange(id, (event: FileChangeEvent) => {
      eventSubject.next({
        data: event,
      } as MessageEvent);
    });

    // 每 90 秒发送一次心跳，防止前端超时断开
    const heartbeatTimer = setInterval(() => {
      try {
        eventSubject.next({
          data: JSON.stringify({
            type: "heartbeat",
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      } catch (error) {
        clearInterval(heartbeatTimer);
      }
    }, 90000);

    // 当连接关闭时清理资源：减少引用计数
    eventSubject.subscribe({
      complete: () => {
        clearInterval(heartbeatTimer);
        unsubscribe();
        this.fileWatcherService.stopWatching(id, finalClientId);
      },
      error: () => {
        clearInterval(heartbeatTimer);
        unsubscribe();
        this.fileWatcherService.stopWatching(id, finalClientId);
      },
    });

    // 监听底层 HTTP 连接关闭事件（前端断开、网络中断等）
    req.on("close", () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
      this.fileWatcherService.stopWatching(id, finalClientId);
      eventSubject.complete();
    });

    // 返回 Observable
    return eventSubject.asObservable();
  }

  /**
   * 更新工作目录树展开状态
   * 前端展开/折叠目录时调用，用于动态调整监听范围
   */
  @Post("sessions/:id/workspace/expanded-paths")
  async updateExpandedPaths(
    @Param("id") id: string,
    @Headers("x-client-id") clientId: string,
    @Body() body: { expandedPaths: string[] },
    @CurrentUser() user: any,
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    const finalClientId = clientId || "default";

    // 更新该客户端的监听范围
    this.fileWatcherService.updateExpandedPaths(id, finalClientId, body.expandedPaths || []);

    return { success: true };
  }
}
