/**
 * 轨迹 step 括号记录器（对齐 DSH agent-loop 的 step/start :288 / step/end :301 收口纪律）
 *
 * 一次 begin/end 对 = 一次模型调用（主循环时含它请求的工具执行）。括号是 log-only 事件：
 * 不参与消息 surface 折叠（replayer default: break 直接跳过），作用：
 * 1. 辅助调用（标题/记忆/目标/图识/插件 LLM/压缩摘要）在日志留痕——它们不产生 assistant/message
 * 2. 失败/中止/溢出重试的尝试留痕（error 语义收口）
 * 3. 给调用级 usage/finishReason/耗时/attemptIndex 一个挂载锚点
 * 4. 投影端按 [stepStart, stepEnd] 的 seq 区间切片 OUT 区（assistant 块 + tool 结果）
 *
 * 纪律（全部对齐 DSH finally 收口）：
 * - 每个括号必须闭合：handle.end() 幂等；begin 时发现同会话存在未闭合括号 →
 *   先以 {name:'StepUnclosed'} 兜底收口再开新括号（seq 有序保持）
 * - 观测性功能：任何 append 失败只告警，绝不阻断对话主链路
 *
 * envelope：beginStep 内先经 ctx.appendEnvelopeIfNeeded()（DSH request/header 语义：
 * 每 step 一次对比，变更才写）。主循环与辅助调用统一覆盖。
 */
import { Logger } from '@nestjs/common';
import type { Message } from '../../common/types/conversation.types';
import type {
  StepEndData,
  StepMediaOverlayEntry,
  StepSource,
  StepStartData,
} from '../../common/persistence/types';

const logger = new Logger('StepRecorder');

/** 记录器依赖的最小写入面（JsonlSessionContext 实现；轻量写入面可只给 store 侧两个方法） */
export interface StepBracketWriter {
  readonly sessionId: string;
  /**
   * envelope 快照：与上次比对，变更才写（beginStep 每次先调用）。
   * 可选：走会话 envelope 的调用（主循环 / 摘要）提供；不使用会话 envelope 的
   * 辅助调用（标题用标题模型 / 目标校验 / 插件 LLM）可缺省——它们的请求侧
   * 输入经 fullInput 或调用方自行记录。
   */
  appendEnvelopeIfNeeded?(): Promise<void>;
  appendStepStart(data: StepStartData): Promise<number>;
  appendStepEnd(data: StepEndData): Promise<number>;
}

/** step/start 元数据（beginStep 入参；与 StepStartData 对齐，seq/time 由落盘层分配） */
export interface StepBeginMeta {
  /** 归属回合（主循环）；辅助调用为 null */
  turnId: string | null;
  /** 回合内第几次调用（agent-engine iterationCount；辅助调用恒 1） */
  step: number;
  /** 调用来源（与 usageContext.source / purpose 对齐） */
  source: StepSource;
  model?: string;
  provider?: string;
  /** 同一次逻辑请求的 id（主循环 = 预分配的 assistant messageId；辅助调用 = ctx.generateId()） */
  requestId: string;
  /** 主循环专用：本次请求尾部注入的瞬态消息（不落 surface，verbatim 记录） */
  transient?: Message[];
  /** 辅助调用专用：全量请求输入（预算有界；记录逻辑输入，不含 wire 期 base64 展开） */
  fullInput?: Message[];
}

/** step/end 增量数据（end 入参；durationMs 由记录器自动计算） */
export interface StepEndInput {
  /** 最终成功尝试的序号（streamWithRetry 内部重试计数；无重试 = 0） */
  attemptIndex?: number;
  usage?: import('../../common/types/conversation.types').TokenUsage;
  finishReason?: string;
  error?: { name: string; message: string };
  /** 主循环：本次调用产出的 assistant 消息 id（OUT 区锚点） */
  assistantMessageId?: string;
  /** 媒体预算占位清单（本次请求被替换为文本占位的图片） */
  mediaOverlay?: StepMediaOverlayEntry[];
}

export interface StepHandle {
  /**
   * 收括号（幂等；重复调用 no-op）。durationMs = 收口时刻 − begin 时刻。
   * 未传 error 且此前未收口 → 视为正常完成收口。
   */
  end(input?: StepEndInput): Promise<void>;
  /** 透出流式重试进度（streamWithRetry 的 attempt；end 时作为 attemptIndex 缺省值） */
  noteAttempt(attempt: number): void;
  /** step/start 事件 seq（append 失败时为 null——括号未入日志，end 也不再写） */
  readonly startSeq: number | null;
  readonly startedAt: number;
}

/** 同一会话上下文的未闭合括号（防御收口依据；WeakMap 随 ctx 回收） */
interface OpenStep {
  startSeq: number | null;
  requestId: string;
  startedAt: number;
  lastAttempt: number;
}

const openSteps = new WeakMap<object, OpenStep>();

/** 错误归一化（截断，避免整页 HTML 撑大事件日志；对齐 CompactionErrorData 的截断取向） */
export function toStepErrorInfo(error: unknown): { name: string; message: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  return { name: err.name || 'Error', message: String(err.message ?? '').slice(0, 2000) };
}

