/**
 * MessageTransformPipeline reasoning 策略直通测试
 *
 * 覆盖（stripReasoning 元数据清理：被剥离思考的消息不得残留思考私有元数据）：
 * - 非思考模式：reasoning 块剥离，metadata.signature/redactedData 一并清理，
 *   其余字段（usage 等）保留——否则 anthropic.adapter 会依据 metadata 仍注入
 *   thinking/redacted_thinking（泄漏路径回归）
 * - 思考模式默认：历史轮剥离+清理；当前轮保留且 metadata 原样
 * - fullReasoningRelay（DeepSeek V4/V4.1 系，含改名后的 deepseek-flash / deepseek-pro）：
 *   全量保留、metadata 不动
 * - currentTurnId 缺省：保守回退全量携带（行为不回退）
 * - 无思考元数据的消息剥离后 metadata 引用不变（不额外复制）
 * - 纯函数契约：入参消息对象不被修改
 */
import {
  reasoningPolicyStep,
  type TransformContext,
} from '../../src/modules/chat/message-transform.pipeline';
import type { Message } from '../../src/common/types/conversation.types';

/// <reference types="jest" />

function makeAssistantMsg(id: string, extra: any = {}): Message {
  return {
    id,
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: 'test', model: 'test-model' },
    metadata: {},
    content: [
      { type: 'reasoning', summary: 'thought' },
      { type: 'text', text: 'answer' },
    ],
    ...extra,
  };
}

const baseCtx: TransformContext = {
  supportsImageInput: true,
  thinkingMode: true,
  currentTurnId: 't2',
};

describe('reasoningPolicyStep', () => {
  it('非思考模式剥离 reasoning 块并清理思考私有元数据，其余 metadata 字段保留', () => {
    const msg = makeAssistantMsg('a1', {
      metadata: { usage: { totalTokens: 10 }, signature: 'sig-1', redactedData: 'enc-1' },
    });

    const out = reasoningPolicyStep.apply([msg], { ...baseCtx, thinkingMode: false });

    expect(out[0].content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(out[0].metadata).toEqual({ usage: { totalTokens: 10 } });
  });

  it('思考模式默认：历史轮剥离+清理元数据，当前轮保留且 metadata 原样', () => {
    const history = makeAssistantMsg('a1', {
      metadata: { signature: 'sig-old', redactedData: 'enc-old' },
    });
    (history as any).turnId = 't1';
    const current = makeAssistantMsg('a2', { metadata: { signature: 'sig-new' } });
    (current as any).turnId = 't2';

    const out = reasoningPolicyStep.apply([history, current], baseCtx);

    expect(out[0].content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(out[0].metadata).toEqual({});
    expect(out[1].content.some((b) => b.type === 'reasoning')).toBe(true);
    expect(out[1].metadata).toEqual({ signature: 'sig-new' });
  });

  it('fullReasoningRelay：全量保留，metadata 不动（DeepSeek V4/V4.1 系回归保护）', () => {
    const history = makeAssistantMsg('a1', {
      metadata: { signature: 'sig-old', redactedData: 'enc-old' },
    });
    (history as any).turnId = 't1';

    const out = reasoningPolicyStep.apply([history], { ...baseCtx, fullReasoningRelay: true });

    expect(out[0].content.some((b) => b.type === 'reasoning')).toBe(true);
    expect(out[0].metadata).toEqual({ signature: 'sig-old', redactedData: 'enc-old' });
  });

  it('currentTurnId 缺省：保守回退全量携带（metadata 不动）', () => {
    const history = makeAssistantMsg('a1', { metadata: { signature: 'sig-old' } });
    (history as any).turnId = 't1';

    const out = reasoningPolicyStep.apply([history], { ...baseCtx, currentTurnId: null });

    expect(out[0].content.some((b) => b.type === 'reasoning')).toBe(true);
    expect(out[0].metadata).toEqual({ signature: 'sig-old' });
  });

  it('无思考元数据的消息剥离后 metadata 引用不变（不额外复制）', () => {
    const metadata = { usage: { totalTokens: 10 } };
    const msg = makeAssistantMsg('a1', { metadata });

    const out = reasoningPolicyStep.apply([msg], { ...baseCtx, thinkingMode: false });

    expect(out[0].content).toEqual([{ type: 'text', text: 'answer' }]);
    expect(out[0].metadata).toBe(metadata);
  });

  it('剥离不修改入参消息（纯函数契约，不污染 store 缓存）', () => {
    const msg = makeAssistantMsg('a1', {
      metadata: { signature: 'sig-1', redactedData: 'enc-1' },
    });

    reasoningPolicyStep.apply([msg], { ...baseCtx, thinkingMode: false });

    expect(msg.metadata.signature).toBe('sig-1');
    expect(msg.metadata.redactedData).toBe('enc-1');
    expect(msg.content.some((b) => b.type === 'reasoning')).toBe(true);
  });
});
