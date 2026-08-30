/// <reference types="jest" />

import { foldEvents, deriveMessages } from '../../src/common/persistence/replayer';
import type { BaseEvent } from '../../src/common/persistence/types';

/** 构造一轮基础事件：回合 + user 消息 + assistant 消息 + tool 结果 */
function baseRound(): BaseEvent[] {
  return [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', content: 'hi', metadata: {} } },
    {
      type: 'assistant/message',
      seq: 3,
      time: 3,
      data: {
        messageId: 'a1',
        content: [
          { type: 'tool-call', contentId: 'a1', toolCallId: 'call_1', name: 'shell', arguments: '{}' },
        ],
        metadata: {},
      },
    },
    {
      type: 'tool/result',
      seq: 4,
      time: 4,
      data: {
        messageId: 'r1',
        toolCallId: 'call_1',
        name: 'shell',
        content: '这是很长的工具输出，需要被压缩裁剪的原始完整内容',
        isError: false,
        metadata: {},
      },
    },
  ];
}

/** 工具结果文本（扁平 surface 定位） */
function toolResultText(state: ReturnType<typeof foldEvents>): string {
  const m = state.messages.find((n) => n.message.id === 'r1')?.message;
  const tr = m?.content.find((b) => b.type === 'tool-result');
  return (tr as { content: string }).content;
}

describe('replayer compaction 前缀范围删除 + 头部摘要（消息级）', () => {
  // 压缩范围 = 视图头部开始的连续前缀（引擎 shadowedMessages = messages.slice(0, boundary)），
  // shadowedMessageIds 即该前缀的 id 清单；摘要置消息头，以 role/kind 区分
  const compactEvents: BaseEvent[] = [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', content: '旧问题', metadata: {} } },
    { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '旧回答' }], metadata: {} } },
    {
      type: 'compaction/summary',
      seq: 4,
      time: 4,
      data: { shadowedMessageIds: ['u1', 'a1'], summary: '已压缩', summaryMessageId: 'sum_1' },
    },
  ];

  it('范围删除 + 摘要置消息头（继承首节点归属标签）', () => {
    const state = foldEvents(compactEvents);
    // 扁平：被遮蔽消息移除，摘要置头部
    expect(state.messages.map((n) => n.message.id)).toEqual(['sum_1']);
    const sum = state.messages[0].message;
    // 摘要以 role/kind 区分（供二次压缩与前端识别）
    expect(sum.role).toBe('event');
    expect(sum.kind).toBe('model');
    expect(sum.metadata.eventType).toBe('compaction');
    expect((sum.metadata.compactInfo as any).summary).toBe('已压缩');
  });

  it('LLM 投影 deriveMessages：摘要（compaction 事件消息）进入上下文，位于头部', () => {
    const msgs = deriveMessages(foldEvents(compactEvents));
    expect(msgs.map((m) => m.id)).toEqual(['sum_1']);
    expect(msgs[0].role).toBe('event');
  });

  it('幂等：同一 compaction 事件再次重放不重复折叠', () => {
    const state = foldEvents(compactEvents);
    const again = foldEvents(compactEvents, state);
    expect(again.messages.map((n) => n.message.id)).toEqual(['sum_1']);
  });

  it('summaryMessageId 缺省时以 __compact_<seq> 兜底', () => {
    const events: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', content: 'q', metadata: {} } },
      { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: 'a' }], metadata: {} } },
      { type: 'compaction/summary', seq: 4, time: 4, data: { shadowedMessageIds: ['u1', 'a1'], summary: '缺省摘要' } },
    ];
    const state = foldEvents(events);
    expect(state.messages.map((n) => n.message.id)).toEqual(['__compact_4']);
  });
});

