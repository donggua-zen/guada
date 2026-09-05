/**
 * 统一压缩引擎（后端无关，全数据输入）
 *
 * 纯计算 + 写入引擎：消息数据由调用方传入（请求消息列表），引擎不读存储、不改写消息。
 * 阈值设计对齐 DSH（compaction-basic）：
 *   - 触发 = 验收 = thresholdRatio（0.8）：prune 后 < 0.8 即达标，不触发 LLM；
 *     只有 prune 后仍 ≥ 0.8 才走 LLM 压缩。
 *   - retainRatio（0.2）：压缩时保留的最近尾预算（遮蔽区之外原样保留）。
 *   - prune 一次性持久化（裁完就没了）+ 压缩压得深（0.2）→ 复触发间隔长，无需阶梯。
 *
 * 写入统一经 CompactionDataSource 的窄写接口（options.dataSource）——引擎不感知持久化后端细节。
 *
 * 不变量：
 * - 一级裁剪不修改原消息：prune 是纯计算方案 + 经 appendPrune 写入，引擎不就地改写消息对象；
 *   压缩路径【先生成摘要（读原消息）再写 prune】→ 摘要输入与上一次主请求逐字节一致 → KV 命中。
 * - 保护区：最近 PROTECTED_RECENT_TOOL_RESULTS_COUNT 条 tool result（+ tool_learn/todo）
 *   不裁剪（模型不失忆）。
 * - 遮蔽表示：shadowedEndId（分界点消息 id）+ shadowedCount（前端标记、replayer O(1) 头删除）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { TokenMeterService } from '../token-meter.service';
import type {
  Message,
  ContentBlock,
} from '../../../common/types/conversation.types';
import type { CompactionDataSource } from './types';
import { CompactionCancelledError } from './compaction-cancelled.error';
import { toolPairingBalancedBefore } from './tool-pairing';

// 与压缩策略一致的常量
export const PRUNING_TOOL_RESULT_MAX_LENGTH = 1000;
export const PROTECTED_RECENT_TOOL_RESULTS_COUNT = 3;
export const MIN_RETAINED_MESSAGES = 3;

/** 摘要生成模式 */
export enum SummaryMode {
  /** 关闭摘要：直接丢弃待压缩内容，不生成摘要 */
  DISABLED = 'disabled',
  /** 快速摘要：传统单次调用方式，快速生成摘要 */
  FAST = 'fast',
  /** 记忆同步：压缩前先让 AI 保存记忆到文件，再执行 LLM 摘要 */
  MEMORY_SYNC = 'memory_sync',
  /** 默认摘要模式（指向 MEMORY_SYNC），统一修改入口 */
  DEFAULT = 'memory_sync',
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

/** 一级裁剪方案条目（纯计算产物；index 用于"只裁剪保留尾"过滤） */
interface PrunePlanEntry {
  index: number;
  messageId: string;
  newContent: string;
  prunedBytes: number;
  prunedTokens?: number;
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
  /** 对话模型名（token 估算用；估算只影响裁剪/保留决策，与摘要模型无关） */
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
  /** 一级裁剪（pruner）参数化配置（对齐 DSH modelPolicies 按模型路由裁剪预算） */
  pruning?: {
    /** 超长 tool-result 裁剪阈值（字符数，默认 1000） */
    maxLength?: number;
    /** 受保护的最近 tool-result 条数（默认 3） */
    protectedRecent?: number;
    /** 裁剪保留（头尾各）字符数（默认 maxLength/2） */
    headTailChars?: number;
  };
  /**
   * 压缩写入数据源（CompactionDataSource 的写子接口）：一级裁剪/二级遮蔽统一经此落库，
   * 引擎不感知持久化后端细节（与读路径窄接口同层解耦）。
   */
  dataSource: Pick<CompactionDataSource, 'appendPrune' | 'appendCompact'>;
}

export interface CompressionResult {
  pruneEvents: number;      // 写入的 prune 事件数
  compacted: boolean;       // 是否触发二级压缩
  /** 遮蔽消息条数（compacted 时 > 0） */
  shadowedCount: number;
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 / persistCompaction 的 lastCompactedMessageId */
  shadowedEndId?: string;
  /** 摘要消息 id（compaction_summary 事件占位标识） */
  summaryMessageId?: string;
  summary?: string;
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
   * 执行压缩（对齐 DSH compactIfNeeded）：
   * ① 触发（原文测量）→ ② 纯计算 prune 方案 → ③ prune 后 < 触发线则只裁剪；
   * ④ 否则 LLM 压缩（先生成摘要再写 prune → 摘要读原消息、前缀命中）。
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

