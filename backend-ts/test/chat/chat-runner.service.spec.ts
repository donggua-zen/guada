/**
 * ChatRunnerService 单元测试（supervisor 职责，直发模式下无事件消费）
 *
 * 引擎直发模式（sessionContext.publishStream）后，chat-runner 不再 for-await 消费事件，
 * 只 await run() 完成并做流生命周期收尾。本 spec 回归该收尾契约：
 * - 正常完成 → stopStream(completed) + running/completed 状态事件 + 队列自动消费
 * - finishReason=error → 不自动消费队列
 * - 引擎 reject → 兜底 publish error 事件 + stopStream(error) + error 状态事件
 * - 已有活跃流 → 409 SESSION_BUSY
 */
import { ChatRunnerService } from '../../src/modules/chat/chat-runner.service';

/// <reference types="jest" />

function buildRunner(overrides?: { runImpl?: () => Promise<any> }) {
  const streamManager = {
    hasActiveStream: jest.fn(() => false),
    startStream: jest.fn(() => true),
    publish: jest.fn(),
    stopStream: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    abortStream: jest.fn(),
  };
  const sessionService = {
    getSessionById: jest.fn(async () => ({ id: 's1', userId: 'u1' })),
    updateLastActiveAt: jest.fn(async () => {}),
  };
  const sessionContext = {
    sessionId: 's1',
    userId: 'u1',
    sessionType: 'web',
    workspacePath: '/tmp/ws',
  };
  const sessionContextFactory = {
    createFromSession: jest.fn(async () => sessionContext),
  };
  const agentEngine = {
    run: jest.fn(overrides?.runImpl ?? (async () => ({ finishReason: 'stop' }))),
  };
  const eventBus = { emit: jest.fn() };
  const bindingState = { detectAndBuildInjection: jest.fn(async () => []) };
  const service = new ChatRunnerService(
    streamManager as any,
    sessionService as any,
    agentEngine as any,
    sessionContextFactory as any,
    eventBus as any,
    bindingState as any,
  );
  // processQueue 为私有方法，测试只关心是否被触发（空队列实现无外部副作用）
  (service as any).processQueue = jest.fn(async () => {});
  return { service, streamManager, agentEngine, eventBus };
}

const startParams = {
  sessionId: 's1',
  userId: 'u1',
  userMessage: { id: 'm1', content: 'hi' } as any,
};

/** 排空微任务/ immediates：startStream 的后台 runAgentEngine 需要事件循环推进 */
async function flushAsync(times = 8) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function statusesOf(eventBus: { emit: jest.Mock }): string[] {
  return eventBus.emit.mock.calls
    .filter((c: any[]) => c[0] === 'stream.status_changed')
    .map((c: any[]) => c[1].payload.status);
}

describe('ChatRunnerService（supervisor：直发模式下的流生命周期收尾）', () => {
  it('正常完成 → stopStream(completed) + running/completed 状态事件 + 队列自动消费', async () => {
    const { service, streamManager, eventBus } = buildRunner();

    await service.startStream(startParams);
    await flushAsync();

    expect(streamManager.startStream).toHaveBeenCalledWith(
      's1',
      'u1',
      expect.any(AbortController),
    );
    expect(streamManager.stopStream).toHaveBeenCalledWith('s1', 'completed');
    expect(statusesOf(eventBus)).toEqual(['running', 'completed']);
    expect((service as any).processQueue).toHaveBeenCalledWith('s1');
  });

  it('finishReason=error → 流收尾但不自动消费队列', async () => {
    const { service, streamManager } = buildRunner({
      runImpl: async () => ({ finishReason: 'error' }),
    });

    await service.startStream(startParams);
    await flushAsync();

    expect(streamManager.stopStream).toHaveBeenCalledWith('s1', 'completed');
    expect((service as any).processQueue).not.toHaveBeenCalled();
  });

  it('引擎 reject → 兜底 publish error 事件 + stopStream(error) + error 状态事件', async () => {
    const { service, streamManager, eventBus } = buildRunner({
      runImpl: async () => {
        throw new Error('boom');
      },
    });

    await service.startStream(startParams);
    await flushAsync();

    expect(streamManager.publish).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ type: 'error' }),
    );
    expect(streamManager.stopStream).toHaveBeenCalledWith('s1', 'error');
    expect(statusesOf(eventBus)).toContain('error');
  });

  it('已有活跃流 → 409 SESSION_BUSY', async () => {
    const { service, streamManager } = buildRunner();
    (streamManager.hasActiveStream as jest.Mock).mockReturnValue(true);

    await expect(service.startStream(startParams)).rejects.toMatchObject({
      response: { code: 'SESSION_BUSY' },
    });
  });
});
