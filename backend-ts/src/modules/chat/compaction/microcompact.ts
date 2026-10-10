/**
 * 微压缩（一级，本地无 LLM）：工具结果头尾裁剪 + 过旧思考剥离。
 *
 * 设计要点：
 * - 纯计算：不改写消息对象、不落库；写入由调用方（MicrocompactService）经 CompactionDataSource 执行。
 * - 保护规则：
 *   A. 最后真实用户轮次（source.kind==='user'）起（含）到末尾全部保护——工具裁剪与思考剥离都适用；
 *   B. 思考额外保护：最新轮次绝对保护 + THINKING_PROTECT_MS 时间窗（createdAt 缺失时按轮次回退）；
 *   C. 思考剥离按轮次原子（整轮全清或全留）；工具裁剪按单条候选条件。
 * - 最小收益门槛由调用方按 MICROCOMPACT_MIN_TOKEN_SAVINGS 判定：不达标整批放弃，
 *   不为一两个字符的收益打断前缀缓存。
 * - 收益范围：思考剥离只对 fullReasoningRelay（deepseek-v4 系）模型真实有效——其余模式下
 *   读取管线（message-transform.pipeline 的 reasoningPolicyStep）已把历史思考从视图剥离，
 *   此处无块可剥；非思考模式同理。这是预期行为，不是漏判。
 */
import type { Message, ToolResultBlock } from '../../../common/types/conversation.types';
import { isUserFacingMessage } from '../../../common/types/conversation.types';
import {
  PRUNE_STRATEGY_HEAD_TAIL,
  PRUNE_STRATEGY_THINKING_STRIP,
} from '../../../common/persistence/types';

/** 工具结果裁剪阈值（字符）：超过才进入候选 */
export const PRUNING_TOOL_RESULT_MAX_LENGTH = 1000;
/**
 * 裁剪最小收益（字符）：候选内容必须比"头尾保留 + 省略标记"多出这么多才裁剪。
 * 保证裁剪后必然更短——已裁剪内容不再入候选（幂等），不会写出零收益/变长事件。
 */
export const MIN_PRUNE_GAIN = 200;
/** 微压缩触发阈值相对 LLM 阈值的比例（对齐 zcode：min(0.9×auto, auto−buffer)） */
export const MICROCOMPACT_THRESHOLD_RATIO = 0.9;
/** 微压缩触发阈值相对 LLM 阈值的固定回退缓冲（token） */
export const MICROCOMPACT_BUFFER_TOKENS = 2000;
/** 最小收益门槛（token）：整批估算节省低于此值则放弃本次微压缩（对齐 zcode 256） */
export const MICROCOMPACT_MIN_TOKEN_SAVINGS = 256;
/** 思考时间保护窗：窗口内的思考不剥离 */
export const THINKING_PROTECT_MS = 2 * 60 * 60 * 1000;
/** 恒不裁剪的工具结果（学习/待办类，裁剪会让模型失忆） */
const SKIPPED_TOOL_NAMES = new Set(['tool_learn', 'todo']);

/**
 * 微压缩输入消息：视图消息（getHistory），运行时节点带 turnId（replayer MessageNode）。
 * turnId 缺失的消息不参与思考剥离（无法判定轮次原子性，保守保留）。
 */
export interface MicrocompactMessage extends Message {
  turnId?: string | null;
}

export interface MicrocompactPlanEntry {
  /** 视图消息 index（CompressionSaving.index 同口径） */
  index: number;
  messageId: string;
  strategy: typeof PRUNE_STRATEGY_HEAD_TAIL | typeof PRUNE_STRATEGY_THINKING_STRIP;
  newContent: string;
  prunedBytes: number;
  /** 估算节省 token（可 <= 0；总门槛只累计正值） */
  prunedTokens: number;
}

export interface MicrocompactPlan {
  entries: MicrocompactPlanEntry[];
  /** 工具结果裁剪条数 */
  toolPruneCount: number;
  /** 思考剥离条数（消息数） */
  thinkingStripCount: number;
  /** 估算总节省 token（仅正收益求和） */
  totalTokenSavings: number;
}

export interface MicrocompactPlanOptions {
  maxLength?: number;
  headTailChars?: number;
  minPruneGain?: number;
  thinkingProtectMs?: number;
}

/**
 * 微压缩触发阈值：min(floor(LLM 阈值 × 0.9), LLM 阈值 − 2000)。
 * LLM 阈值 = floor(窗口 × triggerRatio)；比例项通常占优（大窗口下约为窗口的 81%）。
 */
