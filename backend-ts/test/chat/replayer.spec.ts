/// <reference types="jest" />

import { foldEvents } from '../../src/common/persistence/replayer';
import type { BaseEvent } from '../../src/common/persistence/types';

// ─── 事件构造辅助 ───

function ev(partial: Partial<BaseEvent> & { type: BaseEvent['type'] }): BaseEvent {
  return {
    seq: 0,
    time: 1700000000000,
    data: {},
    ...partial,
  } as BaseEvent;
}

function turnStart(turnId: string, seq: number): BaseEvent {
  return ev({ type: 'turn/start', seq, data: { turnId, kind: 'turn', metadata: {} } });
}

function userMessage(messageId: string, seq: number): BaseEvent {
  return ev({
    type: 'user/message',
    seq,
    // P6：事件格式统一为 blocks
    data: {
      messageId,
      kind: 'user',
      blocks: [{ type: 'text', contentId: messageId, text: '你好' }],
      metadata: {},
    },
  });
}

function assistantMessage(messageId: string, seq: number): BaseEvent {
  return ev({
    type: 'assistant/message',
    seq,
    data: {
      messageId,
      content: [
        { type: 'text', contentId: messageId, text: '回答内容' },
      ],
      metadata: { modelName: 'test-model' },
    },
  });
}

function turnFinish(turnId: string, seq: number): BaseEvent {
  return ev({
    type: 'turn/finish',
    seq,
    data: {
      turnId,
      promptTokens: 100,
      completionTokens: 50,
      cachedTokens: 10,
      totalTokens: 160,
      finishReason: 'stop',
      totalDurationMs: 1234,
      modelName: 'test-model',
    },
  });
}

