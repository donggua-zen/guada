/// <reference types="jest" />

import { foldEvents } from '../../src/common/persistence/replayer';
import type { BaseEvent } from '../../src/common/persistence/types';

/** 构造一轮基础事件：回合 + user 消息 + assistant 消息 + tool 结果 */
function baseRound(): BaseEvent[] {
  return [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: 'hi' }], metadata: {} } },
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
  const m = state.messages.find((n) => n.id === 'r1');
  const tr = m?.content.find((b) => b.type === 'tool-result');
  return (tr as { content: string }).content;
}

describe('replayer compaction 前缀范围删除 + 头部摘要（消息级）', () => {
  // 压缩范围 = 视图头部开始的连续前缀（引擎 shadowedMessages = messages.slice(0, boundary)），
  // shadowedMessageIds 即该前缀的 id 清单；摘要置消息头，以 role/kind 区分
  const compactEvents: BaseEvent[] = [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: '旧问题' }], metadata: {} } },
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
    expect(state.messages.map((n) => n.id)).toEqual(['sum_1']);
    const sum = state.messages[0];
    // 检查点 = user 角色 + source.plugin='compact'（DSH 式可见检查点；二次压缩与前端按 source 识别）
    expect(sum.role).toBe('user');
    expect(sum.kind).toBe('model');
    expect(sum.source).toMatchObject({ kind: 'plugin', plugin: 'compact' });
    expect(sum.metadata.eventType).toBe('compaction');
    expect((sum.metadata.compactInfo as any).summary).toBe('已压缩');
  });

  it('折叠态即可视视图：检查点（compact 消息）在列，位于头部', () => {
    const msgs = foldEvents(compactEvents).messages;
    expect(msgs.map((m) => m.id)).toEqual(['sum_1']);
    expect(msgs[0].role).toBe('user');
  });

  it('幂等：同一 compaction 事件再次重放不重复折叠', () => {
    const state = foldEvents(compactEvents);
    const again = foldEvents(compactEvents, state);
    expect(again.messages.map((n) => n.id)).toEqual(['sum_1']);
  });

  it('summaryMessageId 缺省时以 __compact_<seq> 兜底', () => {
    const events: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: 'q' }], metadata: {} } },
      { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: 'a' }], metadata: {} } },
      { type: 'compaction/summary', seq: 4, time: 4, data: { shadowedMessageIds: ['u1', 'a1'], summary: '缺省摘要' } },
    ];
    const state = foldEvents(events);
    expect(state.messages.map((n) => n.id)).toEqual(['__compact_4']);
  });
});