/**
 * 开一次调用括号。
 *
 * - 先 envelope（变更才写）→ 再 step/start
 * - 已有未闭合括号 → 先以 StepUnclosed 兜底收口（配对纪律）
 * - append 失败 → 告警并返回「哑句柄」（end 不再写，不影响主链路）
 */
export async function beginStep(
  ctx: StepBracketWriter,
  meta: StepBeginMeta,
): Promise<StepHandle> {
  const startedAt = Date.now();

  // 防御收口：上一个括号未闭合就开了新括号（调用方漏 end / 异常穿透）——先补收口
  const prev = openSteps.get(ctx);
  if (prev) {
    openSteps.delete(ctx);
    try {
      await ctx.appendStepEnd({
        requestId: prev.requestId,
        attemptIndex: prev.lastAttempt,
        durationMs: Date.now() - prev.startedAt,
        error: {
          name: 'StepUnclosed',
          message: `step opened at seq=${prev.startSeq} was not closed before a new step began`,
        },
      });
    } catch (error: any) {
      logger.warn(
        `[trajectory] defensive step/end failed for ${ctx.sessionId}: ${error?.message ?? error}`,
      );
    }
  }

  // envelope：请求侧快照（变更才写；失败已在 ctx 内部吞掉；缺省 = 不记录 envelope）
  if (ctx.appendEnvelopeIfNeeded) {
    try {
      await ctx.appendEnvelopeIfNeeded();
    } catch {
      /* 不可达：ctx 内部已吞错；保守保留 */
    }
  }

  const startData: StepStartData = {
    turnId: meta.turnId,
    step: meta.step,
    source: meta.source,
    requestId: meta.requestId,
    ...(meta.model === undefined ? {} : { model: meta.model }),
    ...(meta.provider === undefined ? {} : { provider: meta.provider }),
    ...(meta.transient === undefined || meta.transient.length === 0
      ? {}
      : { transient: meta.transient }),
    ...(meta.fullInput === undefined || meta.fullInput.length === 0
      ? {}
      : { fullInput: meta.fullInput }),
  };

  let startSeq: number | null = null;
  try {
    startSeq = await ctx.appendStepStart(startData);
  } catch (error: any) {
    logger.warn(
      `[trajectory] step/start failed for ${ctx.sessionId}: ${error?.message ?? error}`,
    );
  }

  const open: OpenStep = {
    startSeq,
    requestId: meta.requestId,
    startedAt,
    lastAttempt: 0,
  };
  if (startSeq !== null) {
    openSteps.set(ctx, open);
  }

  let ended = false;
  return {
    startSeq,
    startedAt,
    noteAttempt(attempt: number) {
      if (attempt > open.lastAttempt) open.lastAttempt = attempt;
    },
    async end(input?: StepEndInput): Promise<void> {
      if (ended) return;
      ended = true;
      if (openSteps.get(ctx) === open) openSteps.delete(ctx);
      if (startSeq === null) return; // step/start 未落盘，括号不存在，无需收口
      const endData: StepEndData = {
        requestId: meta.requestId,
        attemptIndex: input?.attemptIndex ?? open.lastAttempt,
        durationMs: Date.now() - startedAt,
        ...(input?.usage === undefined ? {} : { usage: input.usage }),
        ...(input?.finishReason === undefined ? {} : { finishReason: input.finishReason }),
        ...(input?.error === undefined ? {} : { error: input.error }),
        ...(input?.assistantMessageId === undefined
          ? {}
          : { assistantMessageId: input.assistantMessageId }),
        ...(input?.mediaOverlay === undefined || input.mediaOverlay.length === 0
          ? {}
          : { mediaOverlay: input.mediaOverlay }),
      };
      try {
        await ctx.appendStepEnd(endData);
      } catch (error: any) {
        logger.warn(
          `[trajectory] step/end failed for ${ctx.sessionId}: ${error?.message ?? error}`,
        );
      }
    },
  };
}

/**
 * 括号内执行一次调用并自动收口（辅助调用统一入口）。
 *
 * fn 返回 { value, end }：value 是调用结果，end 是收口增量（usage/finishReason/产物 id）。
 * fn 抛异常 → 以 error 语义收口后原样上抛（收口纪律：异常路径也闭合）。
 *
 * @example
 * const result = await withStepBracket(ctx, meta, async () => {
 *   const r = await this.llm.completions(params);
 *   return { value: r, end: { usage: r.usage, finishReason: r.finishReason } };
 * });
 */
export async function withStepBracket<T>(
  ctx: StepBracketWriter,
  meta: StepBeginMeta,
  fn: (handle: StepHandle) => Promise<{ value: T; end: StepEndInput }>,
): Promise<T> {
  const handle = await beginStep(ctx, meta);
  try {
    const { value, end } = await fn(handle);
    await handle.end(end);
    return value;
  } catch (error) {
    await handle.end({ error: toStepErrorInfo(error) });
    throw error;
  }
}
