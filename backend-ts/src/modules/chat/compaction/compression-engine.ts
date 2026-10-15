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
import { isContextWindowExceeded } from '../../llm-core/utils/retry-on-error.util';

/** 压缩时保留的最近消息条数下限（token 预算过小时强制保留） */
export const MIN_RETAINED_MESSAGES = 3;

/** 摘要输出预留：预算从摘要模型窗口里先扣掉这部分（与 provider 的 maxSummaryTokens=2000 对齐） */
export const SUMMARY_OUTPUT_RESERVE_TOKENS = 2_000;
/** 摘要输入安全余量：max(固定值, 窗口比例)——覆盖估算漂移与端点计数差异 */
export const SUMMARY_INPUT_SAFETY_MARGIN_TOKENS = 8_000;
export const SUMMARY_INPUT_SAFETY_MARGIN_RATIO = 0.05;
/** COMPACTION_INSTRUCTION（约 1863 字符）的 token 估算，留裕量取 600 */
export const SUMMARY_INSTRUCTION_TOKENS_EST = 600;
/** provider 仍拒绝时"收紧预算 + 抬高边界"的重试上限（zcode 同款 3） */
const MAX_SUMMARY_INPUT_RETRIES = 3;
/** 手动路径截断最旧遮蔽区的最多次数（zcode 同款 3） */
const MAX_SUMMARY_TRUNCATION_ATTEMPTS = 3;
/** 摘要输入外循环的硬上限（防止收紧/截断两条路径叠加失控） */
const MAX_SUMMARY_INPUT_LOOP_ATTEMPTS = MAX_SUMMARY_INPUT_RETRIES + MAX_SUMMARY_TRUNCATION_ATTEMPTS + 1;
/** 截断标记（与 zcode COMPACT_PROMPT_TOO_LONG_RETRY_MARKER 同款文案） */
export const SUMMARY_TRUNCATION_MARKER = '[earlier conversation truncated for compaction retry]';

/**
 * 摘要输入硬预算：摘要模型窗口 − 输出预留 − 安全余量。
 * 缺省窗口 128000 与 calcEffectiveContextWindow 的兜底一致；调用方（CompactionService）负责喂窗口。
 */
export function resolveSummaryInputBudgetTokens(modelWindowTokens: number | undefined): number {
  const window =
    modelWindowTokens !== undefined && Number.isFinite(modelWindowTokens) && modelWindowTokens > 0
      ? Math.floor(modelWindowTokens)
      : 128_000;
  const margin = Math.max(
    SUMMARY_INPUT_SAFETY_MARGIN_TOKENS,
    Math.floor(window * SUMMARY_INPUT_SAFETY_MARGIN_RATIO),
  );
  return Math.max(0, window - SUMMARY_OUTPUT_RESERVE_TOKENS - margin);
}

/** 保留预算状态（含可行性；旧口径 ratioBudget 自此只作下界） */
interface RetainBudgetState {
  retainTokens: number;
  ratioBudget: number;
  minRetain: number;
  maxRetain: number;
  feasible: boolean;
}

/**
 * 由"摘要输入硬预算"推导保留量：
 * 摘要请求 = 前缀 + 遮蔽区 + 指令；total = 前缀 + 视图。
 * - ① 遮蔽区要装得下：prefix + (view − retained) + instruction ≤ budget ⟹ retained ≥ total + instruction − budget
 * - ② 压完的主请求要装得下：prefix + summary(≤2000) + retained ≤ 模型窗口（保守取 ≤ budget − prefix − instruction）
 * budget 缺省（无 provider / DISABLED / 旧调用方）时退化为纯比率口径，行为与改造前一致。
 */