describe('replayer 摘要原位还原（头部替换，对齐 DSH surface replace）', () => {
  // 压缩遮蔽第一回合的消息（u1/a1），但压缩发生时当前回合是 t2——
  // 摘要必须置于消息头（被遮蔽消息原位置），而非当前回合（t2）末尾
  const events: BaseEvent[] = [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: '旧问题1' }], metadata: {} } },
    { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '旧回答1' }], metadata: {} } },
    { type: 'turn/start', seq: 4, time: 4, data: { turnId: 't2', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 5, time: 5, data: { messageId: 'u2', kind: 'user', blocks: [{ type: 'text', contentId: 'u2', text: '新问题' }], metadata: {} } },
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
    expect(state.messages.map((n) => n.id)).toEqual(['sum_1', 'u2', 'a2']);
    expect(state.messages[0].turnId).toBe('t1');
    expect(state.messages[1].turnId).toBe('t2');
  });

  it('折叠态即可视视图：摘要位于头部，保留消息顺序不变', () => {
    const msgs = foldEvents(events).messages;
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
    expect(state.messages.map((n) => n.id)).toEqual(['sum_2', 'a2']);
    const msgs = state.messages;
    expect(msgs.map((m) => m.id)).toEqual(['sum_2', 'a2']);
    // 单一新检查点，无重复
    const summaries = msgs.filter(
      (m) =>
        m.source?.kind === 'plugin' &&
        m.source.plugin === 'compact' &&
        m.metadata?.eventType === 'compaction',
    );
    expect(summaries).toHaveLength(1);
  });

  it('DISABLED 模式（空摘要）：范围删除 + 占位文本仍置头部（空 content 会被 LLM 拒绝）', () => {
    const disabledEvents: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: '旧问题' }], metadata: {} } },
      { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'a1', content: [{ type: 'text', contentId: 'a1', text: '旧回答' }], metadata: {} } },
      {
        type: 'compaction/summary',
        seq: 4,
        time: 4,
        data: { shadowedMessageIds: ['u1'], summary: '', summaryMessageId: 'sum_0' },
      },
    ];
    const state = foldEvents(disabledEvents);
    expect(state.messages.map((n) => n.id)).toEqual(['sum_0', 'a1']);
    // 空摘要 → 占位文本块（保证请求合法，adapter 不拒绝）
    const block = state.messages[0].content[0] as { type: string; text: string };
    expect(block.type).toBe('text');
    expect(block.text).toBe('[compacted region]');
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
      const toolMsg = state.messages.find((n) => n.id === 'r1')!;
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
      const toolMsg = state.messages.find((n) => n.id === 'r1')!;
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
      const text = state.messages.find((n) => n.id === 'a1')!.content.find((b) => b.type === 'text');
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
      const text = state.messages.find((n) => n.id === 'a1')!.content.find((b) => b.type === 'text');
      expect((text as { text: string }).text).toBe('编辑后的助手文本');
    });
  });

  describe('思考剥离（strategy=thinking_strip）：reasoning 块保留、summary 置空', () => {
    /** 一轮：user + assistant（reasoning + text + tool-call）+ tool 结果 */
    function thinkingRound(): BaseEvent[] {
      return [
        { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
        { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', text: 'hi' }], metadata: {} } },
        {
          type: 'assistant/message',
          seq: 3,
          time: 3,
          data: {
            messageId: 'a1',
            content: [
              { type: 'reasoning', summary: '这是一段很长的历史思考内容' },
              { type: 'text', text: '可见回答' },
              { type: 'tool-call', toolCallId: 'call_1', name: 'shell', arguments: '{}' },
            ],
            metadata: {},
          },
        },
        {
          type: 'tool/result',
          seq: 4,
          time: 4,
          data: { messageId: 'r1', toolCallId: 'call_1', name: 'shell', content: '工具输出原文', isError: false, metadata: {} },
        },
      ];
    }

    const stripEvent: BaseEvent = {
      type: 'message/prune',
      seq: 5,
      time: 5,
      data: { messageId: 'a1', newContent: '', prunedBytes: 16, strategy: 'thinking_strip', prunedTokens: 20 },
    };

    it('默认链路：reasoning.summary 置空、块保留，text/tool-call 不受影响', () => {
      const state = foldEvents([...thinkingRound(), stripEvent] as BaseEvent[]);
      const msg = state.messages.find((n) => n.id === 'a1')!;
      const reasoning = msg.content.find((b) => b.type === 'reasoning') as { summary: string };
      // 块保留（不删除）——读取管线按思考模式决定填充 ' ' 还是整块剥离
      expect(reasoning).toBeDefined();
      expect(reasoning.summary).toBe('');
      // 其它块不被误清（thinking_strip 必须走显式分支，不能落通用 else）
      expect((msg.content.find((b) => b.type === 'text') as { text: string }).text).toBe('可见回答');
      expect((msg.content.find((b) => b.type === 'tool-call') as { arguments: string }).arguments).toBe('{}');
      expect((msg.metadata.pruneInfo as { strategy?: string })?.strategy).toBe('thinking_strip');
    });

    it('展示链路（applyCompressionPrune=false）：思考保留原文、不写 pruneInfo', () => {
      const state = foldEvents([...thinkingRound(), stripEvent] as BaseEvent[], undefined, {
        applyCompressionPrune: false,
      });
      const msg = state.messages.find((n) => n.id === 'a1')!;
      const reasoning = msg.content.find((b) => b.type === 'reasoning') as { summary: string };
      expect(reasoning.summary).toBe('这是一段很长的历史思考内容');
      expect(msg.metadata.pruneInfo).toBeUndefined();
    });

    it('回归守卫：thinking_strip 不误改工具结果（通用 else 分支按 tool-result 定位）', () => {
      const state = foldEvents([...thinkingRound(), stripEvent] as BaseEvent[]);
      expect(toolResultText(state)).toBe('工具输出原文');
    });
  });
});
describe('replayer v1.4 分界点 id 遮蔽（shadowedCount 主表示）', () => {
  // 新格式：compaction/summary 事件带 shadowedEndId（分界点消息 id）+ shadowedCount，
  // replayer O(1) 头删除（不再 Set+全扫）；id 为 ULID 基座（m_/c_ + 26 字符，检查点 c_ 恒排前）。
  const orderedEvents: BaseEvent[] = [
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV', kind: 'user', blocks: [{ type: 'text', contentId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV', text: '旧问题' }], metadata: {} } },
    { type: 'assistant/message', seq: 3, time: 3, data: { messageId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAW', content: [{ type: 'text', contentId: 'c1', text: '旧回答' }], metadata: {} } },
    { type: 'turn/start', seq: 4, time: 4, data: { turnId: 't2', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 5, time: 5, data: { messageId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAY', kind: 'user', blocks: [{ type: 'text', contentId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAY', text: '新问题' }], metadata: {} } },
    {
      type: 'compaction/summary',
      seq: 6,
      time: 6,
      data: {
        shadowedEndId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAW',
        shadowedCount: 2,
        summary: '已压缩',
        summaryMessageId: 'c_01ARZ3NDEKTSV4RRFFQ69G5FAX',
      },
    },
  ];

  it('shadowedCount 头删除：遮蔽前 N 条 + 摘要置头部（O(1)，不依赖 id 清单）', () => {
    const state = foldEvents(orderedEvents);
    expect(state.messages.map((n) => n.id)).toEqual(['c_01ARZ3NDEKTSV4RRFFQ69G5FAX', 'm_01ARZ3NDEKTSV4RRFFQ69G5FAY']);
    expect(state.messages[0].turnId).toBe('t1');
    expect(state.messages[1].turnId).toBe('t2');
    // compactInfo 记录分界点 id + 条数（不再离散清单）
    expect((state.messages[0].metadata.compactInfo as any).shadowedEndId).toBe(
      'm_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    );
    expect((state.messages[0].metadata.compactInfo as any).shadowedCount).toBe(2);
  });

  it('shadowedCount 超出现有消息数时钳制（防御），不越界', () => {
    const events: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 't1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV', kind: 'user', blocks: [{ type: 'text', contentId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV', text: 'q' }], metadata: {} } },
      {
        type: 'compaction/summary',
        seq: 3,
        time: 3,
        data: {
          shadowedEndId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          shadowedCount: 99,
          summary: 's',
          summaryMessageId: 'c_01ARZ3NDEKTSV4RRFFQ69G5FAX',
        },
      },
    ];
    const state = foldEvents(events);
    expect(state.messages.map((n) => n.id)).toEqual(['c_01ARZ3NDEKTSV4RRFFQ69G5FAX']);
  });

  it('二次压缩：旧检查点（c_ 前缀）落在遮蔽区 → 被替换不重复', () => {
    const second: BaseEvent[] = [
      {
        type: 'compaction/summary',
        seq: 7,
        time: 7,
        data: {
          shadowedEndId: 'm_01ARZ3NDEKTSV4RRFFQ69G5FAY',
          shadowedCount: 2,
          summary: '二次压缩',
          summaryMessageId: 'c_01ARZ3NDEKTSV4RRFFQ69G5FBZ',
        },
      },
    ];
    const state = foldEvents([...orderedEvents, ...second]);
    expect(state.messages.map((n) => n.id)).toEqual(['c_01ARZ3NDEKTSV4RRFFQ69G5FBZ']);
  });
});