    // ① 触发判断（原文测量；force=溢出恢复路径，跳过阈值）
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
      return { pruneEvents: 0, compacted: false, shadowedCount: 0 };
    }

    // ② 纯计算 prune 方案（全 surface，保护区除外）——不改写消息、不落库
    const plan = await this.buildPrunePlan(sessionId, options, modelName);
    this.throwIfCancelled(options);
    const prunedTokenDelta = plan.reduce(
      (acc, p) => acc + (p.prunedTokens ?? 0),
      0,
    );

    // ③ 决策：prune 后是否 < 触发线（验收 = 触发，对齐 DSH）
    //    无 provider 且非 DISABLED → 无法摘要，仅能裁剪
    const canCompact =
      !!options.summaryProvider || options.summaryMode === SummaryMode.DISABLED;
    const afterPruneAll = historyTokens - prunedTokenDelta + envelopeDelta;
    if (!canCompact || (!options.force && afterPruneAll < thresholdTokens)) {
      if (!canCompact) {
        this.logger.warn('[compress] 无 summaryProvider，跳过摘要压缩');
      }
      // 只裁剪（无压缩 → 无遮蔽/摘要 → 无前缀问题）
      await this.applyPrunePlan(options, plan);
      return { pruneEvents: plan.length, compacted: false, shadowedCount: 0 };
    }

    // ④ 压缩（LLM 摘要 / DISABLED）：压缩路径裁剪只作用于保留尾，遮蔽区保持原文
    //    手动/溢出（force）只跳过触发判断，retain 仍按配置比例（默认 0.2）——不归零
    const retainRatio = options.retainRatio ?? 0.2;
    const retainTokens = Math.floor(options.contextWindow * retainRatio);
    const boundary = await this.computeBoundary(
      sessionId,
      options,
      modelName,
      retainTokens,
    );

    const shadowedMessages = messages.slice(0, boundary);
    const shadowedCount = shadowedMessages.length;
    if (shadowedCount === 0) {
      // 无可遮蔽（如单条超大消息撑爆预算）→ 只落 prune 兜底
      await this.applyPrunePlan(options, plan);
      return { pruneEvents: plan.length, compacted: false, shadowedCount: 0 };
    }
    const shadowedEndId = shadowedMessages[shadowedCount - 1].id;

