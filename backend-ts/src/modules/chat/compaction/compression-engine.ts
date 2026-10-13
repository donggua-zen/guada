/**
 * 压缩引擎（二级：LLM 摘要遮蔽；对齐 DSH compaction-basic）
 *
 * 纯计算 + 写入引擎：消息数据由调用方传入（请求消息列表），引擎不读存储、不改写消息。
 * 一级微压缩（工具结果裁剪 + 思考剥离）已拆分为独立模块（microcompact.ts / MicrocompactService）：
 * 本引擎不做任何 prune，单次压缩只走一级或二级（手动/溢出路径只走二级）。
 *
 * 阈值设计对齐 DSH（compaction-basic）：
 *   - 触发 = 验收 = thresholdRatio（0.8）：达到即摘要遮蔽
 *   - retainRatio（0.2）：压缩时保留的最近尾预算（遮蔽区之外原样保留）
 *   - 遮蔽表示：shadowedEndId（分界点消息 id）+ shadowedCount（前端标记、replayer O(1) 头删除）
 *
 * 写入统一经 CompactionDataSource 的窄写接口（options.dataSource）——引擎不感知持久化后端细节。
 *
 * 不变量：
 * - 摘要输入与上一次主请求逐字节一致（此时未写入任何改写）→ KV 前缀命中。
 * - 遮蔽区不做裁剪：整段由摘要替换；保留尾同样不再裁剪（微压缩独立处理）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { TokenMeterService } from '../token-meter.service';
import type { Message } from '../../../common/types/conversation.types';
import type { CompactionDataSource } from './types';
import { CompactionCancelledError } from './compaction-cancelled.error';
import { toolPairingBalancedBefore } from './tool-pairing';

/** 压缩时保留的最近消息条数下限（token 预算过小时强制保留） */
export const MIN_RETAINED_MESSAGES = 3;

/** 摘要生成模式 */
export enum SummaryMode {
  /** 关闭摘要：直接丢弃待压缩内容，不生成摘要 */
  DISABLED = 'disabled',
  /** 快速摘要：单次 LLM 调用生成摘要（不跑压缩前影子轮次） */
  FAST = 'fast',
  /** 记忆同步：压缩前先让 AI 保存记忆到文件，再执行 LLM 摘要（当前禁用，见 compression-tiers.ts 开关点） */
  MEMORY_SYNC = 'memory_sync',
  /**
   * 默认摘要模式（指向 FAST）。
   * 取 FAST 而非 MEMORY_SYNC：档位预设当前一律不跑影子轮次，默认值须与之一致，
   * 否则任何走 `?? DEFAULT` 兜底的路径会意外重新拉起影子轮次。
   */
  DEFAULT = 'fast',
}

/** 摘要生成输入：遮蔽区（请求消息）+ 全部可见（提取旧检查点） */
export interface SummaryInput {
  /** 全部可见消息（含历史 compaction 摘要事件消息，供提取旧检查点） */
  allMessages: Message[];
  /** 遮蔽消息（来自请求消息列表本身，与主请求逐字节一致） */
  shadowed: Message[];
}

/** 摘要生成结果（流式累积可取 usage，对齐 DSH SummaryResult） */
export interface SummaryResult {
  summary: string;
  usage?: import('../../../common/types/stream-chunk.types').StreamUsage;
}

/** 摘要生成器（由调用方注入 LLM 调用） */
export interface SummaryProvider {
  generate(input: SummaryInput): Promise<SummaryResult>;
}

export interface CompressionOptions {
  /** 请求消息列表（context.history，与主请求逐字节一致）——引擎唯一的消息数据源 */
  messages: Message[];
  contextWindow: number;
  /** 触发 = 验收线（默认 0.8，对齐 DSH thresholdRatio） */
  triggerRatio?: number;
  /** 压缩保留尾预算（默认 0.2；遮蔽区之外原样保留） */
  retainRatio?: number;
  /**
   * 当前完整请求 token（prelude + 视图，provider 锚点，由调用方经 ds.getTokenCount() 传入）。
   * 引擎据此把"history-only"测量补足为完整请求占用（对齐 DSH measure = envelope + surface，
   * 避免门控少算 system/tools/userPrompt）；缺省退化为纯历史口径（envelopeDelta=0）。
   */
  requestTokens?: number;
  /** 对话模型名（token 估算用；估算只影响保留决策，与摘要模型无关） */
  modelName?: string;
  /**
   * 逐消息 token（与 messages 同序，来自会话快照）。预算循环据此 O(1) 取值，
   * 避免逐条调用 estimateMessages 的 n 次函数调用。
   */
  perMessageTokens?: readonly number[];
  summaryProvider?: SummaryProvider;
  summaryMode?: SummaryMode;
  /** 摘要输出 token 上限（默认 2000） */
  maxSummaryTokens?: number;
  /** 收敛重压次数（摘要不小于被遮蔽内容时，默认 1） */
  compactionRetries?: number;
  /** 确认需要二级压缩（摘要/丢弃）后触发的钩子（compaction.before 事件的唯一时序来源：
   *  由调用方 CompactionService 注入并发射事件，记忆保存等订阅者须先于摘要完成） */
  onBeforeCompaction?: () => Promise<void>;
  /** 用户中止信号：阶段边界检查（中止后快速退出，不落任何写入） */
  abortSignal?: AbortSignal;
  /** 强制压缩（手动/上下文溢出恢复路径）：跳过 triggerRatio 阈值判断；retain 仍按配置比例 */
  force?: boolean;
  /**
   * 压缩写入数据源（CompactionDataSource 的写子接口）：二级遮蔽经此落库，
   * 引擎不感知持久化后端细节（与读路径窄接口同层解耦）。
   */
  dataSource: Pick<CompactionDataSource, 'appendCompact'>;
}

