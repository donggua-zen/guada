/**
 * 压缩服务（v1.3：压缩编排从 ISessionContext 彻底移出）
 *
 * 压缩能力完全自包含、可插拔：
 * - 决策（shouldCompress）+ 编排（compress）+ 摘要 Provider 工厂 + 持久化 + 插件事件
 * - 只依赖 CompactionDataSource 窄接口操作会话，不感知 ISessionContext
 * - 压缩模型解析（SK_MOD_COMPRESS_MODEL）与 LLM 摘要、DB 历史、事件广播全部内聚于此
 *
 * 与 deepseek-harness 的能力缝合层对齐：本服务即 compaction-basic 的等价物，
 * 会话（Session 等价物）只暴露数据，不含任何压缩语义。
 */
import { Injectable, Logger } from "@nestjs/common";
import { CompressionEngine, SummaryMode } from "../compression-engine";
import { LLMSummaryProvider } from "../llm-summary.provider";
import { LLMService } from "../../llm-core/llm.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { ModelRepository } from "../../../common/database/model.repository";
import { SessionContextStateRepository } from "../../../common/database/session-context-state.repository";
import { EventBusService } from "../../../common/events/event-bus.service";
import { ToolOrchestrator } from "../../tools/tool-orchestrator.service";
import {
  SG_MODELS,
  SK_MOD_COMPRESS_MODEL,
} from "../../../constants/settings.constants";
import type { Message } from "../../../common/types/conversation.types";
import type { CompactionDataSource } from "./types";
import type { ISessionContext } from "../session-context";
import {
  HOOKS,
  type BeforeCompactionPayload,
} from "../types/hooks.contract";

export interface CompressOptions {
  abortSignal?: AbortSignal;
  /** 强制压缩（溢出恢复/手动路径）：跳过阈值判断 */
  force?: boolean;
  /**
   * 钩子 payload 来源：确认二级压缩（摘要/丢弃）后发 compaction.before 事件
   * （记忆同步等订阅者须先于摘要完成；事件通道为唯一机制，替代旧 onBeforeCompaction 回调穿透）
   */
  hook?: { sessionContext: ISessionContext };
}

/** 压缩编排结果：刷新后的请求列表 + 压缩结果信息（供调用方广播 compaction_summary） */
export interface CompressOutcome {
  messages: Message[];
  /** 是否发生了二级压缩（遮蔽+摘要/丢弃） */
  compacted: boolean;
  /** 被遮蔽的消息 id（compacted 时非空） */
  shadowedMessageIds: string[];
  /** 摘要文本（DISABLED 模式为空串） */
  summary?: string;
}