export function buildMicrocompactThreshold(llmThresholdTokens: number): number {
  const ratioThreshold = Math.floor(llmThresholdTokens * MICROCOMPACT_THRESHOLD_RATIO);
  const bufferThreshold = llmThresholdTokens - MICROCOMPACT_BUFFER_TOKENS;
  return Math.max(0, Math.min(ratioThreshold, bufferThreshold));
}

/**
 * 构建微压缩计划（纯计算）。
 * @param input.messages 视图消息（与主请求一致）
 * @param input.nowMs 当前时间（时间保护判定）
 * @param input.estimateTextTokens 文本 token 估算（注入以便测试；与快照同一 meter）
 */
export async function buildMicrocompactPlan(input: {
  messages: readonly MicrocompactMessage[];
  nowMs: number;
  estimateTextTokens: (text: string) => Promise<number>;
  options?: MicrocompactPlanOptions;
}): Promise<MicrocompactPlan> {
  const { messages, estimateTextTokens } = input;
  const options = input.options ?? {};
  const maxLength = options.maxLength ?? PRUNING_TOOL_RESULT_MAX_LENGTH;
  const headTailChars = options.headTailChars ?? Math.floor(maxLength / 2);
  const minPruneGain = options.minPruneGain ?? MIN_PRUNE_GAIN;
  const thinkingProtectMs = options.thinkingProtectMs ?? THINKING_PROTECT_MS;

  // A. 最后真实用户消息起（含）全部保护；找不到真实用户消息 → 全部保护（protectedFromIndex=0）
  const lastRealUserIndex = findLastRealUserMessageIndex(messages);
  const protectedFromIndex = lastRealUserIndex < 0 ? 0 : lastRealUserIndex;
  const latestTurnId = readTurnId(messages[messages.length - 1]);

  const entries: MicrocompactPlanEntry[] = [];

  // ① 工具结果裁剪（单条候选条件；只处理保护区之前）
  for (let i = 0; i < protectedFromIndex; i++) {
    const entry = await buildToolPruneEntry({
      message: messages[i]!,
      index: i,
      maxLength,
      headTailChars,
      minPruneGain,
      estimateTextTokens,
    });
    if (entry) entries.push(entry);
  }

  // ② 思考剥离（轮次原子：该轮任一消息受 A/B 保护则整轮保留）
  const thinkingTargets = collectThinkingStripTargets({
    messages,
    protectedFromIndex,
    latestTurnId,
    nowMs: input.nowMs,
    thinkingProtectMs,
  });
  const emptyTokens = await estimateTextTokens('');
  for (const index of thinkingTargets) {
    const message = messages[index]!;
    let strippedChars = 0;
    let savedTokens = 0;
    for (const block of message.content) {
      if (block.type !== 'reasoning') continue;
      // 已剥离（读取管线把空 summary 填成 ' '）→ 幂等跳过
      if (block.summary.trim().length === 0) continue;
      strippedChars += block.summary.length;
      savedTokens += (await estimateTextTokens(block.summary)) - emptyTokens;
    }
    if (strippedChars === 0) continue;
    entries.push({
      index,
      messageId: message.id,
      strategy: PRUNE_STRATEGY_THINKING_STRIP,
      // 思考剥离 = 整块清空、块保留（不做头尾编辑）；读取管线按思考模式决定填充 ' ' 或整块剥离
      newContent: '',
      prunedBytes: strippedChars,
      prunedTokens: Math.max(0, savedTokens),
    });
  }

  return {
    entries,
    toolPruneCount: entries.filter((e) => e.strategy === PRUNE_STRATEGY_HEAD_TAIL).length,
    thinkingStripCount: entries.filter((e) => e.strategy === PRUNE_STRATEGY_THINKING_STRIP).length,
    totalTokenSavings: entries.reduce((acc, e) => acc + Math.max(0, e.prunedTokens), 0),
  };
}

/** 从后往前找最后一条真实用户消息（source.kind==='user'）；找不到返回 -1（调用方按"全部保护"处理） */
function findLastRealUserMessageIndex(messages: readonly MicrocompactMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    if (isUserFacingMessage(message)) return i;
  }
  return -1;
}

/** 视图节点的轮次归属（replayer MessageNode）；缺失返回 null */
function readTurnId(message: MicrocompactMessage | undefined): string | null {
  return message?.turnId ?? null;
}