function computeRetainBudget(input: {
  contextWindow: number;
  total: number;
  envelopeDelta: number;
  retainRatio: number;
  budget: number | undefined;
}): RetainBudgetState {
  const ratioBudget = Math.floor(
    Math.min(input.contextWindow, input.total) * input.retainRatio,
  );
  if (input.budget === undefined) {
    return {
      retainTokens: ratioBudget,
      ratioBudget,
      minRetain: 0,
      maxRetain: Number.POSITIVE_INFINITY,
      feasible: true,
    };
  }
  const minRetain = Math.max(
    0,
    input.total + SUMMARY_INSTRUCTION_TOKENS_EST - input.budget,
  );
  const maxRetain = Math.max(
    0,
    input.budget - input.envelopeDelta - SUMMARY_INSTRUCTION_TOKENS_EST,
  );
  return {
    retainTokens: Math.min(Math.max(ratioBudget, minRetain), maxRetain),
    ratioBudget,
    minRetain,
    maxRetain,
    feasible: minRetain <= maxRetain,
  };
}

/** 从 provider 报错链中解析"上下文上限"（取文本里最大的 6 位以上 token 数） */
function parseProviderContextLimit(error: unknown): number | undefined {
  const numbers: number[] = [];
  const seen = new WeakSet<object>();
  let current: unknown = error;
  for (let depth = 0; depth <= 4; depth += 1) {
    if (current === undefined || current === null) break;
    const text =
      typeof current === 'string'
        ? current
        : current instanceof Error
          ? `${current.message}`
          : '';
    for (const match of text.matchAll(/(\d[\d,]{4,})\s*tokens?/gi)) {
      const value = Number(match[1]!.replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) numbers.push(value);
    }
    if (typeof current !== 'object') break;
    if (seen.has(current)) break;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

/** 摘要输入超窗终结错误（带实测数字；文案对齐 zcode 的"缩小上下文后重试"指引） */
function createSummaryInputOverBudgetError(input: {
  needTokens: number;
  budget: number | undefined;
}): Error {
  return new Error(
    `Compaction failed: the summary input exceeds the model context window (need ~${Math.ceil(
      input.needTokens,
    )} tokens, budget ${input.budget ?? 'unknown'}). Try again after narrowing the active context.`,
  );
}

/** 截断标记消息（user 角色 + plugin 来源：模型可见、非真实用户输入） */
function createSummaryTruncationMarker(): Message {
  return {
    id: `__compact_truncated_${Date.now().toString(36)}`,
    role: 'user',
    kind: 'model',
    source: { kind: 'plugin', plugin: 'compact' },
    metadata: {},
    content: [{ type: 'text', text: SUMMARY_TRUNCATION_MARKER }],
  };
}

/** 按 assistant 起始轮分组（截断的最小单位；与 zcode compact rounds 分组同构） */
function groupByAssistantStartedRounds<T extends { role: string }>(
  items: readonly T[],
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (item.role === 'assistant' && current.length > 0) {
      groups.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

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
   * 摘要输入硬预算（token）：摘要请求（前缀 + 遮蔽区 + 指令）不得超过它。
   * 由调用方按**摘要模型窗口**计算（resolveSummaryInputBudgetTokens）；缺省退化为纯比率口径。
   * 传值后比率预算只作下界：超窗会话的保留量会被抬到"遮蔽区装得下"的下限，
   * 同时不超过"压完的主请求装得下"的上限。
   */
  summaryInputBudgetTokens?: number;
  /**
   * 触发来源：manual 允许"超窗时截断最旧遮蔽区"的降级（zcode 同款），auto/overflow 不允许
   * （自动路径不得静默丢历史）。缺省按 auto 处理。
   */
  trigger?: 'auto' | 'manual' | 'overflow';
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

    // ③ 保留预算：比率预算只作下界，摘要输入硬预算（摘要模型窗口驱动）决定实际取值。
    //    超窗会话（实际远大于有效窗口）靠 minRetain 抬高保留量，确保"前缀+遮蔽区+指令"装得下；
    //    maxRetain 反向约束保留尾，避免压完的主请求再次超窗。
    const retainRatio = options.retainRatio ?? 0.2;
    const trigger = options.trigger ?? 'auto';
    let effectiveBudget = options.summaryInputBudgetTokens;
    let budgetState = computeRetainBudget({
      contextWindow: options.contextWindow,
      total,
      envelopeDelta,
      retainRatio,
      budget: effectiveBudget,
    });
    // 预算驱动的边界（可重试）：先按 retainTokens 回退，再按"遮蔽区装得下"精确校正
    // （computeBoundary 可能在"下一条装不下"处停下，使遮蔽区超预算最多一条消息）。
    const staticTokens = envelopeDelta + SUMMARY_INSTRUCTION_TOKENS_EST;
    const resolveBudgetedBoundary = async (
      budget: number | undefined,
      state: RetainBudgetState,
    ): Promise<{ boundary: number; feasible: boolean }> => {
      const raw = await this.computeBoundary(
        sessionId,
        options,
        modelName,
        state.retainTokens,
      );
      if (budget === undefined) return { boundary: raw, feasible: true };
      const enforced = await this.enforceSummaryInputBudget({
        sessionId,
        modelName,
        messages,
        perMessageTokens: options.perMessageTokens,
        boundary: raw,
        budget,
        staticTokens,
        maxRetain: state.maxRetain,
      });
      if (enforced === null) return { boundary: raw, feasible: false };
      return { boundary: enforced, feasible: true };
    };

    let initialBoundary = await resolveBudgetedBoundary(
      effectiveBudget,
      budgetState,
    );
    if (!initialBoundary.feasible) {
      // 合同外场景：前缀/单条不可分消息本身就超预算（连"最小遮蔽区"都装不下）→ 不发注定失败的请求
      throw createSummaryInputOverBudgetError({
        needTokens: total + SUMMARY_INSTRUCTION_TOKENS_EST - budgetState.maxRetain,
        budget: effectiveBudget,
      });
    }
    let boundary = initialBoundary.boundary;
    let shadowedMessages = messages.slice(0, boundary);
    if (shadowedMessages.length === 0) {
      // 无可遮蔽（如单条超大消息撑爆预算）→ 不做任何改写
      return {
        compacted: false,
        shadowedCount: 0,
        skipReason: 'retain-budget-exceeds-history',
      };
    }

    let retryAttempts = 0;
    let truncationAttempts = 0;
    // 压缩诊断（只读，一行）：预算/边界/遮蔽-保留实测对账 + 快照对齐检查。
    // retainedTokens≈retainTokens ⇒ 预算正常生效；feasible=false ⇒ 合同外（前缀/不可分单元超预算）。
    this.logCompactBoundaryDiagnostics({
      messages,
      perMessageTokens: options.perMessageTokens,
      historyTokens,
      envelopeDelta,
      total,
      retainTokens: budgetState.retainTokens,
      boundary,
      budget: effectiveBudget,
      staticTokens,
      ratioBudget: budgetState.ratioBudget,
      minRetain: budgetState.minRetain,
      maxRetain: budgetState.maxRetain,
      feasible: budgetState.feasible,
      retryAttempts,
      truncationAttempts,
    });

    // ④a 摘要输入 = messages[0..boundary)（原消息——此时未写入任何改写 → 与上次主请求一致 → 前缀命中）。
    //    超窗恢复阶梯（对齐 zcode）：provider 仍拒绝时 ① 收紧预算 + 抬高边界重试（所有路径）
    //    → ② 手动路径截断最旧遮蔽区（插标记）→ ③ 带数字终结。
    //    截断只改摘要输入，boundary 记账不变：被丢内容不进摘要也不保留（存储仍在），与 zcode 一致。
    let summaryInputEntries: Message[] = shadowedMessages;
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

      let loopAttempts = 0;
      while (true) {
        const summaryInputTokens = await this.tokenMeter.estimateMessages(
          sessionId,
          modelName,
          summaryInputEntries,
        );
        loopAttempts += 1;
        if (loopAttempts > MAX_SUMMARY_INPUT_LOOP_ATTEMPTS) {
          // 收紧/截断两条路径叠加后的硬上限（防御性；正常应在下面 ③ 终结）
          throw createSummaryInputOverBudgetError({
            needTokens:
              summaryInputTokens + envelopeDelta + SUMMARY_INSTRUCTION_TOKENS_EST,
            budget: effectiveBudget,
          });
        }
        try {
          const gen = await this.generateSummary(
            sessionId,
            options,
            modelName,
            summaryInputEntries,
            summaryInputTokens,
          );
          summary = gen.summary;
          summaryUsage = gen.usage;
          break;
        } catch (error) {
          if (!isContextWindowExceeded(error)) throw error;
          this.throwIfCancelled(options);

          // ① 收紧预算 + 抬高边界重试：provider 只报上限不报 actual（zcode 的 token gap 不可得），
          //    故按 10% 递减，并以解析到的上限为封顶；预算装不下的边界由 minRetain 自动抬升。
          const tightened = this.tightenSummaryInputBudget(
            effectiveBudget,
            parseProviderContextLimit(error),
          );
          if (tightened !== undefined && retryAttempts < MAX_SUMMARY_INPUT_RETRIES) {
            const nextState = computeRetainBudget({
              contextWindow: options.contextWindow,
              total,
              envelopeDelta,
              retainRatio,
              budget: tightened,
            });
            const nextBoundaryResult = nextState.feasible
              ? await resolveBudgetedBoundary(tightened, nextState)
              : { boundary, feasible: false };
            if (nextBoundaryResult.feasible) {
              retryAttempts += 1;
              effectiveBudget = tightened;
              budgetState = nextState;
              if (nextBoundaryResult.boundary !== boundary) {
                boundary = nextBoundaryResult.boundary;
                shadowedMessages = messages.slice(0, boundary);
                summaryInputEntries = shadowedMessages;
                truncationAttempts = 0; // 边界已变：截断按新遮蔽区重新开始
              }
              this.logger.warn(
                `[compress] summary input over window; raised retention and retrying (attempt ${retryAttempts}/${MAX_SUMMARY_INPUT_RETRIES}, budget=${tightened}, boundary=${boundary})`,
              );
              continue;
            }
          }

          // ② 手动路径：截断最旧遮蔽区（auto/overflow 不截断——自动路径不得静默丢历史）。
          //    目标取"provider 报错推出的上限"（tightened）：即使两侧边界约束不可行，
          //    它仍是截断唯一可信的目标；无 tightened 时退回当前预算或按 80% 递减。
          if (
            trigger === 'manual' &&
            truncationAttempts < MAX_SUMMARY_TRUNCATION_ATTEMPTS
          ) {
            const targetBudget = tightened ?? effectiveBudget;
            const targetTokens =
              targetBudget === undefined
                ? Math.floor(summaryInputTokens * 0.8)
                : Math.max(0, targetBudget - staticTokens);
            const truncated = await this.truncateSummaryInputOldest({
              sessionId,
              modelName,
              entries: summaryInputEntries,
              targetTokens,
            });
            if (truncated) {
              truncationAttempts += 1;
              summaryInputEntries = truncated;
              this.logger.warn(
                `[compress] summary input over window; truncated oldest shadowed rounds (attempt ${truncationAttempts}/${MAX_SUMMARY_TRUNCATION_ATTEMPTS}, entries=${truncated.length})`,
              );
              continue;
            }
          }

          // ③ 终结：带实测数字，便于用户/日志定位
          throw createSummaryInputOverBudgetError({
            needTokens:
              summaryInputTokens + envelopeDelta + SUMMARY_INSTRUCTION_TOKENS_EST,
            budget: effectiveBudget,
          });
        }
      }
    } else {
      mode = SummaryMode.DISABLED; // 无 provider → DISABLED 丢弃
    }

    // ④b 写 compaction 括号事件（遮蔽 [0..boundary) + 摘要）——提交前最后一道中止检查，
    // 保证取消后不落任何 compaction 写入。遮蔽记账按**最终 boundary**；摘要内容可能只覆盖
    // summaryInputEntries（手动截断时小于遮蔽区：被丢内容不进摘要也不保留，存储仍在）。
    this.throwIfCancelled(options);
    const shadowedCount = shadowedMessages.length;
    const shadowedEndId = shadowedMessages[shadowedCount - 1]!.id;
    const { summaryMessageId } = await options.dataSource.appendCompact({
      shadowedEndId,
      shadowedCount,
      summary,
      mode,
      ...(summaryUsage === undefined ? {} : { usage: summaryUsage }),
    });

    this.logger.log(
      `[compress] compacted ${shadowedCount} messages (mode=${mode}), retained ${messages.length - boundary} messages, summary=${summary.length} chars` +
        (retryAttempts > 0 || truncationAttempts > 0
          ? ` (retryAttempts=${retryAttempts}, truncationAttempts=${truncationAttempts})`
          : ''),
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

  /** 压缩边界诊断（只读）：预算对账 + 快照对齐（tokens.len vs msgs.len）+ 最大消息分布 */
  private logCompactBoundaryDiagnostics(input: {
    messages: readonly Message[];
    perMessageTokens?: readonly number[];
    historyTokens: number;
    envelopeDelta: number;
    total: number;
    retainTokens: number;
    boundary: number;
    budget?: number;
    staticTokens?: number;
    ratioBudget?: number;
    minRetain?: number;
    maxRetain?: number;
    feasible?: boolean;
    retryAttempts?: number;
    truncationAttempts?: number;
  }): void {
    const { messages, perMessageTokens, boundary } = input;
    let detail = 'perMessageTokens=n/a';
    if (perMessageTokens) {
      let all = 0;
      let shadowed = 0;
      let retained = 0;
      for (let i = 0; i < perMessageTokens.length; i++) {
        const t = perMessageTokens[i] ?? 0;
        all += t;
        if (i < boundary) shadowed += t;
        else retained += t;
      }
      const top5 = perMessageTokens
        .map((t, i) => ({ i, t: t ?? 0 }))
        .sort((a, b) => b.t - a.t)
        .slice(0, 5)
        .map((x) => `${x.i}:${x.t}`)
        .join(',');
      detail =
        `perMessageTokens=${perMessageTokens.length} tokensSum=${all}` +
        ` shadowedTokens=${shadowed} retainedTokens=${retained}` +
        ` retainedVsBudget=${retained - input.retainTokens}` +
        ` nextOlderTokens=${boundary > 0 ? (perMessageTokens[boundary - 1] ?? 0) : 'n/a'}` +
        ` top5=${top5}`;
    }
    const budgetDetail =
      input.budget === undefined
        ? ' budget=n/a'
        : ` budget=${input.budget} staticTokens=${input.staticTokens}` +
          ` ratioBudget=${input.ratioBudget} minRetain=${input.minRetain} maxRetain=${input.maxRetain}` +
          ` feasible=${input.feasible}`;
    this.logger.log(
      `[compact.diag.boundary] msgs=${messages.length} ${detail}` +
        ` historyTokens=${input.historyTokens} envelopeDelta=${input.envelopeDelta} total=${input.total}` +
        ` retainTokens=${input.retainTokens} boundary=${boundary}` +
        ` shadowedMsgs=${boundary} retainedMsgs=${messages.length - boundary}${budgetDetail}` +
        ` retryAttempts=${input.retryAttempts ?? 0} truncationAttempts=${input.truncationAttempts ?? 0}`,
    );
  }

  /**
   * 收紧摘要输入预算：provider 只报上限不报 actual（zcode 的 token gap 不可得），
   * 故按 10% 递减，并以解析到的上限（减去输出预留与安全余量）封顶；无法收紧时返回 undefined。
   */
  private tightenSummaryInputBudget(
    current: number | undefined,
    parsedLimit: number | undefined,
  ): number | undefined {
    const cap =
      parsedLimit === undefined
        ? undefined
        : Math.max(
            0,
            parsedLimit -
              SUMMARY_OUTPUT_RESERVE_TOKENS -
              Math.max(
                SUMMARY_INPUT_SAFETY_MARGIN_TOKENS,
                Math.floor(parsedLimit * SUMMARY_INPUT_SAFETY_MARGIN_RATIO),
              ),
          );
    const shrunk = current === undefined ? undefined : Math.floor(current * 0.9);
    const next =
      shrunk === undefined
        ? cap
        : cap === undefined
          ? shrunk
          : Math.min(shrunk, cap);
    if (next === undefined || next <= 0) return undefined;
    if (current !== undefined && next >= current) return undefined;
    return next;
  }

  /**
   * 按预算精确校正边界：computeBoundary 在"下一条装不下"处停下，遮蔽区可能比预算多出最多一条消息
   * （使 遮蔽区+前缀+指令 略超预算）——这里把边界继续前移（多保留）直到装得下。
   * perMessageTokens 缺省时退化为逐条估算（生产路径始终提供，缺省仅为兼容）。
   * @returns 校正后的边界；保留侧越 maxRetain（两侧约束不可同时满足）或仍装不下时返回 null
   */
  private async enforceSummaryInputBudget(input: {
    sessionId: string;
    modelName: string;
    messages: readonly Message[];
    perMessageTokens: readonly number[] | undefined;
    boundary: number;
    budget: number;
    staticTokens: number;
    maxRetain: number;
  }): Promise<number | null> {
    const tokens = input.perMessageTokens;
    const messageTokensAt = async (index: number): Promise<number> =>
      tokens !== undefined
        ? (tokens[index] ?? 0)
        : await this.tokenMeter.estimateMessages(input.sessionId, input.modelName, [
            input.messages[index]!,
          ]);
    const sliceTokens = async (from: number, to: number): Promise<number> => {
      if (tokens !== undefined) {
        let sum = 0;
        for (let i = from; i < to; i += 1) sum += tokens[i] ?? 0;
        return sum;
      }
      return this.tokenMeter.estimateMessages(
        input.sessionId,
        input.modelName,
        input.messages.slice(from, to),
      );
    };

    let boundary = input.boundary;
    let shadowedTokens = await sliceTokens(0, boundary);
    let retainedTokens = await sliceTokens(boundary, input.messages.length);

    while (shadowedTokens + input.staticTokens > input.budget && boundary > 0) {
      if (retainedTokens > input.maxRetain) return null; // 保留侧已越上限 → 两侧约束不可同时满足
      boundary -= 1;
      const moved = await messageTokensAt(boundary);
      shadowedTokens -= moved;
      retainedTokens += moved;
    }
    if (shadowedTokens + input.staticTokens > input.budget) return null;
    if (retainedTokens > input.maxRetain) return null;

    // 配对再平衡：上面的左移可能把边界停在「assistant(tool_calls) 与回应它的结果之间」，
    // 摘要输入就会以未配对的 tool_calls 结尾 → 上游拒整次请求
    // （"insufficient tool messages following tool_calls message"）。
    // computeBoundary 的配对平衡发生在预算校正**之前**，校正后必须重做（平衡只会继续左移，
    // 遮蔽区变小、保留区变大，故需复核 retainedTokens 上限）。
    const balanced = toolPairingBalancedBefore(input.messages, boundary);
    if (balanced !== boundary) {
      boundary = balanced;
      shadowedTokens = await sliceTokens(0, boundary);
      retainedTokens = await sliceTokens(boundary, input.messages.length);
      if (retainedTokens > input.maxRetain) return null;
      if (shadowedTokens + input.staticTokens > input.budget) return null;
    }
    return boundary;
  }

  /**
   * 从最旧端截断摘要输入（仅手动路径）：按 assistant 起始轮分组，逐组丢弃直到估算规模 ≤ targetTokens。
   * 只改摘要输入；boundary 记账不变 —— 被丢内容不进摘要也不保留（存储仍在），与 zcode 的手动截断一致。
   * 首条为 assistant 时插入截断标记（避免 provider 侧以 assistant 开头，并让模型知道前文被省略）。
   * @returns 截断后的摘要输入；至少保留 1 组仍装不下 / 无可截断时返回 null
   */
  private async truncateSummaryInputOldest(input: {
    sessionId: string;
    modelName: string;
    entries: readonly Message[];
    targetTokens: number;
  }): Promise<Message[] | null> {
    const groups = groupByAssistantStartedRounds(input.entries);
    if (groups.length < 2) return null;
    for (let drop = 1; drop <= groups.length - 1; drop += 1) {
      const remaining = groups.slice(drop).flat();
      const tokens = await this.tokenMeter.estimateMessages(
        input.sessionId,
        input.modelName,
        remaining,
      );
      if (tokens <= input.targetTokens) {
        return remaining[0]?.role === 'assistant'
          ? [createSummaryTruncationMarker(), ...remaining]
          : remaining;
      }
    }
    return null;
  }

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
