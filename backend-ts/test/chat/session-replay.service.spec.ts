/**
 * SessionReplayService 事件页单元测试
 *
 * 覆盖（前端自折叠的加载源，领域事件原样返回）：
 * - 反向扫描配对：turn/delete 作废多扫；页 = [页首有效回合 turn/start .. beforeSeq] 连续区间
 * - 领域事件原样：assistant/message 一条 = 全部块、turn/finish 带 finishReason/modelName——
 *   零转码、零过滤、零重建（被删回合/被压缩消息由前端经 turn/delete / compaction/summary 自行消解）
 * - 页边界不切回合括号；lastSeq/nextBeforeSeq/hasMore
 */
import { SessionReplayService } from '../../src/modules/chat/session-replay.service';
import type { BaseEvent } from '../../src/common/persistence/types';

/// <reference types="jest" />

/** 构造一个带 modelName/usage/finishReason 的完整回合事件序列 */
function makeEvents(): BaseEvent[] {
  return [
    // T1
    { type: 'turn/start', seq: 1, time: 1, data: { turnId: 'T1', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [{ type: 'text', contentId: 'u1', text: 'hi1' }], metadata: {} } },
    {
      type: 'assistant/message',
      seq: 3,
      time: 3,
      data: {
        messageId: 'a1',
        content: [{ type: 'text', contentId: 'a1_c', text: 'answer1' }],
        metadata: { modelName: 'm1', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      },
    },
    { type: 'turn/finish', seq: 4, time: 4, data: { turnId: 'T1', promptTokens: 10, completionTokens: 5, totalTokens: 15, finishReason: 'stop', modelName: 'm1' } },
    // T2（含 tool-call + tool-result）
    { type: 'turn/start', seq: 5, time: 5, data: { turnId: 'T2', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 6, time: 6, data: { messageId: 'u2', kind: 'user', blocks: [{ type: 'text', contentId: 'u2', text: 'hi2' }], metadata: {} } },
    {
      type: 'assistant/message',
      seq: 7,
      time: 7,
      data: {
        messageId: 'a2',
        content: [
          { type: 'tool-call', contentId: 'a2_c1', toolCallId: 'call_1', name: 'shell', arguments: '{}' },
          { type: 'text', contentId: 'a2_c2', text: 'answer2' },
        ],
        metadata: { modelName: 'm1', finishReason: 'tool-calls', usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } },
      },
    },
    { type: 'tool/result', seq: 8, time: 8, data: { messageId: 'r2', toolCallId: 'call_1', name: 'shell', content: 'out', isError: false } },
    { type: 'turn/finish', seq: 9, time: 9, data: { turnId: 'T2', promptTokens: 20, completionTokens: 5, totalTokens: 25, finishReason: 'tool-calls', modelName: 'm1' } },
    // 括号外压缩（遮蔽 T1 的 u1/a1）
    { type: 'compaction/start', seq: 10, time: 10, data: {} },
    { type: 'compaction/summary', seq: 11, time: 11, data: { shadowedMessageIds: ['u1', 'a1'], summary: 'sum', summaryMessageId: 'sum_1' } },
    { type: 'compaction/end', seq: 12, time: 12, data: {} },
    // T3
    { type: 'turn/start', seq: 13, time: 13, data: { turnId: 'T3', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 14, time: 14, data: { messageId: 'u3', kind: 'user', content: 'hi3', metadata: {} } },
    { type: 'assistant/message', seq: 15, time: 15, data: { messageId: 'a3', content: [{ type: 'text', contentId: 'a3_c', text: 'answer3' }], metadata: { modelName: 'm1', finishReason: 'stop', usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 } } } },
    { type: 'turn/finish', seq: 16, time: 16, data: { turnId: 'T3', promptTokens: 30, completionTokens: 5, totalTokens: 35, finishReason: 'stop', modelName: 'm1' } },
    // TD（被删除）
    { type: 'turn/start', seq: 17, time: 17, data: { turnId: 'TD', kind: 'turn', metadata: {} } },
    { type: 'user/message', seq: 18, time: 18, data: { messageId: 'ud', kind: 'user', content: 'hiD', metadata: {} } },
    { type: 'turn/delete', seq: 19, time: 19, data: { turnId: 'TD' } },
  ];
}

function createService(events: BaseEvent[]) {
  const backend = { getAllEvents: jest.fn(async () => events) };
  return new SessionReplayService(backend as any);
}

describe('SessionReplayService 事件页', () => {
  it('N=3：页 = 全量（领域事件原样，零转码/过滤）', async () => {
    const service = createService(makeEvents());
    const page = await service.getEventPage('s1', { turns: 3 });

    // 页尾/游标
    expect(page.endSeq).toBe(19);
    expect(page.nextBeforeSeq).toBeNull();
    expect(page.hasMore).toBe(false);

    // 领域事件原样（seq 序，含被删回合与被压缩消息——前端自行消解）
    expect(page.events).toHaveLength(makeEvents().length);
    expect(page.events.map((e) => e.seq)).toEqual(makeEvents().map((e) => e.seq));
    const types = page.events.map((e) => e.type);
    expect(types.filter((t) => t === 'turn/start')).toHaveLength(4); // T1/T2/T3/TD
    expect(types.filter((t) => t === 'assistant/message')).toHaveLength(3); // a1/a2/a3（含被压缩 a1）
    expect(types.filter((t) => t === 'turn/finish')).toHaveLength(3);

    // 被删回合：turn/start + turn/delete 原样返回（前端经 turn/delete 移除）
    expect(page.events.some((e) => e.type === 'turn/start' && (e.data as any).turnId === 'TD')).toBe(true);
    expect(page.events.some((e) => e.type === 'turn/delete' && (e.data as any).turnId === 'TD')).toBe(true);

    // 被压缩消息：u1/a1 原样返回（前端经 compaction/summary 移除）
    expect(page.events.some((e) => (e.data as any).messageId === 'u1')).toBe(true);

    // 领域事件数据原样（assistant/message 一条 = 全部块；turn/finish 自带 finishReason/modelName）
    const a2 = page.events.find((e) => e.type === 'assistant/message' && (e.data as any).messageId === 'a2')!;
    expect((a2.data as any).content).toHaveLength(2); // tool-call + text 完整块
    const t1finish = page.events.find((e) => e.type === 'turn/finish' && (e.data as any).turnId === 'T1')!;
    expect((t1finish.data as any).finishReason).toBe('stop');
    expect((t1finish.data as any).modelName).toBe('m1');

    // 括号外压缩 → compaction/summary 原样（携带遮蔽信息）
    const compact = page.events.find((e) => e.type === 'compaction/summary')!;
    expect((compact.data as any).shadowedMessageIds).toEqual(['u1', 'a1']);
    expect((compact.data as any).summary).toBe('sum');
  });

  it('context/stats：小轮次占用锚点原样返回（中断回合冷启动恢复）', async () => {
    const events: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turnId: 'T1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2, data: { messageId: 'u1', kind: 'user', blocks: [], metadata: {} } },
      {
        type: 'assistant/message',
        seq: 3,
        time: 3,
        data: { messageId: 'a1', content: [], metadata: { usage: { promptTokens: 100 } } },
      },
      {
        type: 'context/stats',
        seq: 4,
        time: 4,
        data: { turnId: 'T1', usedTokens: 120, effectiveContextWindow: 1000 },
      },
      // 流式中意外退出：没有 turn/finish
    ];
    const page = await createService(events).getEventPage('s1', { turns: 1 });
    expect(page.events.map((e) => e.type)).toEqual([
      'turn/start',
      'user/message',
      'assistant/message',
      'context/stats',
    ]);
    expect(page.endSeq).toBe(4);
    expect(page.hasMore).toBe(false);
  });

  it('N=1：页 = 最近 1 个有效回合起（T3），被删 TD 事件在区间内原样返回；nextBeforeSeq = 页首-1', async () => {
    const service = createService(makeEvents());
    const page = await service.getEventPage('s1', { turns: 1 });

    expect(page.hasMore).toBe(true);
    expect(page.nextBeforeSeq).toBe(12); // 页首 = T3 的 turn/start(seq13) - 1

    const turnIds = page.events
      .filter((e) => e.type === 'turn/start')
      .map((e) => (e.data as any).turnId);
    expect(turnIds).toEqual(['T3', 'TD']); // TD 的 turn/start 在区间内原样返回
    // 页内不含更早内容（T1/T2/compaction 均不在页内）
    expect(page.events.some((e) => e.type === 'compaction/summary')).toBe(false);
    expect(page.events.some((e) => (e.data as any).messageId === 'u1')).toBe(false);
    // 被删 TD 的 turn/delete 原样返回（前端消解）
    expect(page.events.some((e) => e.type === 'turn/delete' && (e.data as any).turnId === 'TD')).toBe(true);
  });

  it('beforeSeq 分页：从指定游标继续拉更早事件（load-more）', async () => {
    const service = createService(makeEvents());
    // 上一页 nextBeforeSeq=12 → 拉 seq<=12 的事件：T2 + compaction + T1
    const page = await service.getEventPage('s1', { beforeSeq: 12, turns: 2 });
    const turnIds = page.events
      .filter((e) => e.type === 'turn/start')
      .map((e) => (e.data as any).turnId);
    expect(turnIds).toEqual(['T1', 'T2']);
    expect(page.events.some((e) => e.type === 'compaction/summary')).toBe(true);
    expect(page.hasMore).toBe(false); // 页首 = seq1，无更早
    expect(page.nextBeforeSeq).toBeNull();
  });

  it('空会话：返回空页', async () => {
    const service = createService([]);
    const page = await service.getEventPage('s1', { turns: 30 });
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe('SessionReplayService 压缩历史聚合（getCompactionHistory）', () => {
  const service = (events: BaseEvent[]) => new SessionReplayService({ getAllEvents: async () => events } as any);

  it('摘要括号 → summarized 条目（beforeTokens 实测优先）；纯裁剪孤立 end → pruned_only 条目', async () => {
    const events: BaseEvent[] = [
      { type: 'turn/finish', seq: 1, time: 1000, data: { turnId: 'T1', usedTokens: 900 } },
      { type: 'compaction/start', seq: 2, time: 2000, data: {} },
      { type: 'compaction/summary', seq: 3, time: 3000, data: { shadowedEndId: 'm1', shadowedCount: 3, summary: 'sum1', summaryMessageId: 'sum_1' } },
      { type: 'compaction/end', seq: 4, time: 4000, data: { usedTokens: 500, effectiveContextWindow: 128000, beforeTokens: 900 } },
      // 纯裁剪：孤立 end（无 start/summary）
      { type: 'compaction/end', seq: 5, time: 5000, data: { usedTokens: 480, beforeTokens: 500 } },
    ];
    const { items, total } = await service(events).getCompactionHistory('s1');
    expect(total).toBe(2);
    // 倒序：最新在前
    expect(items[0].id).toBe('prune_5');
    expect(items[0].cleaningStrategy).toBe('pruned_only');
    expect(items[0].summaryContent).toBeNull();
    expect(items[0].compressionStats).toEqual({ beforeTokenCount: 500, afterTokenCount: 480 });
    expect(items[1].id).toBe('sum_1');
    expect(items[1].cleaningStrategy).toBe('summarized');
    expect(items[1].summaryContent).toBe('sum1');
    expect(items[1].shadowedCount).toBe(3);
    expect(items[1].compressionStats).toEqual({ beforeTokenCount: 900, afterTokenCount: 500 });
  });

  it('旧事件无 beforeTokens → before 回退上一占用锚点；DISABLED 空摘要 → discarded；limit 截断', async () => {
    const events: BaseEvent[] = [
      { type: 'turn/finish', seq: 1, time: 1000, data: { turnId: 'T1', usedTokens: 900 } },
      { type: 'compaction/start', seq: 2, time: 2000, data: {} },
      { type: 'compaction/summary', seq: 3, time: 3000, data: { shadowedEndId: 'm1', shadowedCount: 2, summary: 'sum1', summaryMessageId: 'sum_1' } },
      { type: 'compaction/end', seq: 4, time: 4000, data: { usedTokens: 500 } }, // 无 beforeTokens → 回退锚点 900
      { type: 'compaction/start', seq: 5, time: 5000, data: {} },
      { type: 'compaction/summary', seq: 6, time: 6000, data: { shadowedEndId: 'm2', shadowedCount: 1, summary: '', summaryMessageId: 'sum_2' } },
      { type: 'compaction/end', seq: 7, time: 7000, data: { usedTokens: 480 } }, // DISABLED 空摘要 → discarded
      // 未闭合括号（进行中的压缩）不产出条目
      { type: 'compaction/start', seq: 8, time: 8000, data: {} },
      { type: 'compaction/summary', seq: 9, time: 9000, data: { shadowedEndId: 'm3', shadowedCount: 1, summary: 'ing', summaryMessageId: 'sum_3' } },
    ];
    const { items, total } = await service(events).getCompactionHistory('s1');
    expect(total).toBe(2);
    expect(items[0].cleaningStrategy).toBe('discarded');
    expect(items[0].compressionStats).toEqual({ beforeTokenCount: 500, afterTokenCount: 480 });
    expect(items[1].compressionStats.beforeTokenCount).toBe(900); // 锚点回退
    // limit：最近 1 条
    const page = await service(events).getCompactionHistory('s1', 1);
    expect(page.items.length).toBe(1);
    expect(page.items[0].id).toBe('sum_2');
    expect(page.total).toBe(2);
  });

  it('异常终止回合无 turn/finish：before 回退使用 context/stats 小轮锚点', async () => {
    const events: BaseEvent[] = [
      { type: 'turn/start', seq: 1, time: 1000, data: { turnId: 'T1', kind: 'turn', metadata: {} } },
      { type: 'user/message', seq: 2, time: 2000, data: { messageId: 'u1', kind: 'user', blocks: [], metadata: {} } },
      {
        type: 'assistant/message',
        seq: 3,
        time: 3000,
        data: { messageId: 'a1', content: [], metadata: { usage: { promptTokens: 700 } } },
      },
      // 每次小轮次落盘的占用锚点（流式中意外退出，没有 turn/finish）
      {
        type: 'context/stats',
        seq: 4,
        time: 4000,
        data: { turnId: 'T1', usedTokens: 700, effectiveContextWindow: 128000 },
      },
      { type: 'compaction/start', seq: 5, time: 5000, data: {} },
      {
        type: 'compaction/summary',
        seq: 6,
        time: 6000,
        data: { shadowedEndId: 'm1', shadowedCount: 2, summary: 'sum1', summaryMessageId: 'sum_1' },
      },
      // 旧事件无 beforeTokens → 回退到 context/stats 的 700
      { type: 'compaction/end', seq: 7, time: 7000, data: { usedTokens: 300 } },
    ];
    const { items } = await service(events).getCompactionHistory('s1');
    expect(items).toHaveLength(1);
    expect(items[0].compressionStats).toEqual({
      beforeTokenCount: 700,
      afterTokenCount: 300,
    });
  });
});