async function buildToolPruneEntry(input: {
  message: MicrocompactMessage;
  index: number;
  maxLength: number;
  headTailChars: number;
  minPruneGain: number;
  estimateTextTokens: (text: string) => Promise<number>;
}): Promise<MicrocompactPlanEntry | null> {
  const { message, index, maxLength, headTailChars, minPruneGain } = input;
  if (message.source.kind !== 'tool') return null;
  const toolResult = message.content.find(
    (b): b is ToolResultBlock => b.type === 'tool-result',
  );
  if (!toolResult) return null;
  if (SKIPPED_TOOL_NAMES.has(toolResult.name)) return null;
  const content = toolResult.content;
  if (content.length <= maxLength) return null;

  const marker = buildPruneMarker(content.length, maxLength);
  // 收益门槛：候选必须比"头尾保留 + 标记"多出 minPruneGain —— 保证裁剪后必然更短
  if (content.length < maxLength + marker.length + minPruneGain) return null;
  // 头尾预算按实际长度夹紧（配置异常时也保证更短）
  const head = Math.min(
    headTailChars,
    Math.floor((content.length - marker.length - minPruneGain) / 2),
  );
  if (head <= 0) return null;
  const newContent = `${safeSubstring(content, 0, head)}${marker}${safeTail(content, head)}`;
  if (newContent.length >= content.length) return null;

  const savedTokens =
    (await input.estimateTextTokens(content)) - (await input.estimateTextTokens(newContent));
  return {
    index,
    messageId: message.id,
    strategy: PRUNE_STRATEGY_HEAD_TAIL,
    newContent,
    prunedBytes: content.length - newContent.length,
    prunedTokens: Math.max(0, savedTokens),
  };
}

/**
 * 收集可剥离思考的消息 index（轮次原子）：
 * - 按 turnId 分组；缺 turnId 的消息不参与（保守保留）；
 * - 轮次内任一消息受保护（A：最后真实用户轮次起；B1：最新轮次；B2：2 小时窗内）→ 整轮保留；
 * - 否则该轮内所有含非空 reasoning 的消息整体剥离。
 */
function collectThinkingStripTargets(input: {
  messages: readonly MicrocompactMessage[];
  protectedFromIndex: number;
  latestTurnId: string | null;
  nowMs: number;
  thinkingProtectMs: number;
}): number[] {
  const { messages, protectedFromIndex, latestTurnId, nowMs, thinkingProtectMs } = input;
  const turns = new Map<string, number[]>();
  for (let i = 0; i < messages.length; i++) {
    const turnId = readTurnId(messages[i]);
    if (!turnId) continue;
    const indexes = turns.get(turnId);
    if (indexes) indexes.push(i);
    else turns.set(turnId, [i]);
  }

  const targets: number[] = [];
  for (const [turnId, indexes] of turns) {
    const protectedTurn = indexes.some((i) =>
      isThinkingProtected({
        index: i,
        turnId,
        message: messages[i]!,
        protectedFromIndex,
        latestTurnId,
        nowMs,
        thinkingProtectMs,
      }),
    );
    if (protectedTurn) continue;
    for (const i of indexes) {
      if (hasStrippableReasoning(messages[i]!)) targets.push(i);
    }
  }
  return targets.sort((a, b) => a - b);
}

function isThinkingProtected(input: {
  index: number;
  turnId: string;
  message: MicrocompactMessage;
  protectedFromIndex: number;
  latestTurnId: string | null;
  nowMs: number;
  thinkingProtectMs: number;
}): boolean {
  if (input.index >= input.protectedFromIndex) return true; // A
  if (input.latestTurnId !== null && input.turnId === input.latestTurnId) return true; // B1
  const createdAt = input.message.createdAt; // B2（缺失 → 按轮次回退，即仅 A/B1 保护）
  return createdAt !== undefined && createdAt >= input.nowMs - input.thinkingProtectMs;
}

function hasStrippableReasoning(message: MicrocompactMessage): boolean {
  return message.content.some(
    (b) => b.type === 'reasoning' && b.summary.trim().length > 0,
  );
}

function safeSubstring(str: string, start: number, length: number): string {
  if (str.length <= start) return '';
  return str.substring(start, Math.min(str.length, start + length));
}

function safeTail(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(str.length - length);
}

/** 裁剪省略标记：报告被省略的字符数（与 llm-summary.provider 的截断标记同风格） */
function buildPruneMarker(originalLength: number, maxLength: number): string {
  const omitted = Math.max(0, originalLength - maxLength);
  return `...[omitted ${omitted} chars]...`;
}
