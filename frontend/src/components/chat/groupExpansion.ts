/**
 * 工具调用分组的展开状态解析。
 *
 * 显式覆盖（用户点击写入的 group.id -> 是否展开）优先；
 * 无覆盖时按运行态派生：进行中的最后一组展开，其余收起。
 */
import { findToolResponse } from '@/utils/subAgentLink';
import type { ToolCall } from '@/utils/toolDisplay';
import type { ToolCallResponseEntry } from '@/types/message';
import type { DisplayItem } from '@/utils/messageUtils';

export type GroupExpandOverrides = ReadonlyMap<string, boolean>;

export function resolveGroupExpanded(
  overrides: GroupExpandOverrides,
  groupId: string,
  isActive: boolean,
): boolean {
  return overrides.get(groupId) ?? isActive;
}

/** 用户点击后的覆盖值（取反当前有效状态）。 */
export function nextGroupExpandOverride(
  overrides: GroupExpandOverrides,
  groupId: string,
  isActive: boolean,
): boolean {
  return !resolveGroupExpanded(overrides, groupId, isActive);
}

/**
 * 单个工具调用是否执行中：无终态 outcome、回合仍在流式、且按 toolCallId（回退下标）
 * 匹配不到响应。与 MessageToolCalls.isToolExecuting 同口径。
 */
export function isToolCallExecuting(
  tool: ToolCall,
  index: number,
  responses?: ReadonlyArray<Partial<ToolCallResponseEntry>>,
  isStreaming?: boolean,
): boolean {
  if (tool.outcome) return false;
  if (isStreaming !== true) return false;
  return !findToolResponse(tool, index, responses);
}

/** 分组内仍在执行的 DisplayItem（工具调用执行中，或对应块还在思考）。 */
export function findExecutingItems(
  items: ReadonlyArray<DisplayItem>,
  isStreaming?: boolean,
): DisplayItem[] {
  return items.filter((item) => {
    if (item.type === 'think') return !!item.source.state?.isThinking;
    if (item.type === 'tool') {
      const calls = item.toolCalls ?? [];
      return calls.some((tool, i) =>
        isToolCallExecuting(tool, i, item.toolResponses, isStreaming),
      );
    }
    return false;
  });
}

/** 分组是否忙碌（存在未完成步骤）。标题「正在…」/微光动画按此判定，而非组位置。 */
export function hasUnfinishedSteps(
  items: ReadonlyArray<DisplayItem>,
  isStreaming?: boolean,
): boolean {
  return findExecutingItems(items, isStreaming).length > 0;
}

/**
 * 分组内容行数估算（不读 DOM）——用于判断"这个分组值不值得播展开动画"。
 *
 * 不能读 DOM：折叠态用 `content-visibility: hidden` 让子树退出布局，scrollHeight 恒为 0。
 * 折算口径：思考正文 60 字符/行；每个工具调用按 2 行（行头 + 参数摘要）。
 */
export function estimateGroupLines(items: ReadonlyArray<DisplayItem>): number {
  let lines = 0;
  for (const item of items) {
    if (item.type === 'think') {
      lines += Math.ceil((item.reasoningContent?.length ?? 0) / 60);
    } else if (item.type === 'tool') {
      lines += 2 + (item.toolCalls?.length ?? 0) * 2;
    }
  }
  return lines;
}

/**
 * 分组标题的语义阶段（收起/展开共用）：
 * - thinking：组内没有工具（纯思考），或工具已全部完成、当前又在流式思考；
 * - executing-tools：有工具调用正在执行；
 * - completed-tools：非忙碌且组内有工具——标题走聚合完成文案，不看思考项。
 */
export type GroupTitlePhase = 'thinking' | 'executing-tools' | 'completed-tools';

export function resolveGroupTitlePhase(
  items: ReadonlyArray<DisplayItem>,
  isStreaming?: boolean,
): GroupTitlePhase {
  const hasTools = items.some(
    (item) => item.type === 'tool' && (item.toolCalls?.length ?? 0) > 0,
  );
  if (!hasTools) return 'thinking';
  const executing = findExecutingItems(items, isStreaming);
  if (executing.some((item) => item.type === 'tool')) return 'executing-tools';
  // 工具全部完成；若思考块仍在流式，标题跟随思考态
  if (executing.length > 0) return 'thinking';
  return 'completed-tools';
}

