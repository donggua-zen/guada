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
import { CompressionEngine, SummaryMode } from "./compression-engine";
import { LLMSummaryProvider } from "./llm-summary.provider";
import { LLMService } from "../../llm-core/llm.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { ProviderFileStore } from "../../llm-core/provider-file.store";
import { toRuntimeProviderConfig } from "../../llm-core/utils/provider-runtime.util";
import { EventBusService } from "../../../common/events/event-bus.service";
import { ToolOrchestrator } from "../../tools/tool-orchestrator.service";
import { buildSessionLlmParams } from "../session-llm-request.builder";
import type { ContextStatsPayload } from "../types/event-chunk.types";
import {
  SG_MODELS,
  SK_MOD_COMPRESS_MODEL,
} from "../../../constants/settings.constants";
import type { Message } from "../../../common/types/conversation.types";
import type { CompactionDataSource } from "./types";
import { CompactionCancelledError } from "./compaction-cancelled.error";
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
  /** 遮蔽消息条数（compacted 时 > 0） */
  shadowedCount: number;
  /** 遮蔽末位（分界点）消息 id（persistCompaction 的 lastCompactedMessageId / 前端标记依据） */
  shadowedEndId?: string;
  /** 摘要消息 id（compaction_summary 占位标识） */
  summaryMessageId?: string;
  /** 摘要文本（DISABLED 模式为空串） */
  summary?: string;
  /** 压缩运行结束后当前完整请求统计（live 广播压缩事件时携带，前端即时更新环形指示器） */
  contextStats?: ContextStatsPayload;
}

@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly compressionEngine: CompressionEngine,
    private readonly llmService: LLMService,
    private readonly settingsStorage: SettingsStorage,
    private readonly modelStore: ProviderFileStore,
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
   * → DB 压缩历史 → memory.compacted 事件
   */
  async compress(
    ds: CompactionDataSource,
    opts: CompressOptions = {},
  ): Promise<CompressOutcome> {
    this.throwIfCancelled(opts.abortSignal);
    const config = ds.getCompressionConfig();
    // 档位关闭（enabled=false）：非 force 直接旁路（协调器已门控，此处防御）
    if (!opts.force && config.enabled === false) {
      this.logger.log('Skipping compression: disabled by compression tier');
      return {
        messages: await ds.getHistory(),
        compacted: false,
        shadowedCount: 0,
      };
    }
    const currentTokens = await ds.getTokenCount();
    this.throwIfCancelled(opts.abortSignal);
    const window = ds.getEffectiveContextWindow();
    // 触发 = 验收线（对齐 DSH thresholdRatio；force 绕过）
    const thresholdTokens = Math.floor(
      window * (config.compressionTriggerRatio ?? 0.8),
    );
    if (!opts.force && currentTokens < thresholdTokens) {
      this.logger.log(
        `Skipping compression: ${currentTokens} tokens < threshold ${thresholdTokens}`,
      );
      return {
        messages: await ds.getHistory(),
        compacted: false,
        shadowedCount: 0,
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
    this.throwIfCancelled(opts.abortSignal);

    const result = await this.compressionEngine.execute(ds.sessionId, {
      // 用户中止信号：阶段边界快速退出（中止后不落任何 compaction 写入）
      abortSignal: opts.abortSignal,
      // 引擎唯一数据源：请求消息列表（与主请求逐字节一致，含 reasoning 策略处理后）
      messages: await ds.getHistory(),
      // S3：逐消息 token（快照同序），预算循环 O(1) 取值，免逐条估算
      perMessageTokens: await ds.getPerMessageTokens(),
      // 全量请求 token（prelude + 视图，provider 锚点）：引擎据此把"history-only"测量
      // 补足为完整请求占用（对齐 DSH measure = envelope + surface，避免门控少算系统提示/工具）
      requestTokens: currentTokens,
      contextWindow: window,
      triggerRatio: config.compressionTriggerRatio ?? 0.8,
      retainRatio: config.compressionRetainRatio ?? 0.2,
      // 溢出/手动路径：跳过触发判断 + retain 降为 0（对齐 DSH 溢出路径）
      force: opts.force ?? false,
      modelName: ds.getModelConfig().modelName,
      summaryProvider,
      summaryMode,
      // 压缩写经数据源窄接口（v1.4：引擎不再直插持久化，会话在写时增量播种快照）
      dataSource: ds,
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

    // 压缩后 surface：快照已由写路径增量播种，直接读（O(1)）
    const refreshed = await ds.getHistory();

    // 纯裁剪（无括号）路径无 compaction/end 锚点 → 补写一条独立 compaction/end 携带压缩后占用
    // （compacted 路径的锚点已由 appendCompact 的 compaction/end 承载）
    // beforeTokens = 压缩前实测占用（方法入口 currentTokens），供压缩历史 before/after 对比
    if (result.pruneEvents > 0 && !result.compacted) {
      await ds.recordContextAnchor?.(currentTokens);
    }

    // 压缩后占用（两路径统一）：供 live 广播压缩事件，前端即时更新环形指示器
    const contextStats = await ds.getContextStats();

    // 广播压缩完成（供记忆缓存等模块清除状态；携带 sessionContext 供订阅者
    // 注入压缩后提醒——如 todo 遗忘防护）。压缩历史由 JSONL compaction 事件聚合，无 DB 写入。
    this.notifyCompacted(ds, result);

    return {
      messages: refreshed,
      compacted: result.compacted,
      shadowedCount: result.shadowedCount,
      shadowedEndId: result.shadowedEndId,
      summaryMessageId: result.summaryMessageId,
      summary: result.summary,
      contextStats,
    };
  }

  // ─── 摘要 Provider 工厂 ───

  /** 用户中止检查：压缩各阶段边界快速退出（与引擎内检查点同语义） */
  private throwIfCancelled(abortSignal?: AbortSignal): void {
    if (abortSignal?.aborted) {
      throw new CompactionCancelledError();
    }
  }

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

    const system = ds.getSystemText();
    const tools = ds.getTools();

    return new LLMSummaryProvider(
      this.llmService,
      {
        modelName: model.modelName,
        provider: toRuntimeProviderConfig(model.provider),
        config: model.config,
        thinkingEfforts: model.thinkingEfforts,
      },
      {
        maxSummaryTokens: 2000,
        abortSignal,
        prefix: {
          system,
          ...tools.length > 0 ? { tools } : {},
        },
        // 复用主请求构建器：thinkingEffort/temperature/modelCapabilities 与主请求同源
        // → 前缀缓存最大命中（思考模式不一致会导致缓存失效）
        // 注：生产注入的 ds 为 JsonlSessionContext（同时 implements ISessionContext + CompactionDataSource），
        // 运行时安全；此处仅类型窄化（builder 需 ISessionContext 的多个读取方法）。
        buildParams: (messages) =>
          buildSessionLlmParams(ds as unknown as import('../session-context').ISessionContext, {
            messages,
            purpose: 'compaction',
            stream: true,
            maxTokens: 2000,
          }),
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
      const model = this.modelStore.findModel(compressionModelId);
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
  /** 广播压缩完成事件（仅摘要/丢弃路径；纯裁剪无历史条目，不广播） */
  private notifyCompacted(
    ds: CompactionDataSource,
    result: { compacted: boolean; summary?: string; shadowedEndId?: string },
  ): void {
    if (!result.compacted) return;
    this.eventBus.emit(HOOKS.MEMORY_COMPACTED, {
      sessionId: ds.sessionId,
      sessionContext: ds,
      timestamp: new Date().toISOString(),
    });
  }
}