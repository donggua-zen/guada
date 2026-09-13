/**
 * 会话上下文工厂
 *
 * 生产 JsonlSessionContext 实例。消息存储经 MESSAGE_STORE_TOKEN 注入（不感知具体后端）。
 * 注入补齐能力所需的全部依赖（设置合并/模型解析/插件决议/提示词拼接/token 统计/压缩/摘要 LLM）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { JsonlSessionContext } from './jsonl-session-context';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { PluginManager } from '../plugins/plugin.manager';
import { PromptCollector } from '../plugins/prompt-collector.service';
import { WorkspaceService } from '../../common/services/workspace.service';
import { TokenMeterService } from './token-meter.service';
import { SessionStreamManager } from './session-stream.manager';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';

@Injectable()
export class JsonlSessionContextFactory {
  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly settingsStorage: SettingsStorage,
    private readonly modelStore: ProviderFileStore,
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
    private readonly workspaceService: WorkspaceService,
    private readonly tokenMeter: TokenMeterService,
    private readonly streamManager: SessionStreamManager,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  async createFromSession(session: any): Promise<JsonlSessionContext> {
    const context = new JsonlSessionContext(
      session,
      this.messageStore,
      this.settingsStorage,
      this.modelStore,
      this.pluginManager,
      this.promptCollector,
      this.workspaceService,
      this.tokenMeter,
      this.streamManager,
      this.knowledgeBaseService,
    );
    await context.initialize();
    return context;
  }
}
