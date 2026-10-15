/// <reference types="jest" />

import { ensureToolPairing } from '../../src/modules/llm-core/tool-pairing.guard';
import { SYNTHETIC_TOOL_INTERRUPTED_TEXT } from '../../src/common/utils/tool-pairing.util';
import type { Message } from '../../src/common/types/conversation.types';

function userMsg(id: string, text = 'q'): Message {
  return {
    id,
    role: 'user',
    kind: 'user',
    source: { kind: 'user' },
    metadata: {},
    content: [{ type: 'text', text }],
  };
}

function assistantCall(id: string, calls: Array<{ id: string; name: string }>): Message {
  return {
    id,
    role: 'assistant',
    kind: 'model',
    source: { kind: 'model', provider: 'test', model: 'm' },
    metadata: {},
    content: [
      { type: 'text', text: 'calling' },
      ...calls.map((c) => ({
        type: 'tool-call' as const,
        toolCallId: c.id,
        name: c.name,
        arguments: '{}',
      })),
    ],
  };
}

function toolResult(id: string, callId: string, name = 'shell'): Message {
  return {
    id,
    role: 'tool',
    kind: 'model',
    source: { kind: 'tool', toolCallId: callId },
    metadata: {},
    content: [{ type: 'tool-result', toolCallId: callId, name, content: 'ok' }],
  };
}

describe('ensureToolPairing（请求前配对兜底）', () => {
  it('调用无结果 → 紧随 assistant 补一条 isError 合成结果', () => {
    const input = [userMsg('u1'), assistantCall('a1', [{ id: 'c1', name: 'shell' }])];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    expect(out).toHaveLength(3);
    expect(out[1].id).toBe('a1');
    const injected = out[2];
    expect(injected.role).toBe('tool');
    expect(injected.source).toEqual({ kind: 'tool', toolCallId: 'c1' });
    expect(injected.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'c1',
      name: 'shell',
      isError: true,
      content: SYNTHETIC_TOOL_INTERRUPTED_TEXT,
    });
  });

  it('多个调用只缺其一 → 只补缺失的那条，原有结果保留', () => {
    const input = [
      userMsg('u1'),
      assistantCall('a1', [
        { id: 'c1', name: 'shell' },
        { id: 'c2', name: 'read' },
      ]),
      toolResult('t1', 'c1'),
    ];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', '__pairing_c2', 't1']);
    expect(out[2].content[0]).toMatchObject({ toolCallId: 'c2', isError: true });
  });

  it('配对完整 → 原样返回（同一引用，不做无谓拷贝）', () => {
    const input = [userMsg('u1'), assistantCall('a1', [{ id: 'c1', name: 'shell' }]), toolResult('t1', 'c1')];
    expect(ensureToolPairing(input, { sessionId: 's1' })).toBe(input);
  });

  it('空 toolCallId → 合成 id，但不改写入参对象', () => {
    const input = [assistantCall('a1', [{ id: '', name: 'shell' }])];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    const synthesized = (out[0].content[1] as any).toolCallId as string;
    expect(synthesized).toMatch(/^call_/);
    // 入参（共享快照视图）必须保持只读契约
    expect((input[0].content[1] as any).toolCallId).toBe('');
  });

  it('孤儿工具结果（调用不在窗口内）→ 从 wire 丢弃', () => {
    // 压缩前缀剪切的典型产物：窗口以工具结果开头
    const input = [toolResult('t9', 'gone'), userMsg('u1')];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    expect(out.map((m) => m.id)).toEqual(['u1']);
  });

  it('同一调用重复结果 → 只保留首条', () => {
    const input = [
      assistantCall('a1', [{ id: 'c1', name: 'shell' }]),
      toolResult('t1', 'c1'),
      toolResult('t2', 'c1'),
    ];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    expect(out.map((m) => m.id)).toEqual(['a1', 't1']);
  });

  it('无 callId 的工具结果消息 → 视为无法配对并丢弃', () => {
    const broken: Message = {
      id: 't1',
      role: 'tool',
      kind: 'model',
      source: { kind: 'tool', toolCallId: '' },
      metadata: {},
      content: [{ type: 'tool-result', toolCallId: '', name: 'shell', content: 'x' }],
    };
    const out = ensureToolPairing([broken, userMsg('u1')], { sessionId: 's1' });
    expect(out.map((m) => m.id)).toEqual(['u1']);
  });

  it('多回合混合脏数据 → 补桩与丢弃各自独立生效', () => {
    const input = [
      userMsg('u1'),
      assistantCall('a1', [{ id: 'c1', name: 'shell' }]),
      toolResult('t1', 'c1'),
      userMsg('u2'),
      assistantCall('a2', [{ id: 'c2', name: 'read' }]),
    ];
    const out = ensureToolPairing(input, { sessionId: 's1' });

    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 't1', 'u2', 'a2', '__pairing_c2']);
  });

  it('调用与结果同处一条消息（历史折叠形态）→ 不重复补桩', () => {
    const folded: Message = {
      ...assistantCall('a1', [{ id: 'c1', name: 'shell' }]),
      content: [
        { type: 'tool-call', toolCallId: 'c1', name: 'shell', arguments: '{}' },
        { type: 'tool-result', toolCallId: 'c1', name: 'shell', content: 'ok' },
      ],
    };
    const input = [folded];
    expect(ensureToolPairing(input, { sessionId: 's1' })).toBe(input);
  });
});