    // ④a 摘要输入 = messages[0..boundary)（原消息——此时尚未写入任何 prune → 与上次主请求一致 → 前缀命中）
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
      );
      summary = gen.summary;
      summaryUsage = gen.usage;
    } else {
      mode = SummaryMode.DISABLED; // 无 provider → DISABLED 丢弃
    }

    // ④b 压缩路径也裁剪保留尾 [boundary..n)（保护区除外）——摘要已取原文，此后写入不影响前缀
    const tailPlan = plan.filter((p) => p.index >= boundary);
    await this.applyPrunePlan(options, tailPlan);

    // ④c 写 compaction 括号事件（遮蔽 [0..boundary) + 摘要）——提交前最后一道中止检查，
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
      pruneEvents: tailPlan.length,
      compacted: true,
      shadowedCount,
      shadowedEndId,
      summaryMessageId,
      summary,
    };
  }

  // ─── 一级裁剪（纯计算 + 写入）───

  /**
   * 构建裁剪方案（纯计算：不改写消息、不落库）：对超预算 tool-result 计算 newContent + 影子价格。
   * 保护区（最近 N 条 + tool_learn/todo）不裁剪。
   * @returns 方案条目（含消息 index，供"只裁剪保留尾"过滤）与影子价格累计
   */
  private async buildPrunePlan(
    sessionId: string,
    options: CompressionOptions,
    modelName: string,
  ): Promise<PrunePlanEntry[]> {
    const { messages } = options;
    const maxLength =
      options.pruning?.maxLength ?? PRUNING_TOOL_RESULT_MAX_LENGTH;
    const protectedRecent =
      options.pruning?.protectedRecent ?? PROTECTED_RECENT_TOOL_RESULTS_COUNT;
    const headTailChars =
      options.pruning?.headTailChars ?? Math.floor(maxLength / 2);

    // 收集所有超预算 tool-result（按消息顺序；index 用于保留尾过滤）
    const candidates: Array<{
      index: number;
      msg: Message;
      tr: Extract<ContentBlock, { type: 'tool-result' }>;
    }> = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.source.kind !== 'tool') continue;
      const tr = msg.content.find(
        (b): b is Extract<ContentBlock, { type: 'tool-result' }> =>
          b.type === 'tool-result',
      );
      if (tr && tr.content.length > maxLength) {
        candidates.push({ index: i, msg, tr });
      }
    }

    // 保护区：从后往前跳过最近 N 条（+ tool_learn/todo 恒跳过）
    const plan: PrunePlanEntry[] = [];
    let protectedCount = 0;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const { index, msg, tr } = candidates[i];
      if (tr.name === 'tool_learn' || tr.name === 'todo') continue;
      if (protectedCount < protectedRecent) {
        protectedCount++;
        continue;
      }
      const content = tr.content;
      const newContent = `${safeSubstring(content, 0, headTailChars)}...[omitted ${content.length - maxLength} characters]...${safeTail(content, headTailChars)}`;
      // 影子价格：原内容估 − 裁剪后估（estimateTextTokens 走文本直算、无缓存污染）
      const prunedTokens =
        (await this.tokenMeter.estimateTextTokens(modelName, content)) -
        (await this.tokenMeter.estimateTextTokens(modelName, newContent));
      plan.push({
        index,
        messageId: msg.id,
        newContent,
        prunedBytes: content.length - newContent.length,
        prunedTokens: prunedTokens > 0 ? prunedTokens : undefined,
      });
    }
    return plan;
  }

  /** 应用裁剪方案（经 dataSource.appendPrune 写入；不改写消息对象） */
  private async applyPrunePlan(
    options: CompressionOptions,
    plan: PrunePlanEntry[],
  ): Promise<void> {
    this.throwIfCancelled(options);
    for (const p of plan) {
      await options.dataSource.appendPrune({
        messageId: p.messageId,
        newContent: p.newContent,
        prunedBytes: p.prunedBytes,
        strategy: 'head_tail_prune',
        prunedTokens: p.prunedTokens,
      });
    }
  }

  // ─── 二级压缩 ───

  /**
   * 计算遮蔽边界：从尾部往回累计 token 到 retainTokens 预算（对齐 DSH selectCompactableRange），
   * 预算过小强制保留最近 MIN_RETAINED_MESSAGES 条；tool-pairing 平衡不切断配对。
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
   * 生成摘要（输入 = 原消息遮蔽区，未写入任何 prune → 与上次主请求前缀一致）。
   * 收敛不变量：摘要 token 必须小于被遮蔽内容，超限在 retries 内重压。
   */
  private async generateSummary(
    sessionId: string,
    options: CompressionOptions,
    modelName: string,
    shadowedMessages: Message[],
  ): Promise<{ summary: string; usage?: SummaryResult['usage'] }> {
    const { messages } = options;
    const retries = options.compactionRetries ?? 1;
    const shadowedTokens = await this.tokenMeter.estimateMessages(
      sessionId,
      modelName,
      shadowedMessages,
    );

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

function safeSubstring(str: string, start: number, length: number): string {
  if (str.length <= start) return '';
  return str.substring(start, Math.min(str.length, start + length));
}

function safeTail(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(str.length - length);
}
