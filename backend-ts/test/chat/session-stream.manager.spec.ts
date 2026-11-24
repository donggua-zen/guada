/// <reference types="jest" />

import { SessionStreamManager, StreamEvent } from '../../src/modules/chat/session-stream.manager';

// ─── 事件构造辅助 ───

function chunkEvent(partial: Partial<StreamEvent> & { type: StreamEvent['type'] }): StreamEvent {
  return { logSeq: 0, ...partial } as StreamEvent;
}

function startStream(mgr: SessionStreamManager, sessionId = 's1'): void {
  expect(mgr.startStream(sessionId, new AbortController())).toBe(true);
}

// ─── 用例 ───

describe('SessionStreamManager publish（唯一发布入口）', () => {
  let mgr: SessionStreamManager;

  beforeEach(() => {
    mgr = new SessionStreamManager();
  });

  it('publish：eventBuffer 入缓存 + relay 直投', () => {
    startStream(mgr, 's1');
    const relay = jest.fn();
    mgr.setStreamRelay(relay);

    mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: '你好' }));

    // 进程内可见状态：缓冲 + 状态查询
    expect(mgr.getStreamStatus('s1')?.bufferedEventCount).toBe(1);
    // 直投：单账户，无需用户维度
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay).toHaveBeenCalledWith('s1', expect.objectContaining({ type: 'text_delta' }));
  });

  it('publish：扇出到进程内订阅者（bot/子 Agent 回调路径）', () => {
    startStream(mgr);
    const received: StreamEvent[] = [];
    mgr.subscribe('s1', 'bot', (e) => received.push(e), () => {}, () => {});

    mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'hi' }));

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('text_delta');
  });

  it('publish：relay 未注册不报错（SSE 通道不可用时进程内路径仍工作）', () => {
    startStream(mgr);
    expect(() => mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'x' }))).not.toThrow();
  });

  it('publish：无活跃流时静默丢弃（与降级 RPC 后的会话外事件容忍一致）', () => {
    const relay = jest.fn();
    mgr.setStreamRelay(relay);

    mgr.publish('s-not-started', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'x' }));
    // stopStream 后同样丢弃
    startStream(mgr, 's2');
    mgr.stopStream('s2', 'completed');
    mgr.publish('s2', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'x' }));

    expect(relay).not.toHaveBeenCalled();
  });

  it('publish：finish 聚合清理——中间增量出缓冲，block_end/finish 保留', () => {
    startStream(mgr);
    mgr.setStreamRelay(jest.fn());

    // 4 个事件入缓冲；finish 触发清理移除 block_start/text_delta → 剩 block_end/finish
    mgr.publish('s1', chunkEvent({ type: 'block_start', messageId: 'm1', blockType: 'text' } as any));
    mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'a' }));
    mgr.publish('s1', chunkEvent({ type: 'block_end', messageId: 'm1' } as any));
    mgr.publish('s1', chunkEvent({ type: 'finish', messageId: 'm1' } as any));

    expect(mgr.getStreamStatus('s1')?.bufferedEventCount).toBe(2);
  });

  it('publish：eventBuffer 上限裁剪（滚动窗口）', () => {
    startStream(mgr);
    // DEFAULT_MAX_BUFFER_SIZE = 2000（私有常量，按行为断言：多推后 buffer 数被钳制）
    for (let i = 0; i < 2010; i++) {
      mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: String(i) }));
    }
    expect(mgr.getStreamStatus('s1')?.bufferedEventCount).toBeLessThanOrEqual(2000);
  });
});

describe('SessionStreamManager 最后入库 seq（终态墓碑用）', () => {
  let mgr: SessionStreamManager;

  beforeEach(() => {
    mgr = new SessionStreamManager();
  });

  it('publish 取 logSeq 最大值；缺失/非数字忽略，落后值不回退', () => {
    startStream(mgr, 's1');
    expect(mgr.getLastPersistedSeq('s1')).toBeNull();

    mgr.publish('s1', chunkEvent({ type: 'text_delta', messageId: 'm1', text: 'a' })); // logSeq 0
    expect(mgr.getLastPersistedSeq('s1')).toBe(0);

    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'b', logSeq: 7 } as StreamEvent);
    expect(mgr.getLastPersistedSeq('s1')).toBe(7);

    // 落后的 logSeq 不回退（并发 publish 可能读到同一入库游标）
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'c', logSeq: 3 } as StreamEvent);
    expect(mgr.getLastPersistedSeq('s1')).toBe(7);

    // 运行时帧可能没有 logSeq（如 chat-runner 的裸 error 帧）
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'd', logSeq: undefined } as StreamEvent);
    expect(mgr.getLastPersistedSeq('s1')).toBe(7);
  });

  it('stopStream 后保留（下一回合在同一水位上继续单调）', () => {
    startStream(mgr, 's1');
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'a', logSeq: 5 } as StreamEvent);
    mgr.stopStream('s1', 'completed');
    expect(mgr.getLastPersistedSeq('s1')).toBe(5);
  });
});

describe('SessionStreamManager 在飞尾部（带内 snapshot 用）', () => {
  let mgr: SessionStreamManager;

  beforeEach(() => {
    mgr = new SessionStreamManager();
  });

  it('无活跃流 → 空数组', () => {
    expect(mgr.getInFlightTail('s1')).toEqual([]);
  });

  it('只取最后一个 checkpoint 之后的帧', () => {
    startStream(mgr, 's1');
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'old' } as StreamEvent);
    mgr.publish('s1', { type: 'finish', messageId: 'm1' } as StreamEvent);
    mgr.publish('s1', { type: 'turn_start', turnId: 't2' } as StreamEvent);
    mgr.publish('s1', { type: 'text_delta', messageId: 'm2', text: 'new' } as StreamEvent);

    // finish 本身代表该段落已落盘，不重放
    expect(mgr.getInFlightTail('s1').map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
    ]);
  });

  it('找不到 checkpoint → 返回整个 buffer（避免放弃在飞内容）', () => {
    startStream(mgr, 's1');
    mgr.publish('s1', { type: 'turn_start', turnId: 't1' } as StreamEvent);
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'x' } as StreamEvent);

    expect(mgr.getInFlightTail('s1').map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
    ]);
  });

  it('返回副本：跨异步读页期间不被后续 publish 修改', () => {
    startStream(mgr, 's1');
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'a' } as StreamEvent);

    const tail = mgr.getInFlightTail('s1');
    mgr.publish('s1', { type: 'text_delta', messageId: 'm1', text: 'b' } as StreamEvent);

    expect(tail).toHaveLength(1);
  });
});
