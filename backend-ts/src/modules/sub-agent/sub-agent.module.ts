import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { ToolsModule } from "../tools/tools.module";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SubAgentManager } from "./sub-agent.manager";
import { SubAgentToolProvider } from "./sub-agent-tool.provider";

/**
 * 子 Agent 模块
 *
 * 独立管理子 Agent 的创建、执行和结果收集。
 * 通过 SubAgentToolProvider 向 ToolOrchestrator 注册 spawn_sub_agent / wait_agent_complete 工具。
 */
@Module({
  imports: [ChatModule, ToolsModule],
  providers: [
    SubAgentManager,
    SubAgentToolProvider,
  ],
  exports: [SubAgentManager],
})
export class SubAgentModule implements OnModuleInit {
  private readonly logger = new Logger(SubAgentModule.name);

  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly subAgentToolProvider: SubAgentToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.subAgentToolProvider);
    this.logger.log("SubAgentToolProvider 已注册到 ToolOrchestrator");
  }
}
