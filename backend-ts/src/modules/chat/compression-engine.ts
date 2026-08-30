/**
 * 统一压缩引擎（后端无关，全数据输入）
 *
 * 纯计算 + 写入引擎：消息数据由调用方传入（请求消息列表），引擎不读存储。
 *   - 一级裁剪（prune）→ messageStore.appendPrune（就地改写传入消息的 tool-result 内容）
 *   - 二级摘要（compact）→ messageStore.appendCompact（compaction 括号事件，消息级遮蔽）
 * 写入统一经 IMessageStore 的压缩写入方法——本引擎不感知任何持久化后端细节。
 *
 * 与 deepseek-harness compaction 的对齐点：
 * - 消息级遮蔽（surface 节点级）：遮蔽范围 = 请求消息列表的 head-anchored 前缀（token 预算）
 * - tool-pairing 平衡：遮蔽边界不切断 tool-call/result 配对
 * - 收敛不变量：摘要 token 必须小于被遮蔽内容，超限在 retries 内重压
 * - KV 前缀：摘要输入即请求消息本身（与主请求逐字节一致），prefix 由调用方注入 provider
 * - onBeforeCompaction 在确认需要二级压缩后才触发（避免一级裁剪空跑影子轮次）
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import { TokenMeterService } from './token-meter.service';
import type {
  Message,
  ContentBlock,
} from '../../common/types/conversation.types';
import { toolPairingBalancedBefore } from './compaction/tool-pairing';

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

/** 摘要生成输入：遮蔽区（请求消息）+ 全部可见（提取旧检查点）+ IDs */
export interface SummaryInput {
  /** 全部可见消息（含历史 compaction 摘要事件消息，供提取旧检查点） */
  allMessages: Message[];
  /** 遮蔽消息（来自请求消息列表本身，与主请求逐字节一致） */
  shadowed: Message[];
  /** 遮蔽消息 ID（消息级遮蔽，对齐 DSH surface 节点） */
  shadowedMessageIds: string[];
}

/** 摘要生成结果（流式累积可取 usage，对齐 DSH SummaryResult） */
export interface SummaryResult {
  summary: string;
  usage?: import('../../common/types/stream-chunk.types').StreamUsage;
}

/** 摘要生成器（由调用方注入 LLM 调用） */
export interface SummaryProvider {
  generate(input: SummaryInput): Promise<SummaryResult>;
}

export interface CompressionOptions {
  /** 请求消息列表（context.history，与主请求逐字节一致）——引擎唯一的消息数据源 */
  messages: Message[];
  contextWindow: number;
  triggerRatio?: number;   // 默认 0.8
  targetRatio?: number;    // 默认 0.5
  /**
   * 当前完整请求 token（prelude + 视图，provider 锚点，由调用方经 ds.getTokenCount() 传入）。
   * 引擎据此把"history-only"测量补足为完整请求占用（对齐 DSH measure = envelope + surface，
   * 避免门控少算 system/tools/userPrompt）；缺省退化为纯历史口径（envelopeDelta=0）。
   */
  requestTokens?: number;
  /** 对话模型名（token 估算用；估算只影响裁剪/保留决策，与摘要模型无关） */
  modelName?: string;
  summaryProvider?: SummaryProvider;
  summaryMode?: SummaryMode;
  /** 摘要输出 token 上限（默认 2000） */
  maxSummaryTokens?: number;
  /** 收敛重压次数（摘要不小于被遮蔽内容时，默认 1） */
  compactionRetries?: number;
  /** 确认需要二级压缩（摘要/丢弃）后触发的钩子（compaction.before 事件的唯一时序来源：
   *  由调用方 CompactionService 注入并发射事件，记忆保存等订阅者须先于摘要完成） */
  onBeforeCompaction?: () => Promise<void>;
  /** 强制压缩（上下文溢出恢复路径）：跳过 triggerRatio 阈值判断 */
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
}

export interface CompressionResult {
  pruneEvents: number;      // 写入的 prune 事件数
  compacted: boolean;       // 是否触发二级压缩
  shadowedMessageIds: string[];
  summary?: string;
}

