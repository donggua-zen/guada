import {
  Controller,
  Post,
  Param,
  Headers,
  Body,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { SessionService } from "./session.service";
import {
  WorkspaceWatcherService,
  WatchScope,
  normalizeWatchScope,
} from "../../common/services/workspace-watcher.service";

/**
 * 工作目录实时事件控制面（数据面走 WebSocket 的 workspace/watch + event）。
 */
@Controller()
@UseGuards(AuthGuard)
export class WorkspaceEventsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly workspaceWatcherService: WorkspaceWatcherService,
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
  ) {
    const session = await this.sessionService.getSessionById(id);
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

}