@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly compressionEngine: CompressionEngine,
    private readonly llmService: LLMService,
    private readonly settingsStorage: SettingsStorage,
    private readonly modelRepository: ModelRepository,
    private readonly contextStateRepo: SessionContextStateRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** 决策：token 压力是否达到压缩阈值 */
  async shouldCompress(ds: CompactionDataSource): Promise<boolean> {
    const total = await ds.getTokenCount();
    const window = ds.getEffectiveContextWindow();
    const ratio = total / window;
    const triggerRatio = ds.getCompressionConfig().compressionTriggerRatio ?? 0.8;
    this.logger.debug(
      `Token stats: ${total}/${window} (${(ratio * 100).toFixed(1)}%), trigger at ${triggerRatio}`,
    );
    return ratio >= triggerRatio;
  }

  /**
   * 执行压缩编排：
   * pre_compact 事件 → 摘要 Provider 工厂（压缩模型解析+KV 前缀）→ CompressionEngine.execute
   * → 会话状态恢复（refreshAfterCompaction）→ DB 压缩历史 → memory.compacted 事件
   */
  async compress(
    ds: CompactionDataSource,
    opts: CompressOptions = {},
  ): Promise<CompressOutcome> {
    const currentTokens = await ds.getTokenCount();
    const config = ds.getCompressionConfig();
    const window = ds.getEffectiveContextWindow();
    const targetTokens = Math.floor(
      window * (config.compressionTargetRatio ?? 0.5),
    );
    // force（溢出恢复/手动路径）：绕过阈值判断强制压缩
    if (!opts.force && currentTokens <= targetTokens) {
      this.logger.log(
        `Skipping compression: ${currentTokens} tokens <= target ${targetTokens}`,
      );
      return {
        messages: await ds.getMessages(),
        compacted: false,
        shadowedMessageIds: [],
      };
    }

    // resolveSummaryMode 在会话侧合并解析（session > character > 全局），此处归一
    const summaryMode: SummaryMode = config.summaryMode ?? SummaryMode.DEFAULT;

    // 广播预压缩事件（无论最终走裁剪还是摘要，历史即将被处理）
    this.eventBus.emit(HOOKS.MEMORY_PRE_COMPACT, {
      sessionId: ds.sessionId,
      timestamp: new Date().toISOString(),
    });

    // 摘要 Provider 工厂：压缩模型解析 + KV 前缀（prelude/tools 与主请求一致）
    const summaryProvider =
      summaryMode === SummaryMode.DISABLED
        ? undefined
        : await this.buildSummaryProvider(ds, opts.abortSignal);

    const result = await this.compressionEngine.execute(ds.sessionId, {
      // 引擎唯一数据源：请求消息列表（与主请求逐字节一致，含 reasoning 策略处理后）
      messages: await ds.getHistory(),
      // 全量请求 token（prelude + 视图，provider 锚点）：引擎据此把"history-only"测量
      // 补足为完整请求占用（对齐 DSH measure = envelope + surface，避免门控少算系统提示/工具）
      requestTokens: currentTokens,
      contextWindow: window,
      triggerRatio: config.compressionTriggerRatio ?? 0.8,
      targetRatio: config.compressionTargetRatio ?? 0.5,
      modelName: ds.getModelConfig().modelName,
      summaryProvider,
      summaryMode,
      // 确认需要二级压缩后（引擎确认调用）：发 compaction.before 事件（parallel 等待订阅者
      // 完成——记忆同步是 LLM 轮次，须先于摘要；fail-open，失败不阻断压缩）
      onBeforeCompaction: opts.hook
        ? async () => {
            const payload: BeforeCompactionPayload = {
              sessionContext: opts.hook!.sessionContext,
              abortSignal: opts.abortSignal,
              summaryMode: config.summaryMode ?? SummaryMode.DEFAULT,
            };
            await this.eventBus.parallel(HOOKS.BEFORE_COMPACTION, payload);
          }
        : undefined,
      maxSummaryTokens: 2000,
    });
    this.logger.log(
      `[compaction] done: prune=${result.pruneEvents}, compacted=${result.compacted}`,
    );

    // 会话侧状态恢复（缓存失效+重载；会话职责，经数据源回调）
    const refreshed = await ds.refreshAfterCompaction();

    // 持久化压缩历史（DB sessionContextState，供压缩历史 UI 读取）+ 插件缓存失效事件
    await this.persistCompaction(ds, result, currentTokens);

    return {
      messages: refreshed,
      compacted: result.compacted,
      shadowedMessageIds: result.shadowedMessageIds,
      summary: result.summary,
    };
  }

  // ─── 摘要 Provider 工厂 ───

  /**
   * 构建摘要 Provider：
   * - 摘要模型 = SK_MOD_COMPRESS_MODEL 配置优先，回退会话当前模型
   * - KV 缓存友好前缀：prelude + tools 与主请求一致（对齐 DSH requestHeader 重放）
   */
  private async buildSummaryProvider(
    ds: CompactionDataSource,
    abortSignal?: AbortSignal,
  ): Promise<LLMSummaryProvider | undefined> {
    const fallbackModel = ds.getModelConfig();
    const model = await this.resolveCompressionModel(fallbackModel);
    if (!model?.modelName) return undefined;

    const prelude = await ds.getPrelude();
    const tools = ds.getTools();

    return new LLMSummaryProvider(
      this.llmService,
      {
        modelName: model.modelName,
        provider: model.provider,
        config: model.config,
      },
      {
        maxSummaryTokens: 2000,
        abortSignal,
        prefix: {
          prelude,
          ...tools.length > 0 ? { tools } : {},
        },
      },
    );
  }

  /** 压缩模型解析：SK_MOD_COMPRESS_MODEL 配置优先，回退会话模型 */
  private async resolveCompressionModel(fallbackModel: any): Promise<any> {
    const compressionModelId = await this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_MODEL,
      null,
    );
    if (!compressionModelId) return fallbackModel;
    try {
      const model = await this.modelRepository.findById(compressionModelId);
      if (model) {
        this.logger.debug(
          `Using dedicated compression model: ${model.modelName}`,
        );
        return model;
      }
    } catch (error) {
      this.logger.error(`Failed to load compression model:`, error);
    }
    return fallbackModel;
  }

  // ─── 持久化与事件 ───

  /** 压缩完成后：DB 压缩历史 + 插件缓存失效事件（memory.compacted） */
  private async persistCompaction(
    ds: CompactionDataSource,
    result: { compacted: boolean; summary?: string; shadowedMessageIds: string[] },
    currentTokens: number,
  ): Promise<void> {
    if (!result.compacted) return;
    try {
      const afterTokens = await ds.getTokenCount();
      await this.contextStateRepo.create(ds.sessionId, {
        summaryContent: result.summary || null,
        lastCompactedMessageId:
          result.shadowedMessageIds[result.shadowedMessageIds.length - 1] ??
          null,
        cleaningStrategy: result.summary ? "summarized" : "discarded",
        compressionStats: {
          beforeTokenCount: currentTokens,
          afterTokenCount: afterTokens,
        },
      });
    } catch (e) {
      this.logger.warn(`persist compression state failed: ${e}`);
    }
    // 广播压缩完成事件（供记忆缓存等模块清除状态）
    this.eventBus.emit(HOOKS.MEMORY_COMPACTED, {
      sessionId: ds.sessionId,
      timestamp: new Date().toISOString(),
    });
  }
}