@Injectable()
export class CompressionEngine {
  private readonly logger = new Logger(CompressionEngine.name);

  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly tokenMeter: TokenMeterService,
  ) {}

  /**
   * 执行压缩：一级裁剪 → 二级摘要（如仍超阈值）。
   * @param sessionId 会话 ID
   * @param options 压缩配置（messages 为请求消息列表，引擎唯一数据源）
   */
  async execute(
    sessionId: string,
    options: CompressionOptions,
  ): Promise<CompressionResult> {
    const { messages } = options;
    const triggerRatio = options.triggerRatio ?? 0.8;
    const targetRatio = options.targetRatio ?? 0.5;
    // token 估算仅用于压缩决策，与摘要模型无关（摘要模型由调用方注入 summaryProvider）
    const modelName = options.modelName || 'gpt-4o';

    // 1. 判断是否需要压缩（force=上下文溢出恢复路径，跳过阈值判断）
    // 全量请求 token = 历史估算 + 请求包裹差值（system+tools+userPrompt）；
    // requestTokens 由调用方传入（provider 锚点全量），缺省退化为纯历史口径（无差值）
    const historyTokens = await this.tokenMeter.estimateMessages(
      sessionId,
      modelName,
      messages,
    );
    const envelopeDelta =
      options.requestTokens === undefined
        ? 0
        : Math.max(0, options.requestTokens - historyTokens);
    const total = historyTokens + envelopeDelta;
    if (!options.force && total / options.contextWindow < triggerRatio) {
      return { pruneEvents: 0, compacted: false, shadowedMessageIds: [] };
    }

    const targetTokens = Math.floor(options.contextWindow * targetRatio);

    // 2. 一级裁剪：只裁剪超长 tool 内容（就地改写传入消息，与 replayer 折叠语义一致）
    const pruneEvents = await this.pruneToolResults(sessionId, messages, modelName, {
      pruning: options.pruning,
    });

    // 3. 裁剪后重算（prune 已就地改写消息内容；同样补足请求包裹差值）
    const afterPrune =
      (await this.tokenMeter.estimateMessages(
        sessionId,
        modelName,
        messages,
      )) + envelopeDelta;
    if (afterPrune <= targetTokens) {
      return { pruneEvents, compacted: false, shadowedMessageIds: [] };
    }

    // 4. 二级压缩：计算遮蔽范围 + 生成摘要（或按 DISABLED 模式直接丢弃）
    if (!options.summaryProvider) {
      if (options.summaryMode === SummaryMode.DISABLED) {
        this.logger.log('[compress] summaryMode=disabled，直接遮蔽待压缩内容');
        return {
          ...(await this.shadowOnly(
            sessionId,
            options,
            targetTokens,
            envelopeDelta,
            modelName,
          )),
          pruneEvents,
        };
      }
      this.logger.warn('[compress] 无 summaryProvider，跳过摘要压缩');
      return { pruneEvents, compacted: false, shadowedMessageIds: [] };
    }

    // 确认需要二级压缩后才触发回调（避免一级裁剪空跑影子记忆轮次）
    if (options.onBeforeCompaction) {
      try {
        await options.onBeforeCompaction();
      } catch (e) {
        this.logger.warn(`onBeforeCompaction failed: ${e}`);
      }
    }

    const result = await this.compactMessages(
      sessionId,
      options,
      targetTokens,
      envelopeDelta,
      modelName,
    );
    return { ...result, pruneEvents };
  }

  // ─── 一级裁剪 ───

  /**
   * 裁剪超长 tool 内容（就地改写传入消息的 tool-result 块）：
   * - 只裁剪 tool-result 块
   * - 保护最近 N 条 tool 结果 + tool_learn/todo
   * - 头尾各保留指定字符数（默认阈值一半）
   * 参数经 options.pruning 注入（对齐 DSH 按模型路由裁剪预算）。
   */
  private async pruneToolResults(
    sessionId: string,
    messages: Message[],
    modelName: string,
    options?: { pruning?: CompressionOptions['pruning'] },
  ): Promise<number> {
    const maxLength = options?.pruning?.maxLength ?? PRUNING_TOOL_RESULT_MAX_LENGTH;
    const protectedRecent = options?.pruning?.protectedRecent ?? PROTECTED_RECENT_TOOL_RESULTS_COUNT;
    const headTailChars = options?.pruning?.headTailChars ?? Math.floor(maxLength / 2);

    // 收集所有 tool-result 内容（按消息顺序）
    const toolContents: Array<{ msg: Message; tr: Extract<ContentBlock, { type: 'tool-result' }> }> = [];
    for (const msg of messages) {
      if (msg.source.kind !== 'tool') continue;
      const tr = msg.content.find(
        (b): b is Extract<ContentBlock, { type: 'tool-result' }> => b.type === 'tool-result',
      );
      if (tr) toolContents.push({ msg, tr });
    }

    // 保护最近 N 条（从后往前）
    let protectedCount = 0;
    let pruneCount = 0;

    for (let i = toolContents.length - 1; i >= 0; i--) {
      const { msg, tr } = toolContents[i];

      // 保护 tool_learn / todo
      if (tr.name === 'tool_learn' || tr.name === 'todo') continue;

      if (protectedCount < protectedRecent) {
        protectedCount++;
        continue;
      }

      const content = tr.content;
      if (content.length <= maxLength) continue;

      // 头尾各保留 headTailChars
      const newContent = `${safeSubstring(content, 0, headTailChars)}...[omitted ${content.length - maxLength} characters]...${safeTail(content, headTailChars)}`;

      // 影子价格：被裁剪内容的估算 token（原内容估 − 裁剪后估）
      const prunedTokens = await this.tokenMeter.estimateTextTokens(modelName, content)
        - await this.tokenMeter.estimateTextTokens(modelName, newContent);

      // 写入 message/prune 事件（经 IMessageStore，后端无关）
      await this.messageStore.appendPrune(sessionId, {
        messageId: msg.id,
        newContent,
        prunedBytes: content.length - newContent.length,
        strategy: 'head_tail_prune',
        prunedTokens: prunedTokens > 0 ? prunedTokens : undefined,
      });

      // 就地改写传入消息（与 replayer 折叠语义一致，后续估算基于裁剪后内容）
      tr.content = newContent;
      pruneCount++;
    }

    if (pruneCount > 0) {
      this.logger.debug(`[compress] pruned ${pruneCount} tool contents`);
    }
    return pruneCount;
  }

  // ─── 二级摘要 ───

  /**
   * 计算遮蔽范围（messages 前缀 + token 预算 + tool-pairing 平衡）+ 生成摘要 + 写入 compaction 括号事件。
   * 保留尾部预算内的消息；预算 = targetTokens - 请求包裹差值（envelopeDelta），保证压缩后完整请求不超目标；
   * 预算过小时强制保留最近 MIN_RETAINED_MESSAGES 条。
   */
  private async compactMessages(
    sessionId: string,
    options: CompressionOptions,
    targetTokens: number,
    envelopeDelta: number,
    modelName: string,
  ): Promise<{ compacted: boolean; shadowedMessageIds: string[]; summary?: string }> {
    const { messages } = options;
    if (messages.length === 0) {
      return { compacted: false, shadowedMessageIds: [] };
    }

    // 尾部保留预算：从后向前累计 token，直到超出 retainBudget（完整请求口径）
    const retainBudget = targetTokens - envelopeDelta;
    let retainTokens = 0;
    let boundary = messages.length; // 遮蔽区结束索引（遮蔽 messages[0..boundary-1]）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = await this.tokenMeter.estimateMessages(
        sessionId,
        modelName,
        [messages[i]],
      );
      if (retainTokens + msgTokens > retainBudget) break;
      retainTokens += msgTokens;
      boundary = i;
    }

    // 预算过小时强制保留最近 MIN_RETAINED_MESSAGES 条（保证近期上下文完整）
    const minRetain = Math.max(0, messages.length - MIN_RETAINED_MESSAGES);
    if (boundary > minRetain) {
      boundary = minRetain;
    }

    // tool-pairing 平衡：遮蔽边界不切断未配对的 tool-call/result
    boundary = toolPairingBalancedBefore(messages, boundary);

    const shadowedMessages = messages.slice(0, boundary);
    const shadowedMessageIds = shadowedMessages.map(m => m.id);
    if (shadowedMessageIds.length === 0) {
      return { compacted: false, shadowedMessageIds: [] };
    }

    // 生成摘要（注入 provider）+ 收敛不变量（摘要必须小于被遮蔽内容）
    const retries = options.compactionRetries ?? 1;

    let summary = '';
    let summaryUsage: SummaryResult['usage'];
    let attempts = 0;
    const shadowedTokens = await this.tokenMeter.estimateMessages(
      sessionId,
      modelName,
      shadowedMessages,
    );

    while (attempts <= retries) {
      attempts++;
      const result = await options.summaryProvider!.generate({
        allMessages: messages,
        shadowed: shadowedMessages,
        shadowedMessageIds,
      });
      summary = result.summary;
      summaryUsage = result.usage;
      const summaryTokens = await this.tokenMeter.estimateMessages(sessionId, modelName, [
        { ...(shadowedMessages[0] ?? messages[0] ?? emptyMessage()), content: [{ type: 'text', contentId: `__summary_${attempts}`, text: summary }] },
      ]);

      this.logger.debug(
        `[compress] summary attempt ${attempts}: ${summaryTokens} tokens, shadowed ${shadowedTokens} tokens`,
      );
      if (summaryTokens < shadowedTokens) break;
      if (attempts <= retries) {
        this.logger.warn(
          `[compress] summary (${summaryTokens}) not smaller than shadowed (${shadowedTokens}), retrying (${attempts}/${retries})`,
        );
      }
    }

    const mode = options.summaryMode ?? SummaryMode.DEFAULT;

    // 写入 compaction 括号事件 + 分卷（经 IMessageStore，后端无关）
    await this.messageStore.appendCompact(sessionId, {
      shadowedMessageIds,
      summary,
      mode,
      ...summaryUsage === undefined ? {} : { usage: summaryUsage },
    });

    this.logger.log(
      `[compress] compacted ${shadowedMessageIds.length} messages (mode=${mode}, attempts=${attempts}), retained ${messages.length - boundary} messages, summary=${summary.length} chars`,
    );
    return { compacted: true, shadowedMessageIds, summary };
  }

  /** DISABLED 模式：不生成摘要，仅遮蔽待压缩内容（写空摘要的 compaction 括号事件） */
  private async shadowOnly(
    sessionId: string,
    options: CompressionOptions,
    targetTokens: number,
    envelopeDelta: number,
    modelName: string,
  ): Promise<{ compacted: boolean; shadowedMessageIds: string[]; summary?: string }> {
    const { messages } = options;
    if (messages.length === 0) {
      return { compacted: false, shadowedMessageIds: [] };
    }

    const retainBudget = targetTokens - envelopeDelta;
    let retainTokens = 0;
    let boundary = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = await this.tokenMeter.estimateMessages(
        sessionId,
        modelName,
        [messages[i]],
      );
      if (retainTokens + msgTokens > retainBudget) break;
      retainTokens += msgTokens;
      boundary = i;
    }
    const minRetain = Math.max(0, messages.length - MIN_RETAINED_MESSAGES);
    if (boundary > minRetain) boundary = minRetain;
    boundary = toolPairingBalancedBefore(messages, boundary);

    const shadowedMessages = messages.slice(0, boundary);
    const shadowedMessageIds = shadowedMessages.map(m => m.id);
    if (shadowedMessageIds.length === 0) {
      return { compacted: false, shadowedMessageIds: [] };
    }

    await this.messageStore.appendCompact(sessionId, {
      shadowedMessageIds,
      summary: '',
      mode: SummaryMode.DISABLED,
    });
    this.logger.log(
      `[compress] shadowed ${shadowedMessageIds.length} messages (mode=disabled, no summary)`,
    );
    return { compacted: true, shadowedMessageIds, summary: '' };
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
