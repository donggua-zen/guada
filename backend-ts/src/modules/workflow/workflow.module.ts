import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { SubAgentModule } from "../sub-agent/sub-agent.module";
import { PluginManager } from "../plugins";
import { SubAgentManager } from "../sub-agent/sub-agent.manager";
import { WorkflowEngineService } from "./workflow-engine.service";
import { WorkflowPlugin } from "./workflow.plugin";

/**
 * Workflow 子代理编排模块
 *
 * 引擎复用 SubAgentManager 创建独立会话子代理（同一 AgentEngine 完整循环），
 * MESSAGE_STORE_TOKEN 由全局 PersistenceModule 提供。
 */
@Module({
  imports: [SubAgentModule],
  providers: [WorkflowEngineService, WorkflowPlugin],
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
