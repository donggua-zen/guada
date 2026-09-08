/**
 * Workflow 运行状态 UI 端点
 *
 * 供前端 OverviewPanel 工作流区块与工作流审阅标签使用：返回该会话全部已知
 * run 快照 = 磁盘历史（sessions/<sid>/workflows/ 终态归档）∪ 内存快照
 * （运行中 + 近期完成，同 runId 内存优先——运行中快照权威）。
 * 与 AI 侧的 workflow_run 工具共享 WorkflowEngineService，按 HTTP 语义校验
 * 会话归属，防止跨会话读取。实时增量由 workflow_event SSE 喂前端同一 reducer。
 */
import { Controller, Get, Param, UseGuards, NotFoundException } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "../chat/session.service";
import { WorkflowEngineService } from "./workflow-engine.service";
import { WorkflowFileStore } from "./workflow-file-store.service";

@Controller()
@UseGuards(AuthGuard)
export class WorkflowController {
  constructor(
    private readonly workflowEngine: WorkflowEngineService,
    private readonly workflowFileStore: WorkflowFileStore,
    private readonly sessionService: SessionService,
  ) {}

  /** 某会话的全部 workflow run 快照（磁盘历史 ∪ 内存，按开始时间倒序） */
  @Get("sessions/:id/workflow/runs")
  async listRuns(@Param("id") id: string, @CurrentUser() user: any) {
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    const byRunId = new Map(
      (await this.workflowFileStore.listRunSnapshots(id)).map((s) => [s.runId, s]),
    );
    // 内存优先：运行中快照权威（同一 run 的磁盘终态与其收敛，同 runId 直接覆盖）
    for (const snap of this.workflowEngine.getSessionRunStates(id)) {
      byRunId.set(snap.runId, snap);
    }
    const runs = [...byRunId.values()].sort(
      (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
    );
    return { runs };
  }
}