describe('replayer 折叠 - 扁平消息 surface（零 turn 结构，P0-1 回归）', () => {
  it('消息平铺 + 归属标签 + turn/finish 清游标', () => {
    const events = [
      turnStart('t1', 1),
      userMessage('u1', 2),
      assistantMessage('a1', 3),
      turnFinish('t1', 4),
    ];

    const state = foldEvents(events);
    // 扁平 surface：消息平铺在 messages（带归属标签），零回合结构
    expect(state.messages.map((n) => n.id)).toEqual(['u1', 'a1']);
    expect(state.messages.every((n) => n.turnId === 't1')).toBe(true);
    expect('turnMeta' in state).toBe(false);
    expect('turns' in state).toBe(false);
    // P0-1 回归：turn/finish 清空游标（下一回合事件不挂进上一回合）
    expect(state.currentTurnId).toBeNull();
  });

  it('连续两个回合：finish 后游标复位，第二个回合消息正确归位', () => {
    const events = [
      turnStart('t1', 1),
      userMessage('u1', 2),
      assistantMessage('a1', 3),
      turnFinish('t1', 4),
      turnStart('t2', 5),
      userMessage('u2', 6),
      assistantMessage('a2', 7),
      turnFinish('t2', 8),
    ];

    const state = foldEvents(events);
    const byTurn = (tid: string) =>
      state.messages.filter((n) => n.turnId === tid).map((n) => n.id);
    expect(byTurn('t1')).toEqual(['u1', 'a1']);
    expect(byTurn('t2')).toEqual(['u2', 'a2']);
  });

  it('turnId 不匹配的 finish（P0-1 旧行为产物）被安全忽略，不抛错', () => {
    const events = [
      turnStart('t1', 1),
      userMessage('u1', 2),
      // 旧 bug 产物：overwrite 写 "" / resume 写 assistant 消息 id → 匹配失败
      turnFinish('', 3),
      assistantMessage('a1', 4),
    ];

    const state = foldEvents(events);
    expect(state.messages.map((n) => n.id)).toEqual(['u1', 'a1']);
    // 不匹配的 finish 不清游标（游标保持 t1，后续消息归属不丢失）
    expect(state.currentTurnId).toBe('t1');
  });

  it('折叠态即可视视图：纯消息级（turn 无关）', () => {
    const events = [
      turnStart('t1', 1),
      userMessage('u1', 2),
      assistantMessage('a1', 3),
      turnFinish('t1', 4),
    ];
    const msgs = foldEvents(events).messages;
    expect(msgs.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});

describe('审批与 metadata 补丁事件', () => {
  function turnStart(id: string, seq: number) {
    return { type: 'turn/start' as const, seq, time: seq, data: { turnId: id, kind: 'turn', metadata: {} } };
  }
  function userMessage(id: string, seq: number) {
    return { type: 'user/message' as const, seq, time: seq, data: { messageId: id, kind: 'user', blocks: [{ type: 'text', contentId: id, text: 'q' }], metadata: {} } };
  }
  function assistantMessage(id: string, seq: number) {
    return { type: 'assistant/message' as const, seq, time: seq, data: { messageId: id, content: [{ type: 'text', contentId: `${id}_c`, text: 'a' }], metadata: {} } };
  }

  it('ask/asked 与 ask/answered 事件无状态透传（审计），不破坏折叠', () => {
    const events = [
      turnStart('t1', 1),
      userMessage('u1', 2),
      assistantMessage('a1', 3),
      {
        type: 'ask/asked' as const,
        seq: 4,
        time: 4,
        data: { requestId: 'r1', kind: 'approval', questions: [{ id: 'approval', question: '是否同意？', options: [{ label: '同意' }] }] },
      },
      {
        type: 'ask/answered' as const,
        seq: 5,
        time: 5,
        data: { requestId: 'r1', answers: [{ id: 'approval', selected: ['拒绝'] }] },
      },
    ];
    const state = foldEvents(events);
    expect(state.messages.map((n) => n.id)).toEqual(['u1', 'a1']);
  });
});

describe('replayer 折叠 - 视图占用锚点（OccupancyAnchor）', () => {
  function assistantWithUsage(id: string, seq: number, promptTokens?: number) {
    return {
      type: 'assistant/message' as const,
      seq,
      time: seq,
      data: {
        messageId: id,
        content: [{ type: 'text', contentId: `${id}_c`, text: 'a' }],
        metadata:
          promptTokens === undefined
            ? {}
            : { modelName: 'test-model', usage: { promptTokens } },
      },
    };
  }
  function compactionEnd(seq: number, data: Record<string, unknown>) {
    return { type: 'compaction/end' as const, seq, time: seq, data };
  }

  it('带 provider usage 的助手消息 → usage 锚点；无 usage 的消息不设锚点', () => {
    const withoutUsage = foldEvents([
      turnStart('t1', 1),
      assistantWithUsage('a1', 2),
    ]);
    expect(withoutUsage.occupancyAnchor).toBeNull();

    const withUsage = foldEvents([
      turnStart('t1', 1),
      assistantWithUsage('a1', 2, 1000),
    ]);
    expect(withUsage.occupancyAnchor).toEqual({ kind: 'usage' });
  });

  it('compaction/end 携带 usedTokens+heuristicTokens → 压缩锚点覆盖此前的 usage 锚点', () => {
    const state = foldEvents([
      turnStart('t1', 1),
      assistantWithUsage('a1', 2, 1000),
      compactionEnd(3, {
        usedTokens: 500,
        heuristicTokens: 300,
        effectiveContextWindow: 8000,
      }),
    ]);
    expect(state.occupancyAnchor).toEqual({
      kind: 'compaction',
      usedTokens: 500,
      heuristicTokens: 300,
    });
  });

  it('旧格式 compaction/end（无 heuristicTokens）不设锚点 → 回退 usage 口径', () => {
    const state = foldEvents([
      turnStart('t1', 1),
      assistantWithUsage('a1', 2, 1000),
      // 历史数据/纯审计 end：无配套启发式总量，用错口径会让占用偏离真实值
      compactionEnd(3, { usedTokens: 500, effectiveContextWindow: 8000 }),
    ]);
    expect(state.occupancyAnchor).toEqual({ kind: 'usage' });
  });

  it('压缩锚点之后的新回合 usage 消息接管锚点（顺序由回放保证）', () => {
    const state = foldEvents([
      turnStart('t1', 1),
      assistantWithUsage('a1', 2, 1000),
      compactionEnd(3, { usedTokens: 500, heuristicTokens: 300 }),
      turnStart('t2', 4),
      assistantWithUsage('a2', 5, 700),
    ]);
    expect(state.occupancyAnchor).toEqual({ kind: 'usage' });
  });
});