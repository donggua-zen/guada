import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { SessionMetaStore } from "./session-meta.store";
import { AgentFileStore } from "../agents/agent-file.store";
import { ProviderFileStore } from "../llm-core/provider-file.store";

/**
 * 老会话模型回填（全局默认对话模型移除后的数据迁移）。
 *
 * 只在启动期处理 `session_type='web'` 且 `model_id` 为空的主会话：
 * 1. 智能体配置了可解析的 modelId → 用它；
 * 2. 否则用第一个启用中的文本模型；
 * 3. 都没有 → 保留空值并记录 unresolved（下次启动有模型时会再次尝试）。
 *
 * Bot 会话与子代理会话不在此处回填：前者的模型由 Bot/智能体运行期解析，
 * 后者不参与主会话输入区。
 */
@Injectable()
export class SessionModelBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionModelBackfillService.name);

  constructor(
    private readonly sessionStore: SessionMetaStore,
    private readonly agentStore: AgentFileStore,
    private readonly modelStore: ProviderFileStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sessionStore.initialize();

    const sessions = this.sessionStore.listWebSessionsWithMissingModel();
    if (sessions.length === 0) return;

    const fallbackModel = this.modelStore
      .listModels()
      .find((model) => model.modelType === "text");

    let filled = 0;
    let unresolved = 0;

    for (const session of sessions) {
      let modelId: string | null = null;

      if (session.agentId) {
        const agent = await this.agentStore.findById(session.agentId);
        if (agent?.modelId && this.modelStore.findModel(agent.modelId)) {
          modelId = agent.modelId;
        }
      }

      if (!modelId && fallbackModel) {
        modelId = fallbackModel.id;
      }

      if (!modelId) {
        unresolved += 1;
        continue;
      }

      try {
        await this.sessionStore.backfillModelId(session.id, modelId);
        filled += 1;
      } catch (error) {
        unresolved += 1;
        this.logger.warn(
          `回填会话模型失败 ${session.id}: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    this.logger.log(
      `Session model backfill: ${filled} filled, ${unresolved} unresolved`,
    );
  }
}
