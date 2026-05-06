import { Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ConversationContextFactory } from "./conversation-context.factory";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolContextFactory } from "../tools/tool-context";
import { IConversationContext } from "./interfaces";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";

/**
 * 合并后的会话设置接口
 *
 * 包含从角色默认配置和会话自定义配置合并后的完整设置信息
 */
export interface MergedSettings {
  systemPrompt: string;
  thinkingEnabled: boolean | undefined;
  memory: any;
  modelTemperature?: number;
  modelTopP?: number;
  modelFrequencyPenalty?: number;
  tools?: any;
  mcpServers?: any;
}

/**
 * 构建上下文结果接口
 *
 * 包含初始化后的对话上下文、工具上下文和生效的上下文窗口大小
 * 注意：不包含 tools 列表，由调用方根据 toolContext 自行决定是否获取
 */
export interface BuildContextResult {
  context: IConversationContext;
  toolContext?: any;
  effectiveContextWindow: number;
  thinkingEnabled: boolean | undefined;
}

/**
 * 会话上下文服务
 *
 * 负责统一处理会话配置的合并与上下文的构建，确保 Agent 对话、Token 统计、手动压缩等场景
 * 使用完全一致的数据准备逻辑，从根本上消除数据不一致问题。
 *
 * 核心职责：
 * - 合并会话设置与角色默认配置（唯一数据来源）
 * - 计算实际生效的上下文窗口（考虑 maxTokensLimit 限制）
 * - 解析会话绑定的模型（优先会话模型，否则全局默认）
 * - 为不同场景构建完整的 ConversationContext（含 toolPrompts、thinkingEnabled 等）
 *
 * 设计原则：
 * - 单一来源：所有链路共用同一个配置合并逻辑
 * - 参数一致：systemPrompt、contextWindow、thinkingEnabled 在所有场景中保持一致
 * - 职责清晰：只负责数据准备，不参与推理循环或会话管理
 */
@Injectable()
export class SessionContextService {
  private readonly logger = new Logger(SessionContextService.name);

  constructor(
    private sessionRepo: SessionRepository,
    private conversationContextFactory: ConversationContextFactory,
    private toolOrchestrator: ToolOrchestrator,
    private toolContextFactory: ToolContextFactory,
    private modelRepository: ModelRepository,
    private settingsStorage: SettingsStorage,
  ) {}

  /**
   * 合并会话设置与角色默认配置（唯一来源）
   *
   * Agent 和 Session 均通过此方法获取合并后的设置，确保继承规则的一致性。
   *
   * 继承规则：
   * - 基础配置以角色设置为基准
   * - memoryEnabled !== false 时，使用会话的 memory 分组；否则使用角色的 memory 分组
   * - thinkingEnabled 直接取自会话设置（支持覆盖）
   * - 模型参数（temperature、topP 等）目前不支持会话级覆盖，直接使用角色默认值
   *
   * @param session 会话对象，包含 settings 和 character.settings
   * @returns 合并后的设置对象
   */
  mergeSettings(session: any): MergedSettings {
    const sessionSettings = session.settings || {};
    const characterSettings = session.character?.settings || {};

    const merged: MergedSettings = {
      systemPrompt: sessionSettings.systemPrompt || characterSettings.systemPrompt || "",
      thinkingEnabled: undefined,
      memory: {},
      modelTemperature: characterSettings.modelTemperature,
      modelTopP: characterSettings.modelTopP,
      modelFrequencyPenalty: characterSettings.modelFrequencyPenalty,
      tools: sessionSettings.tools,
      mcpServers: sessionSettings.mcpServers,
    };

    // --- 记忆/压缩配置（独立继承） ---
    const memoryEnabled = sessionSettings.memoryEnabled;
    const sessionMemory = sessionSettings.memory || {};
    const characterMemory = characterSettings.memory || {};

    if (memoryEnabled !== false) {
      merged.memory = { ...sessionMemory };
    } else {
      merged.memory = { ...characterMemory };
    }

    // --- thinkingEnabled ---
    merged.thinkingEnabled = sessionSettings.thinkingEnabled;

    return merged;
  }

