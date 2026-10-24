import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { SubAgentModule } from "../sub-agent/sub-agent.module";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { AgentsModule } from "../agents/agents.module";
import { PluginManager } from "../plugins";
import { SubAgentManager } from "../sub-agent/sub-agent.manager";
import { WorkflowEngineService } from "./workflow-engine.service";
import { WorkflowFileStore } from "./workflow-file-store.service";
import { WorkflowController } from "./workflow.controller";
import { WorkflowPlugin } from "./workflow.plugin";
import { JobsModule } from "../jobs/jobs.module";

/**
 * Workflow 子代理编排模块
 *
 * 引擎复用 SubAgentManager 创建独立会话子代理（同一 AgentEngine 完整循环）。
 * 运行进度不落 JSONL：引擎维护内存折叠快照，WorkflowController 提供快照端点
 * （前端 workflowRuns store 基线），实时增量走 workflow_event SSE 流通道。
 */
@Module({
  imports: [SubAgentModule, AuthModule, ChatModule, AgentsModule, JobsModule],
  controllers: [WorkflowController],
  providers: [WorkflowEngineService, WorkflowFileStore, WorkflowPlugin],
  exports: [WorkflowEngineService],
})
export class WorkflowModule implements OnModuleInit {
  private readonly logger = new Logger(WorkflowModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly workflowPlugin: WorkflowPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.workflowPlugin);
    this.logger.log("WorkflowPlugin 已注册");
  }
}
