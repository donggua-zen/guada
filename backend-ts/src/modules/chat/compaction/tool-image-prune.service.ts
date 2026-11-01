/**
 * 工具截图批量裁剪（用户手动触发）
 *
 * 语义：保留最近 N 个用户轮，把更早轮次里 `tool-result.images` 移出后续请求上下文。
 * - 不删除文件、不改存储里的 tool/result 事件；只写一条 `tool_image/prune` 事件。
 * - 裁剪语义唯一由 replayer 应用（LLM 链路把 images 迁到 prunedImages；展示链路跳过）。
 * - 请求组装时 prunedImages 转成带绝对路径的文案，模型仍可 image_view 回看。
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  MessageNode,
  ToolImagePruneData,
} from '../../../common/persistence/types';
import { toRequestMetrics } from '../../../common/types/request-metrics.types';
import type { ISessionContext } from '../session-context';
import { SessionLlmRequestBuilder } from '../session-llm-request.builder';
import type {
  CompactionDataSource,
  CompressionSaving,
} from './types';

/** 与 token-meter 的图片口径一致 */
const TOKENS_PER_IMAGE = 1500;

export interface ToolImagePruneResult {
  /** 实际保留的用户轮数（keepTurns 超过总轮数时取总轮数） */
  keptTurns: number;
  /** 被移出上下文的截图张数 */
  prunedImages: number;
  /** 被移出图片的 base64 字节数 */
  prunedBytes: number;
}

@Injectable()
export class ToolImagePruneService {
  private readonly logger = new Logger(ToolImagePruneService.name);

  /**
   * 执行一次工具截图裁剪。
   *
   * 边界用 JSONL seq（回放顺序权威），不用 message id 排序：
   * `keepFromSeq` = 保留集合第一条消息的 seq；seq 更小的旧工具图被移出。
   */
  async prune(
    context: ISessionContext,
    keepTurns: number,
  ): Promise<ToolImagePruneResult> {
    const ds = context as unknown as CompactionDataSource;
    const nodes = (await ds.getHistory()) as MessageNode[];

    const turnIds = collectUserTurnIds(nodes);
    if (turnIds.length === 0) {
      return { keptTurns: 0, prunedImages: 0, prunedBytes: 0 };
    }

    const effectiveKeep = Math.max(
      1,
      Math.min(Math.floor(keepTurns), turnIds.length),
    );
    const keep = new Set(turnIds.slice(-effectiveKeep));
    const firstKept = nodes.find(
      (node) => node.turnId != null && keep.has(node.turnId),
    );
    if (!firstKept || typeof firstKept.seq !== 'number') {
      return { keptTurns: effectiveKeep, prunedImages: 0, prunedBytes: 0 };
    }

    const keepFromSeq = firstKept.seq;
    const savings: CompressionSaving[] = [];
    let imageCount = 0;
    let prunedBytes = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (typeof node.seq === 'number' && node.seq >= keepFromSeq) continue;
      let count = 0;
      for (const block of node.content) {
        if (block.type !== 'tool-result' || !block.images?.length) continue;
        count += block.images.length;
        for (const image of block.images) {
          prunedBytes += base64Bytes(image.bytes ?? 0);
        }
      }
      if (count === 0) continue;
      imageCount += count;
      savings.push({ index: i, tokens: count * TOKENS_PER_IMAGE });
    }

    if (imageCount === 0) {
      return { keptTurns: effectiveKeep, prunedImages: 0, prunedBytes: 0 };
    }

    const beforeTokens = await ds.getTokenCount();
    const event: ToolImagePruneData = {
      keepTurns: effectiveKeep,
      keepFromSeq,
      boundaryMessageId: firstKept.id,
      imageCount,
      prunedBytes,
      prunedTokens: imageCount * TOKENS_PER_IMAGE,
    };
    if (!ds.appendToolImagePrune) {
      throw new Error('tool image prune is not supported by this session store');
    }
    const seq = await ds.appendToolImagePrune(event);
    await ds.recordContextAnchor?.({ beforeTokens, savings });

    // 裁剪已落库；用裁剪后的视图重新算一次“下次请求”的媒体投影，
    // 再落/广播 context_stats，让 MemoPanel 立即显示新的媒体字节与张数。
    const turnId = turnIds[turnIds.length - 1]!;
    const contextStats = {
      ...(await context.getContextStats()),
      ...(await this.estimateRequestMetrics(context, ds)),
    };
    await context.appendContextStats(turnId, contextStats);
    await context.publishStream({ type: 'context_stats', turnId, contextStats });

    // 实时事件卡：seq = 已落库 tool_image/prune 的 seq，前端用它与 replay 去重
    await context.publishStream({
      type: 'tool_image_prune',
      seq,
      keepTurns: event.keepTurns,
      keepFromSeq: event.keepFromSeq,
      ...(event.boundaryMessageId === undefined
        ? {}
        : { boundaryMessageId: event.boundaryMessageId }),
      imageCount: event.imageCount,
      prunedBytes: event.prunedBytes,
      prunedTokens: event.prunedTokens,
    });

    this.logger.log(
      `[tool-image-prune] keptTurns=${effectiveKeep} pruned=${imageCount} ` +
        `(${(prunedBytes / 1024 / 1024).toFixed(2)}MiB base64) keepFromSeq=${keepFromSeq}`,
    );

    return { keptTurns: effectiveKeep, prunedImages: imageCount, prunedBytes };
  }

  /** 用同一 builder 计算下次请求的 requestMedia；失败不影响裁剪本身。 */
  private async estimateRequestMetrics(
    context: ISessionContext,
    ds: CompactionDataSource,
  ): Promise<{ request?: ReturnType<typeof toRequestMetrics> }> {
    try {
      const messages = await ds.getHistory();
      const params = SessionLlmRequestBuilder.buildCompletionParams(context, {
        messages,
      });
      return params.requestMedia
        ? { request: toRequestMetrics(params.requestMedia) }
        : {};
    } catch (error) {
      this.logger.warn(
        `[tool-image-prune] request media estimate failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {};
    }
  }
}

/** 收集真实用户轮（每次用户输入算一轮），按视图顺序去重 */
function collectUserTurnIds(nodes: readonly MessageNode[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.role !== 'user' || node.source.kind !== 'user') continue;
    const turnId = node.turnId;
    if (!turnId || seen.has(turnId)) continue;
    seen.add(turnId);
    ids.push(turnId);
  }
  return ids;
}

/** 与 media-budget 一致：原始字节 → base64 字符数 */
function base64Bytes(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 3) * 4;
}
