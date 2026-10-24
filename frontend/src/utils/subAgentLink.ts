import { type ToolCall, resolveToolName } from './toolDisplay';
import { SUB_AGENT_TOOLS } from './subAgentTools';
import type { ToolCallResponseEntry } from '@/types/message';

export interface SubAgentLink {
  subSessionId: string;
  /** 子代理名称，仅用于展示（后端 meta 提供） */
  name?: string;
}

/**
 * 解析工具调用对应的子代理会话，供工具行 / 结果通知提供"打开面板"入口。
 *
 * 关联键优先级（前两个同源、值相同，顺序只为可读性；关键是它们覆盖的时间窗不同）：
 * 1. `tool.subAgentLink` —— 由流事件 `subagent_link` 在**子会话创建瞬间**折叠写入，
 *    进 eventBuffer 故随 SSE 建连重放回来。前台 spawn 会阻塞到子代理跑完，这段时间
 *    工具结果还没落库，只有它能建立关联（刷新也不丢）。
 * 2. `response.meta.link` —— 后端子代理工具回传、随 tool/result 落库，覆盖回合结束后
 *    的长尾（eventBuffer 随回合销毁，此后靠它）。
 *
 * 返回 null = 该行没有唯一可跳转的目标：非子代理工具、多目标等待（一行只能开一个面板，
 * 不猜）、以及结果尚未到达的调用中工具。
 */
export function resolveSubAgentLink(
  tool: ToolCall,
  response?: Partial<ToolCallResponseEntry>,
): SubAgentLink | null {
  const toolName = resolveToolName(tool);
  if (!SUB_AGENT_TOOLS.has(toolName)) return null;

  const streamLink = tool.subAgentLink;
  if (typeof streamLink?.subSessionId === 'string' && streamLink.subSessionId) {
    return {
      subSessionId: streamLink.subSessionId,
      ...(streamLink.name ? { name: streamLink.name } : {}),
    };
  }

  const link = response?.meta?.link;
  if (
    link?.type === 'sub_agent' &&
    typeof link.subSessionId === 'string' &&
    link.subSessionId
  ) {
    return {
      subSessionId: link.subSessionId,
      ...(typeof link.name === 'string' && link.name ? { name: link.name } : {}),
    };
  }

  return null;
}

/**
 * 按 toolCallId 取出工具结果（不用数组下标：并行调用的结果到达顺序不保证与调用顺序一致，
 * 下标会错位串结果）。id 缺失或结果未到达时回退下标，保证既有渲染路径行为不变。
 */
export function findToolResponse(
  tool: ToolCall,
  index: number,
  responses?: ReadonlyArray<Partial<ToolCallResponseEntry>>,
): Partial<ToolCallResponseEntry> | undefined {
  if (!responses || responses.length === 0) return undefined;
  if (tool.id) {
    const hit = responses.find((r) => r?.toolCallId === tool.id);
    if (hit) return hit;
  }
  return responses[index];
}
