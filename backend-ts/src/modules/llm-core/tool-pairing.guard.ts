/**
 * 请求前工具配对兜底（wire 层最后防线，provider 无关）
 *
 * 为什么需要：assistant(tool_calls) 与工具结果是两条独立消息，两者分两批落盘
 * （agent-engine：先写 assistant，工具执行完再写 tool/result），任何中断都可能让
 * 历史停在「assistant 声明了调用、结果永远不到」的形状上；上游严格校验该形状并
 * 直接 400（insufficient tool messages following tool_calls message）。
 * 历史一旦变脏，只有冷加载修复能救，且它要求活跃段有坏行——所以这里再补一道：
 * **无论历史怎么脏，本次请求都必须是合法形状**。
 *
 * 只在请求组装处（session-llm-request.builder）调用，作用于本次 wire 视图：
 * - 不写回会话存储（历史修复由 jsonl-message.service / 错误自愈负责）
 * - 不就地改写入参对象（消息视图是共享快照，只读契约）
 *
 * 不做的事：不放进 L1 变换管线（message-transform.pipeline）——管线输出与 store
 * 折叠列表 1:1 对齐，压缩记账（shadowedCount + 折叠 splice）依赖该性质，在管线里
 * 增删消息会让压缩切点错位。
 */
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  isToolCallBlock,
  isToolResultMessage,
  SYNTHETIC_TOOL_INTERRUPTED_TEXT,
  toolResultCallIdOf,
} from '../../common/utils/tool-pairing.util';
import type {
  Message,
  ToolCallBlock,
} from '../../common/types/conversation.types';

const logger = new Logger('ToolPairingGuard');

/** 补桩消息 id 前缀（非 store 铸造的哨兵 id，parseOrderedId 天然返回 null） */
const SYNTHETIC_ID_PREFIX = '__pairing_';

export interface ToolPairingGuardContext {
  sessionId?: string;
}

/**
 * 归一化工具配对，返回可直接交给 adapter 的 wire 视图。
 *
 * 处理三类非法形状：
 * 1. tool-call 缺 toolCallId（上游漏发/缓发）→ 合成稳定 id（与引擎 TOOLCALL-SYNTH-ID 同形）
 * 2. 有调用无结果（中断/崩溃/工具未执行）→ 紧随该 assistant 消息补一条 isError 合成结果
 * 3. 孤儿/重复工具结果（其结果对应的调用不在窗口内，如前缀剪切/迁移产物）→ 从 wire 丢弃
 *
 * @param messages 会话历史（只读，函数不修改入参与其中对象）
 * @param context 仅用于日志定位（sessionId）
 * @returns 新数组（无需变更时原样返回入参）
 */
export function ensureToolPairing(
  messages: readonly Message[],
  context?: ToolPairingGuardContext,
): Message[] {
  if (messages.length === 0) return messages as Message[];
  const label = context?.sessionId ? `session=${context.sessionId}` : 'session=-';

  // ① 空 toolCallId → 合成 id（只复制被改动的消息与块）
  let idSynthCount = 0;
  const normalized = messages.map((message) => {
    if (!message.content.some(isToolCallBlock)) return message;
    if (message.content.every((b) => !isToolCallBlock(b) || !!b.toolCallId)) {
      return message;
    }
    idSynthCount += 1;
    return {
      ...message,
      content: message.content.map((block) =>
        isToolCallBlock(block) && !block.toolCallId
          ? { ...block, toolCallId: `call_${randomUUID()}` }
          : block,
      ),
    };
  });

  // ② 调用声明位置（首次声明为准）与首个存活结果位置
  const declaredAt = new Map<string, number>();
  for (let i = 0; i < normalized.length; i += 1) {
    const message = normalized[i];
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (!isToolCallBlock(block)) continue;
      if (!declaredAt.has(block.toolCallId)) declaredAt.set(block.toolCallId, i);
    }
  }

  const orphanAt = new Set<number>();
  const duplicateAt = new Set<number>();
  const firstResultAt = new Map<string, number>();
  for (let i = 0; i < normalized.length; i += 1) {
    const message = normalized[i];
    if (!isToolResultMessage(message)) continue;
    const callId = toolResultCallIdOf(message);
    // 无法解析 id 或调用不在窗口内（或被声明在该结果之后）→ 孤儿，wire 上必被拒
    if (callId === null) {
      orphanAt.add(i);
      continue;
    }
    const declared = declaredAt.get(callId);
    if (declared === undefined || declared > i) {
      orphanAt.add(i);
      continue;
    }
    // 同一调用多条结果：只保留首条（重复 id 同样会被严格上游拒绝）
    if (firstResultAt.has(callId)) {
      duplicateAt.add(i);
      continue;
    }
    firstResultAt.set(callId, i);
  }

  // ③ 组装输出：丢弃孤儿/重复，为未配对的调用补桩
  const out: Message[] = [];
  const placeholderFor = new Set<string>();
  let injected = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    if (orphanAt.has(i) || duplicateAt.has(i)) continue;
    const message = normalized[i];
    out.push(message);
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (!isToolCallBlock(block)) continue;
      // >= ：结果与调用同处一条消息（历史数据的折叠形态）也算已配对；
      // 独立结果消息必然在下标更大的位置，两种形态都覆盖
      const answered = (firstResultAt.get(block.toolCallId) ?? -1) >= i;
      if (answered || placeholderFor.has(block.toolCallId)) continue;
      placeholderFor.add(block.toolCallId);
      injected += 1;
      out.push(buildPlaceholderToolResult(block, i));
    }
  }

  const dropped = orphanAt.size;
  const deduped = duplicateAt.size;
  if (idSynthCount > 0 || injected > 0 || dropped > 0 || deduped > 0) {
    logger.warn(
      `[tool-pairing] ${label}: 请求前配对兜底 — 补桩 ${injected} 个缺失工具结果, ` +
        `丢弃 ${dropped} 个孤儿结果, 去重 ${deduped} 个重复结果, 合成 ${idSynthCount} 个空 toolCallId。` +
        `历史已被写脏（调用与结果分两批落盘期间中断），建议排查产生路径。`,
    );
  }
  if (injected === 0 && dropped === 0 && deduped === 0 && idSynthCount === 0) {
    return messages as Message[];
  }
  return out;
}

/** 合成「该调用没有结果」的占位工具结果（紧随声明的 assistant 消息之后） */
function buildPlaceholderToolResult(call: ToolCallBlock, at: number): Message {
  return {
    id: `${SYNTHETIC_ID_PREFIX}${call.toolCallId}`,
    role: 'tool',
    kind: 'model',
    source: { kind: 'tool', toolCallId: call.toolCallId },
    metadata: { synthetic: 'tool-pairing-guard', originMessageIndex: at },
    content: [
      {
        type: 'tool-result',
        toolCallId: call.toolCallId,
        name: call.name,
        content: SYNTHETIC_TOOL_INTERRUPTED_TEXT,
        isError: true,
      },
    ],
  };
}