/**
 * 未发生压缩的原因（compacted=false 时供前端/日志解释"为什么压缩没做事"）。
 * - below-threshold：未达触发线（自动路径）
 * - no-summary-provider：无可用摘要 provider 且非 DISABLED（无法摘要）
 * - retain-budget-exceeds-history：保留预算 ≥ 整段历史 → 无可遮蔽（窗口大 / 内容小）
 */
export type CompressionSkipReason =
  | 'below-threshold'
  | 'no-summary-provider'
  | 'retain-budget-exceeds-history';

export interface CompressionResult {
  /** 是否触发二级压缩 */
  compacted: boolean;
  /** 遮蔽消息条数（compacted 时 > 0） */
  shadowedCount: number;
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 / persistCompaction 的 lastCompactedMessageId */
  shadowedEndId?: string;
  /** 摘要消息 id（compaction_summary 事件占位标识） */
  summaryMessageId?: string;
  summary?: string;
  /** 未压缩原因（compacted=false 时给出） */
  skipReason?: CompressionSkipReason;
}

@Injectable()
export class CompressionEngine {
  private readonly logger = new Logger(CompressionEngine.name);

  constructor(private readonly tokenMeter: TokenMeterService) {}

  /** 用户中止检查：阶段边界快速退出，保证取消后不落任何 compaction 写入 */
  private throwIfCancelled(options: CompressionOptions): void {
    if (options.abortSignal?.aborted) {
      throw new CompactionCancelledError();
    }
  }

  /**
   * 执行二级压缩（对齐 DSH compactIfNeeded）：
   * ① 触发判断（原文测量，force 跳过）→ ② 摘要可用性 → ③ 遮蔽边界（保留尾预算 + tool-pairing）
   * → ④ 摘要（读原消息，前缀命中）→ 写 compaction 括号事件。
   * @param sessionId 会话 ID
   * @param options 压缩配置（messages 为请求消息列表，引擎唯一数据源；dataSource 为写接口）
   */
  async execute(
    sessionId: string,
    options: CompressionOptions,
  ): Promise<CompressionResult> {
    const { messages } = options;
    const triggerRatio = options.triggerRatio ?? 0.8;
    const modelName = options.modelName || 'gpt-4o';
    this.throwIfCancelled(options);

    // ① 触发判断（原文测量；force=手动/溢出恢复路径，跳过阈值）
    const historyTokens = await this.tokenMeter.estimateMessages(
      sessionId,
      modelName,
      messages,
    );
    this.throwIfCancelled(options);
    const envelopeDelta =
      options.requestTokens === undefined
        ? 0
        : Math.max(0, options.requestTokens - historyTokens);
    const thresholdTokens = Math.floor(options.contextWindow * triggerRatio);
    const total = historyTokens + envelopeDelta;
    if (!options.force && total < thresholdTokens) {
      return {
        compacted: false,
        shadowedCount: 0,
        skipReason: 'below-threshold',
      };
    }

    // ② 摘要可用性：无 provider 且非 DISABLED → 无法摘要（一级微压缩已独立，不再降级裁剪）
    const canCompact =
      !!options.summaryProvider || options.summaryMode === SummaryMode.DISABLED;
    if (!canCompact) {
      this.logger.warn('[compress] 无 summaryProvider，跳过摘要压缩');
      return {
        compacted: false,
        shadowedCount: 0,
        skipReason: 'no-summary-provider',
      };
    }

    // ③ 保留预算按"实际占用"折算（min(窗口, 实测总量)）：内容小于窗口时（手动/溢出路径）
    //    按内容比例保留；否则预算可能超过整段历史 → 边界为 0 → 压缩退化。
    const retainRatio = options.retainRatio ?? 0.2;
    const retainTokens = Math.floor(
      Math.min(options.contextWindow, total) * retainRatio,
    );
    const boundary = await this.computeBoundary(
      sessionId,
      options,
      modelName,
      retainTokens,
    );

    const shadowedMessages = messages.slice(0, boundary);
    const shadowedCount = shadowedMessages.length;
    if (shadowedCount === 0) {
      // 无可遮蔽（如单条超大消息撑爆预算）→ 不做任何改写
      return {
        compacted: false,
        shadowedCount: 0,
        skipReason: 'retain-budget-exceeds-history',
      };
    }
    const shadowedEndId = shadowedMessages[shadowedCount - 1].id;
    // 遮蔽区 token（收敛判定共用；只估一次）
    const shadowedTokens = await this.tokenMeter.estimateMessages(
      sessionId,
      modelName,
      shadowedMessages,
    );

    // ④a 摘要输入 = messages[0..boundary)（原消息——此时未写入任何改写 → 与上次主请求一致 → 前缀命中）
    let summary = '';
    let summaryUsage: SummaryResult['usage'] | undefined;
    let mode = options.summaryMode ?? SummaryMode.DEFAULT;
    if (options.summaryProvider) {
      // 确认需要二级压缩后才触发回调（记忆保存等订阅者须先于摘要完成）
      if (options.onBeforeCompaction) {
        try {
          await options.onBeforeCompaction();
        } catch (e) {
          this.logger.warn(`onBeforeCompaction failed: ${e}`);
        }
      }
      // 影子轮（记忆同步等订阅者）可能耗时较长且 fail-open 吞错——回调之后复查中止，
      // 取消必须穿透（不能放进上面的 try，否则被 fail-open 吞掉后继续摘要）
      this.throwIfCancelled(options);
      const gen = await this.generateSummary(
        sessionId,
        options,
        modelName,
        shadowedMessages,
        shadowedTokens,
      );
      summary = gen.summary;
      summaryUsage = gen.usage;
    } else {
      mode = SummaryMode.DISABLED; // 无 provider → DISABLED 丢弃
    }

    // ④b 写 compaction 括号事件（遮蔽 [0..boundary) + 摘要）——提交前最后一道中止检查，
    // 保证取消后不落任何 compaction 写入
    this.throwIfCancelled(options);
    const { summaryMessageId } = await options.dataSource.appendCompact({
      shadowedEndId,
      shadowedCount,
      summary,
      mode,
      ...(summaryUsage === undefined ? {} : { usage: summaryUsage }),
    });

    this.logger.log(
      `[compress] compacted ${shadowedCount} messages (mode=${mode}), retained ${messages.length - boundary} messages, summary=${summary.length} chars`,
    );
    return {
      compacted: true,
      shadowedCount,
      shadowedEndId,
      summaryMessageId,
      summary,
    };
  }

