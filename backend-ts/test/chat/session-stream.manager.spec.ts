/// <reference types="jest" />

import { SessionStreamManager, StreamEvent } from '../../src/modules/chat/session-stream.manager';

// ─── 事件构造辅助 ───

function chunkEvent(partial: Partial<StreamEvent> & { type: StreamEvent['type'] }): StreamEvent {
  return { prevSeq: 0, ...partial } as StreamEvent;
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
