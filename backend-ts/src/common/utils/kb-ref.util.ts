/**
 * KB 引用块 ↔ 模型面文本 的共享转换。
 *
 * KbRefBlock 是结构化引用（前端 chips 渲染），LLM 侧统一投影为清单文本：
 * 三处消费方（message-transform.pipeline 投影 / token-meter 计量 / llm-summary
 * 摘要序列化）共用同一文本形状，确保 token 口径与摘要口径一致。
 */
import type { ContentBlock } from '../types/conversation.types';

/** 单条引用的文本形状（与旧版 appendKbReferenceInfo 对齐） */
function kbRefLine(ref: {
  id: string;
  name: string;
  description?: string;
}): string {
  let line = `- name: ${ref.name}, id: ${ref.id}`;
  if (ref.description) line += `, description: ${ref.description}`;
  return line;
}

/** KB 引用明细 → 模型面清单文本 */
export function kbRefsToText(
  refs: Extract<ContentBlock, { type: 'kb-ref' }>['kbRefs'],
): string {
  if (!refs || refs.length === 0) return '[referenced knowledge bases]\n(none)';
  return `[referenced knowledge bases]\n${refs.map(kbRefLine).join('\n')}`;
}