  // ─── 二级压缩 ───

  /**
   * 计算遮蔽边界：从尾部往回累计 token 到 retainTokens 预算（对齐 DSH selectCompactableRange），
   * 预算过小强制保留最近 MIN_RETAINED_MESSAGES 条；tool-pairing 平衡不切断配对。
   * 只保证工具配对，不保证轮次完整（轮次保护由一级微压缩负责）。
   */
  private async computeBoundary(
    sessionId: string,
    options: CompressionOptions,
    modelName: string,
    retainTokens: number,
  ): Promise<number> {
    const { messages } = options;
    const tokens = options.perMessageTokens;
    let acc = 0;
    let boundary = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens =
        tokens !== undefined
          ? (tokens[i] ?? 0)
          : await this.tokenMeter.estimateMessages(
              sessionId,
              modelName,
              [messages[i]],
            );
      if (acc + msgTokens > retainTokens) break;
      acc += msgTokens;
      boundary = i;
    }
    const minRetain = Math.max(0, messages.length - MIN_RETAINED_MESSAGES);
    if (boundary > minRetain) boundary = minRetain;
    return toolPairingBalancedBefore(messages, boundary);
  }

  /**
   * 生成摘要（输入 = 原消息遮蔽区，未写入任何改写 → 与上次主请求前缀一致）。
   * 收敛不变量：摘要 token 必须小于被遮蔽内容，超限在 retries 内重压。
   * @param shadowedTokens 遮蔽区 token（调用方已估，避免重复估算）
   */
  private async generateSummary(
    sessionId: string,
    options: CompressionOptions,
    modelName: string,
    shadowedMessages: Message[],
    shadowedTokens: number,
  ): Promise<{ summary: string; usage?: SummaryResult['usage'] }> {
    const { messages } = options;
    const retries = options.compactionRetries ?? 1;

    let summary = '';
    let usage: SummaryResult['usage'] | undefined;
    let attempts = 0;
    for (;;) {
      attempts++;
      this.throwIfCancelled(options);
      const result = await options.summaryProvider!.generate({
        allMessages: messages,
        shadowed: shadowedMessages,
      });
      summary = result.summary;
      usage = result.usage;
      const summaryTokens = await this.tokenMeter.estimateMessages(
        sessionId,
        modelName,
        [
          {
            ...(shadowedMessages[0] ?? messages[0] ?? emptyMessage()),
            content: [
              {
                type: 'text' as const,
                text: summary,
              },
            ],
          },
        ],
      );
      this.logger.debug(
        `[compress] summary attempt ${attempts}: ${summaryTokens} tokens, shadowed ${shadowedTokens} tokens`,
      );
      if (summaryTokens < shadowedTokens || attempts > retries) break;
      this.logger.warn(
        `[compress] summary (${summaryTokens}) not smaller than shadowed (${shadowedTokens}), retrying (${attempts}/${retries})`,
      );
    }
    return { summary, usage };
  }
}

// ─── 工具函数 ───

function emptyMessage(): Message {
  return {
    id: '',
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [],
  };
}
