/**
 * 微压缩服务（一级编排，对齐 zcode microcompact）
 *
 * 流程：档位门控 → 阈值 → 纯计划（microcompact.ts）→ 最小收益门 → start → 写入 → 占用锚点 → end。
 * - 档位 off（enabled=false）：与自动 LLM 压缩一起关闭（手动压缩仍可走二级）。
 * - 最小收益门：整批估算节省 < MICROCOMPACT_MIN_TOKEN_SAVINGS 时完全静默（不写库、不写锚点、不发事件），
 *   不为一两个字符的收益打断前缀缓存。
 * - 事件与 LLM 压缩一致（compression_start/end），携带 tier='micro' 供前端区分。
 * - 写入统一经 message/prune（strategy 区分工具裁剪/思考剥离），随后 recordContextAnchor
 *   结算占用（否则 provider 增量口径会抵消裁剪收益，占用不降）。
 * - 失败 fail-open：微压缩异常不阻断回合；已发 start 时补 compression_error。
 */
import { Injectable, Logger } from '@nestjs/common';
import { TokenMeterService } from '../token-meter.service';
import type { CompactionDataSource, CompressionSaving } from './types';
import type { ISessionContext } from '../session-context';
import type {
  CompressionEndEvent,
  CompressionErrorEvent,
  CompressionStartEvent,
  ContextStatsPayload,
} from '../types/event-chunk.types';
import {
  buildMicrocompactPlan,
  buildMicrocompactThreshold,
  MICROCOMPACT_MIN_TOKEN_SAVINGS,
  type MicrocompactMessage,
} from './microcompact';

export type MicrocompactSkipReason =
  | 'tier-disabled'
  | 'below-threshold'
  | 'nothing-to-do'
  | 'below-min-savings'
  | 'cancelled'
  | 'failed';

export interface MicrocompactOutcome {
  applied: boolean;
  reason?: MicrocompactSkipReason;
  /** 本次写入的工具结果裁剪条数 */
  toolPruneCount?: number;
  /** 本次剥离思考的消息数 */
  thinkingStripCount?: number;
  /** 估算总节省 token */
  totalTokenSavings?: number;
  /** 压缩后占用（供事件与调用方复用） */
  contextStats?: ContextStatsPayload;
}

@Injectable()
export class MicrocompactService {
  private readonly logger = new Logger(MicrocompactService.name);

  constructor(private readonly tokenMeter: TokenMeterService) {}

  /** 微压缩主入口（agent PRE_STEP 每步调用；只做本地计算与写库，无 LLM 调用） */
  async maybeMicrocompact(
    context: ISessionContext,
    opts: { abortSignal?: AbortSignal } = {},
  ): Promise<MicrocompactOutcome> {
    const ds = context as unknown as CompactionDataSource;
    const config = ds.getCompressionConfig();
    // 档位 off：自动两级全关（手动压缩不受此门控）
    if (config.enabled === false) return { applied: false, reason: 'tier-disabled' };

    const llmThreshold = Math.floor(
      ds.getEffectiveContextWindow() * (config.compressionTriggerRatio ?? 0.8),
    );
    const microThreshold = buildMicrocompactThreshold(llmThreshold);
    const beforeTokens = await ds.getTokenCount();
    if (beforeTokens < microThreshold) return { applied: false, reason: 'below-threshold' };
    if (opts.abortSignal?.aborted) return { applied: false, reason: 'cancelled' };

    const modelName = ds.getModelConfig().modelName;
    const messages = (await ds.getHistory()) as MicrocompactMessage[];
    const plan = await buildMicrocompactPlan({
      messages,
      nowMs: Date.now(),
      estimateTextTokens: (text) => this.tokenMeter.estimateTextTokens(modelName, text),
    });
    if (plan.entries.length === 0) return { applied: false, reason: 'nothing-to-do' };
    if (plan.totalTokenSavings < MICROCOMPACT_MIN_TOKEN_SAVINGS) {
      this.logger.debug(
        `[micro] skipped: savings ${plan.totalTokenSavings} < ${MICROCOMPACT_MIN_TOKEN_SAVINGS}`,
      );
      return { applied: false, reason: 'below-min-savings' };
    }

    // 计划与门槛全部通过后才上报（避免每步闪烁"压缩中"占位卡）
    await context.publishStream({
      type: 'compression_start',
      reason: 'auto',
      tier: 'micro',
    } as CompressionStartEvent);

    try {
      for (const entry of plan.entries) {
        await ds.appendPrune({
          messageId: entry.messageId,
          newContent: entry.newContent,
          prunedBytes: entry.prunedBytes,
          strategy: entry.strategy,
          prunedTokens: entry.prunedTokens,
        });
      }
      const savings: CompressionSaving[] = plan.entries
        .filter((entry) => entry.prunedTokens > 0)
        .map((entry) => ({ index: entry.index, tokens: entry.prunedTokens }));
      // 占用锚点：与 compaction.service 的纯裁剪路径同范式
      // （锚点之前的节省需显式扣减，否则 provider 增量口径抵消裁剪收益）
      await ds.recordContextAnchor?.({ beforeTokens, savings });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[micro] failed (fail-open): ${message}`);
      await context.publishStream({
        type: 'compression_error',
        error: message,
      } as CompressionErrorEvent);
      return { applied: false, reason: 'failed' };
    }

    const contextStats = await ds.getContextStats();
    await context.publishStream({
      type: 'compression_end',
      reason: 'auto',
      tier: 'micro',
      pruneEvents: plan.toolPruneCount,
      thinkingStrippedCount: plan.thinkingStripCount,
      compacted: false,
      contextStats,
    } as CompressionEndEvent);
    this.logger.log(
      `[micro] applied: toolPrune=${plan.toolPruneCount}, thinkingStrip=${plan.thinkingStripCount}, savings=${plan.totalTokenSavings}`,
    );
    return {
      applied: true,
      toolPruneCount: plan.toolPruneCount,
      thinkingStripCount: plan.thinkingStripCount,
      totalTokenSavings: plan.totalTokenSavings,
      contextStats,
    };
  }
}