  /**
   * 计算实际生效的上下文窗口
   *
   * 取模型上下文窗口和用户设置的 Token 上限的最小值，确保不会超出用户期望的限制。
   *
   * @param model 模型对象，包含 config.contextWindow
   * @param memoryConfig 记忆配置，包含 maxTokensLimit
   * @returns 实际生效的上下文窗口大小
   */
  private calcEffectiveContextWindow(model: any, memoryConfig: any): number {
    const modelContextWindow = model?.config?.contextWindow || 128000;
    const maxTokensLimit = memoryConfig?.maxTokensLimit;
    return maxTokensLimit
      ? Math.min(modelContextWindow, maxTokensLimit)
      : modelContextWindow;
  }

  /**
   * 解析会话模型（优先会话绑定模型，否则全局默认）
   *
   * @param session 会话对象
   * @returns 解析后的模型对象，可能为 null
   */
  private async resolveModel(session: any) {
    let model = session.model;
    if (!model) {
      const modelId = this.settingsStorage.getSettingValue(SG_MODELS, SK_MOD_CHAT);
      if (modelId) {
        model = await this.modelRepository.findById(modelId);
      }
    }
    return model;
  }

  /**
   * 构建会话上下文
   *
   * 该方法封装了会话上下文初始化的核心逻辑，包括：
   * - 模型解析与特性检查
   * - 设置合并（角色默认值 + 会话覆盖）
   * - 工具提示词注入（确保 systemPrompt Token 计数一致性）
   * - 上下文窗口计算（考虑 maxTokensLimit）
   * - ConversationContext 初始化
   *
   * 所有调用方使用完全相同的：systemPrompt（含 toolPrompts）、contextWindow、thinkingEnabled
   * 确保数据一致性，从根本上消除不一致问题。
   *
   * @param session 会话对象（由调用方传入，避免重复查询）
   * @param userMessageId 可选，指定加载到某条消息（仅对话场景需要）
   * @returns 包含上下文、工具上下文、生效的上下文窗口、思维链状态的结果
   */
  async buildContext(
    session: any,
    userMessageId?: string,
  ): Promise<BuildContextResult> {
    const sessionId = session.id;
    const userId = session.userId;

    const model = await this.resolveModel(session);
    const merged = this.mergeSettings(session);

    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");
    const supportsThinking = features.includes("thinking");

    // 注入工具提示词，确保 systemPrompt Token 计数与实际对话一致
    let toolPrompts = "";
    let toolContext: any;
    
    if (supportsTools) {
      // 创建工具上下文
      toolContext = this.toolContextFactory.createContext(
        sessionId, userId, merged.tools, merged.mcpServers, [],
      );
      
      // 获取工具提示词（用于构建 systemPrompt）
      toolPrompts = await this.toolOrchestrator.getAllToolPrompts(toolContext);
    }

    const fullSystemPrompt = [
      merged.systemPrompt,
      toolPrompts,
    ].filter(Boolean).join("\n");

    const thinkingEnabled = supportsThinking
      ? !!merged.thinkingEnabled
      : undefined;

    const effectiveContextWindow = this.calcEffectiveContextWindow(model, merged.memory);

    const context = await this.conversationContextFactory.create(sessionId, userId);
    await context.initialize({
      memory: merged.memory,
      systemPrompt: fullSystemPrompt,
      thinkingEnabled,
      userMessageId, // 可选参数，仅对话场景传入
      contextWindow: effectiveContextWindow,
      model: model || undefined,
    });

    // 始终返回 toolContext，由调用方决定是否需要
    return {
      context,
      toolContext,
      effectiveContextWindow,
      thinkingEnabled,
    };
  }

}
