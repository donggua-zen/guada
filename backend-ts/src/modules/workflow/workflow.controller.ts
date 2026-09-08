/**
 * Workflow 运行状态 UI 端点
 *
 * 供前端 OverviewPanel 工作流区块使用：返回该会话全部已知 run 的内存折叠快照
 * （运行中 + 近期完成，引擎注册表持有）。与 AI 侧的 workflow_run 工具共享
 * WorkflowEngineService，按 HTTP 语义校验会话归属，防止跨会话读取。
 * 实时增量由 workflow_event SSE（session-events 流通道）喂前端同一 reducer。
 */
import { Controller, Get, Param, UseGuards, NotFoundException } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "../chat/session.service";
import { WorkflowEngineService } from "./workflow-engine.service";

@Controller()
@UseGuards(AuthGuard)
export class WorkflowController {
  constructor(
    private readonly workflowEngine: WorkflowEngineService,
    private readonly sessionService: SessionService,
  ) {}

  /** 某会话的全部已知 workflow run 快照（按注册顺序） */
  @Get("sessions/:id/workflow/runs")
  async listRuns(@Param("id") id: string, @CurrentUser() user: any) {
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    return { runs: this.workflowEngine.getSessionRunStates(id) };
  }
}
