/**
 * 压缩失败记录（持久化 + 流事件共用）。
 *
 * 用稳定 snake_case 错误分类承载"为什么失败"，原始 message 只作详情；
 * 前端按分类白名单映射 i18n，未知分类降级为原文展示（对齐 git 错误提示模式）。
 */
import type { CompactionErrorData } from '../../../common/persistence/types';
import {
  UpstreamError,
  UpstreamNetworkError,
  UpstreamRateLimitError,
  UpstreamRequestError,
  UpstreamTimeoutError,
} from '../../llm-core/utils/upstream-errors';

/** 原始错误写入事件日志的上限（405 等上游响应可能携带整页 HTML） */
const MAX_ERROR_CHARS = 1000;

type ErrorKind = CompactionErrorData['errorKind'];

/** 跨模块/序列化边界后 instanceof 可能失效，类名兜底 */
function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  return typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';
}

function classifyError(error: unknown): ErrorKind {
  const name = errorName(error);
  if (error instanceof UpstreamRateLimitError || name === 'UpstreamRateLimitError') {
    return 'rate_limited';
  }
  if (error instanceof UpstreamNetworkError || name === 'UpstreamNetworkError') {
    return 'network_error';
  }
  if (error instanceof UpstreamTimeoutError || name === 'UpstreamTimeoutError') {
    return 'timeout';
  }
  if (error instanceof UpstreamRequestError || name === 'UpstreamRequestError') {
    return 'request_error';
  }
  return 'unknown';
}

/** 结构化字段（status / retryAfterMs）只取数字，缺省不写入事件 */
function numericField(error: unknown, key: string): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildCompactionErrorRecord(
  error: unknown,
  opts: {
    trigger: CompactionErrorData['trigger'];
    tier: CompactionErrorData['tier'];
  },
): CompactionErrorData {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  const message = raw || 'Unknown compaction error';
  const status =
    (error instanceof UpstreamError ? error.status : undefined) ??
    numericField(error, 'status');
  const retryAfterMs = numericField(error, 'retryAfterMs');
  return {
    errorKind: classifyError(error),
    error: message.length > MAX_ERROR_CHARS ? message.slice(0, MAX_ERROR_CHARS) : message,
    trigger: opts.trigger,
    tier: opts.tier,
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}
