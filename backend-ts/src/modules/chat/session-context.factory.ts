import { Injectable, Inject } from "@nestjs/common";
import { ISessionContext } from "./session-context";
import { PersistentSessionContext } from "./persistent-session-context";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import {
  IMessageStore,
  ICompressionStrategy,
} from "./interfaces";
import { MESSAGE_STORE_TOKEN, COMPRESSION_STRATEGY_TOKEN } from "./interfaces";

/**
 * SessionContext 工厂
 *
 * 负责从原始 session 对象构建类型安全的 ISessionContext 实例。
 * 只负责注入依赖和触发初始化，所有数据准备逻辑在 PersistentSessionContext 内部完成。
 *
 * 支持两种构建模式：
 * - 持久化会话：从数据库 session 记录构建（当前主要模式）
 * - 内存虚拟会话：未来可从内存配置直接构建，无需数据库
 */
@Injectable()
export class SessionContextFactory {
  constructor(
    private modelRepository: ModelRepository,
    private settingsStorage: SettingsStorage,
    private toolOrchestrator: ToolOrchestrator,
    private workspaceService: WorkspaceService,
    @Inject(MESSAGE_STORE_TOKEN) private messageStore: IMessageStore,
    @Inject(COMPRESSION_STRATEGY_TOKEN) private compressionStrategy: ICompressionStrategy,
    private tokenizerService: TokenizerService,
  ) {}

  /**
   * 从持久化会话构建 ISessionContext
   *
   * @param session 原始会话对象（应包含 model 和 character 关联数据）
   * @returns 类型安全的会话上下文
   */
  async createFromSession(session: any): Promise<ISessionContext> {
    const context = new PersistentSessionContext(
      session,
      this.modelRepository,
      this.settingsStorage,
      this.toolOrchestrator,
      this.workspaceService,
      this.messageStore,
      this.compressionStrategy,
      this.tokenizerService,
    );

    await context.initialize();

    return context;
  }
}