describe('replayer 摘要原位还原（头部替换，对齐 DSH surface replace）', () => {
  // 压缩遮蔽第一回合的消息（u1/a1），但压缩发生时当前回合是 t2——
  // 摘要必须置于消息头（被遮蔽消息原位置），而非当前回合（t2）末尾
  const events: BaseEvent[] = [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', content: '旧问题1', metadata: {} } },
    { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '旧回答1' }], metadata: {} } },
    { type: 'turn/start', seq: 4, time: 4, data: { turnId: 't2', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 5, time: 5, data: { messageId: 'u2', kind: 'user', content: '新问题', metadata: {} } },
    { type: 'assistant/message', seq: 6, time: 6, data: { messageId: 'a2', content: [{ type: 'text', contentId: 'a2', text: '新回答' }], metadata: {} } },
    {
      type: 'compaction/summary',
      seq: 7,
      time: 7,
      data: { shadowedMessageIds: ['u1', 'a1'], summary: '已压缩旧对话', summaryMessageId: 'sum_1' },
    },
  ];

  it('摘要置于消息头（t1），当前回合 t2 消息不受影响', () => {
    const state = foldEvents(events);
    // 摘要继承首节点归属标签（t1）；u2/a2 归属 t2 保持不变
    expect(state.messages.map((n) => n.message.id)).toEqual(['sum_1', 'u2', 'a2']);
    expect(state.messages[0].turnId).toBe('t1');
    expect(state.messages[1].turnId).toBe('t2');
  });

  it('LLM 投影：摘要位于头部，保留消息顺序不变', () => {
    const msgs = deriveMessages(foldEvents(events));
    expect(msgs.map((m) => m.id)).toEqual(['sum_1', 'u2', 'a2']);
  });

  it('二次压缩：旧摘要（消息头）落在新删除范围内 → 自然被替换，不重复', () => {
    const second: BaseEvent[] = [
      { type: 'compaction/start', seq: 8, time: 8, data: {} },
      {
        type: 'compaction/summary',
        seq: 9,
        time: 9,
        data: { shadowedMessageIds: ['sum_1', 'u2'], summary: '二次压缩', summaryMessageId: 'sum_2' },
      },
      { type: 'compaction/end', seq: 10, time: 10, data: {} },
    ];
    const state = foldEvents([...events, ...second]);
    expect(state.messages.map((n) => n.message.id)).toEqual(['sum_2', 'a2']);
    const msgs = deriveMessages(state);
    expect(msgs.map((m) => m.id)).toEqual(['sum_2', 'a2']);
    // 单一新摘要，无重复
    const summaries = msgs.filter(
      (m) => m.role === 'event' && m.metadata?.eventType === 'compaction',
    );
    expect(summaries).toHaveLength(1);
  });

  it('DISABLED 模式（空摘要）：范围删除 + 空文本占位仍置头部', () => {
    const disabledEvents: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', content: '旧问题', metadata: {} } },
      { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '旧回答' }], metadata: {} } },
      {
        type: 'compaction/summary',
        seq: 4,
        time: 4,
        data: { shadowedMessageIds: ['u1'], summary: '', summaryMessageId: 'sum_0' },
      },
    ];
    const state = foldEvents(disabledEvents);
    expect(state.messages.map((n) => n.message.id)).toEqual(['sum_0', 'a1']);
    expect(state.messages[0].message.content).toEqual([]);
  });
});

describe('replayer message/prune 双链路规则', () => {
  describe('默认（LLM 链路）：压缩裁剪就地应用', () => {
    it('head_tail_500 改写 tool-result 内容并写 pruneInfo', () => {
      const events = [
        ...baseRound(),
        {
          type: 'message/prune',
          seq: 5,
          time: 5,
          data: { messageId: 'r1', newContent: '裁剪后', prunedBytes: 10, strategy: 'head_tail_500' },
        },
      ] as BaseEvent[];

      const state = foldEvents(events);
      expect(toolResultText(state)).toBe('裁剪后');
      const toolMsg = state.messages.find((n) => n.message.id === 'r1')!.message;
      expect((toolMsg.metadata.pruneInfo as { strategy?: string })?.strategy).toBe('head_tail_500');
    });
  });

  describe('前端展示链路（applyCompressionPrune=false）：压缩裁剪不应用', () => {
    it('head_tail_500 不改写 tool-result（保留原文）且不写 pruneInfo', () => {
      const events = [
        ...baseRound(),
        {
          type: 'message/prune',
          seq: 5,
          time: 5,
          data: { messageId: 'r1', newContent: '裁剪后', prunedBytes: 10, strategy: 'head_tail_500' },
        },
      ] as BaseEvent[];

      const state = foldEvents(events, undefined, { applyCompressionPrune: false });
      expect(toolResultText(state)).toBe('这是很长的工具输出，需要被压缩裁剪的原始完整内容');
      const toolMsg = state.messages.find((n) => n.message.id === 'r1')!.message;
      expect(toolMsg.metadata.pruneInfo).toBeUndefined();
    });
  });

  describe('用户编辑（strategy=user_edit）：两链路都应用（所见即所得）', () => {
    const editEvent: BaseEvent = {
      type: 'message/prune',
      seq: 5,
      time: 5,
      data: { messageId: 'a1', newContent: '编辑后的助手文本', strategy: 'user_edit' },
    };

    it('默认链路：text 块被改写', () => {
      const events = [
        { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
        {
          type: 'assistant/message',
          seq: 2,
          time: 2,
          data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '原文文本' }], metadata: {} },
        },
        editEvent,
      ] as BaseEvent[];
      const state = foldEvents(events);
      const text = state.messages.find((n) => n.message.id === 'a1')!.message.content.find((b) => b.type === 'text');
      expect((text as { text: string }).text).toBe('编辑后的助手文本');
    });

    it('展示链路（applyCompressionPrune=false）：同样回显', () => {
      const events = [
        { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
        {
          type: 'assistant/message',
          seq: 2,
          time: 2,
          data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '原文文本' }], metadata: {} },
        },
        editEvent,
      ] as BaseEvent[];
      const state = foldEvents(events, undefined, { applyCompressionPrune: false });
      const text = state.messages.find((n) => n.message.id === 'a1')!.message.content.find((b) => b.type === 'text');
      expect((text as { text: string }).text).toBe('编辑后的助手文本');
    });
  });
});