import {
  Controller,
  Get,
  Param,
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
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    // 确定工作目录路径
    let workspacePath: string;
    if ((session as any).workspacePath) {
      workspacePath = this.workspaceService.resolveFilePath("", (session as any).workspacePath);
    } else {
      workspacePath = this.workspaceService.getDefaultWorkspaceDir(id);
    }

    // 确保目录存在
    await this.workspaceService.ensureDirectoryExists(workspacePath);

    // 开始监听工作目录
    this.fileWatcherService.startWatching(id, workspacePath);

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

    // 当连接关闭时清理资源：停止文件监听
    eventSubject.subscribe({
      complete: () => {
        clearInterval(heartbeatTimer);
        unsubscribe();
        this.fileWatcherService.stopWatching(id);
      },
      error: () => {
        clearInterval(heartbeatTimer);
        unsubscribe();
        this.fileWatcherService.stopWatching(id);
      },
    });

    // 监听底层 HTTP 连接关闭事件（前端断开、网络中断等）
    req.on("close", () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
      this.fileWatcherService.stopWatching(id);
      eventSubject.complete();
    });

    // 返回 Observable
    return eventSubject.asObservable();
  }
}
