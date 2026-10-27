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

function buildRunner(overrides?: {
  runImpl?: () => Promise<any>;
  session?: any;
}) {
  const streamManager = {
    hasActiveStream: jest.fn(() => false),
    startStream: jest.fn(() => true),
    publish: jest.fn(),
    stopStream: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    abortStream: jest.fn(),
  };
  const sessionService = {
    getSessionById: jest.fn(async () => overrides?.session ?? { id: 's1' }),
    updateLastActiveAt: jest.fn(async () => {}),
  };
  const sessionContext = {
    sessionId: 's1',
    sessionType: 'web',
    workspacePath: '/tmp/ws',
  };
  const sessionContextFactory = {
    createFromSession: jest.fn(async (_session: any) => sessionContext),
  };
  const agentEngine = {
    run: jest.fn(overrides?.runImpl ?? (async () => ({ finishReason: 'stop' }))),
  };
  const eventBus = { emit: jest.fn() };
  const userInputQueue = {
    hasPending: jest.fn(() => false),
    hasAnyPending: jest.fn(() => false),
    getState: jest.fn(() => undefined),
    consumePromotion: jest.fn(() => null),
    resume: jest.fn(),
    pause: jest.fn(),
  };
  const service = new ChatRunnerService(
    streamManager as any,
    sessionService as any,
    agentEngine as any,
    sessionContextFactory as any,
    eventBus as any,
    userInputQueue as any,
  );
  // processQueue 为私有方法，测试只关心是否被触发（空队列实现无外部副作用）
  (service as any).processQueue = jest.fn(async () => {});
  return {
    service,
    streamManager,
    agentEngine,
    eventBus,
    sessionContextFactory,
  };
}

const startParams = {
  sessionId: 's1',
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
      expect.any(AbortController),
    );
    expect(streamManager.stopStream).toHaveBeenCalledWith('s1', 'completed');
    expect(statusesOf(eventBus)).toEqual(['running', 'completed']);
    expect((service as any).processQueue).toHaveBeenCalledWith('s1');
  });

  it('finishReason=error → 流收尾、不立即消费队列、进入有界重试', async () => {
    const { service, streamManager } = buildRunner({
      runImpl: async () => ({ finishReason: 'error' }),
    });
    const scheduleSpy = jest
      .spyOn(service as any, 'scheduleQueueRetry')
      .mockImplementation(() => {});

    await service.startStream(startParams);
    await flushAsync();

    expect(streamManager.stopStream).toHaveBeenCalledWith('s1', 'completed');
    expect((service as any).processQueue).not.toHaveBeenCalled();
    expect(scheduleSpy).toHaveBeenCalledWith('s1', 'error');
  });

  it('finishReason=user_cancel → 不自动重开 turn（只交给 scheduleQueueRetry 决定）', async () => {
    const { service } = buildRunner({
      runImpl: async () => ({ finishReason: 'user_cancel' }),
    });
    const scheduleSpy = jest
      .spyOn(service as any, 'scheduleQueueRetry')
      .mockImplementation(() => {});

    await service.startStream(startParams);
    await flushAsync();

    expect((service as any).processQueue).not.toHaveBeenCalled();
    expect(scheduleSpy).toHaveBeenCalledWith('s1', 'user_cancel');
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

  describe('非正常收尾的队列重试策略', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('error 有 pending 通知 → 1s 后重试一次', async () => {
      const { service } = buildRunner();
      (service as any).queues.set('s1', {
        items: [{}],
        isProcessing: false,
      });

      jest.useFakeTimers();
      (service as any).scheduleQueueRetry('s1', 'error');

      expect((service as any).queueRetryTimers.has('s1')).toBe(true);
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();

      expect((service as any).processQueue).toHaveBeenCalledWith('s1');
      expect((service as any).queueRetryAttempts.get('s1')).toBe(1);
      (service as any).clearQueueRetry('s1');
    });

    it('user_cancel 有 pending 通知 → 不创建重试 timer', () => {
      const { service } = buildRunner();
      (service as any).queues.set('s1', {
        items: [{}],
        isProcessing: false,
      });

      (service as any).scheduleQueueRetry('s1', 'user_cancel');

      expect((service as any).queueRetryTimers.has('s1')).toBe(false);
      expect((service as any).queueRetryAttempts.get('s1')).toBeUndefined();
    });

    it('重试次数有上限', () => {
      const { service } = buildRunner();
      (service as any).queues.set('s1', {
        items: [{}],
        isProcessing: false,
      });

      jest.useFakeTimers();
      (service as any).queueRetryAttempts.set('s1', 3);
      (service as any).scheduleQueueRetry('s1', 'timeout');

      expect((service as any).queueRetryTimers.has('s1')).toBe(false);
    });
  });

  describe('合并批次 callbacks', () => {
    function makeItem(id: string, callbacks: any) {
      return {
        id,
        sessionId: 's1',
        blocks: [{ type: 'text', text: id }],
        source: { kind: 'scheduler', schedulerId: id },
        createdAt: new Date(),
        callbacks,
        onConsumed: jest.fn(),
      };
    }

    it('合并批次 fan-out 所有 callbacks，onConsumed 全部执行', async () => {
      const { service } = buildRunner();
      const cb1 = {
        onEvent: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };
      const cb2 = {
        onEvent: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };
      const items = [makeItem('a', cb1), makeItem('b', cb2)];

      (service as any).startStream = jest.fn(
        async (_params: any, callbacks: any) => {
          callbacks?.onEvent?.({ type: 'text_delta', text: 'x' });
          callbacks?.onComplete?.('completed');
          return () => {};
        },
      );

      await (service as any).executeQueueItem(items);

      for (const cb of [cb1, cb2]) {
        expect(cb.onEvent).toHaveBeenCalledWith({ type: 'text_delta', text: 'x' });
        expect(cb.onComplete).toHaveBeenCalledWith('completed');
        expect(cb.onError).not.toHaveBeenCalled();
      }
      expect(items[0].onConsumed).toHaveBeenCalledTimes(1);
      expect(items[1].onConsumed).toHaveBeenCalledTimes(1);
    });

    it('非 busy 失败：逐条 onError 后再逐条 onConsumed', async () => {
      const { service } = buildRunner();
      const error = new Error('boom');
      const cb1 = {
        onEvent: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };
      const cb2 = {
        onEvent: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };
      const items = [makeItem('a', cb1), makeItem('b', cb2)];

      (service as any).startStream = jest.fn(async () => {
        throw error;
      });

      await (service as any).executeQueueItem(items);

      for (const cb of [cb1, cb2]) {
        expect(cb.onError).toHaveBeenCalledWith(error);
        expect(cb.onComplete).not.toHaveBeenCalled();
      }
      expect(items[0].onConsumed).toHaveBeenCalledTimes(1);
      expect(items[1].onConsumed).toHaveBeenCalledTimes(1);
    });
  });

  describe('回合级设置覆盖（排队消息补发）', () => {
    const baseSession = () => ({
      id: 's1',
      modelId: 'prov-a:model-a',
      model: { id: 'prov-a:model-a', modelName: 'model-a' },
      settings: {
        sandboxMode: 'workspace-write',
        thinkingEffort: 'medium',
        maxTokensLimit: 1000,
        planEnabled: false,
      },
    });

    it('覆盖合并到克隆对象：原会话不被修改，model 挂载被清空', async () => {
      const session = baseSession();
      const { service, sessionContextFactory } = buildRunner({ session });

      await service.startStream({
        ...startParams,
        settingsOverride: {
          modelId: 'prov-b:model-b',
          thinkingEffort: 'high',
          maxTokensLimit: 2000,
          sandboxMode: 'danger-full-access',
        },
      });

      const effective = sessionContextFactory.createFromSession.mock.calls[0][0];
      expect(effective).not.toBe(session);
      expect(effective.modelId).toBe('prov-b:model-b');
      // resolveModel 优先 session.model，覆盖时必须清掉
      expect(effective.model).toBeUndefined();
      expect(effective.settings).toMatchObject({
        thinkingEffort: 'high',
        maxTokensLimit: 2000,
        sandboxMode: 'danger-full-access',
      });

      // 原对象保持原值（覆盖不得落回会话）
      expect(session.modelId).toBe('prov-a:model-a');
      expect(session.model).toEqual({ id: 'prov-a:model-a', modelName: 'model-a' });
      expect(session.settings).toEqual({
        sandboxMode: 'workspace-write',
        thinkingEffort: 'medium',
        maxTokensLimit: 1000,
        planEnabled: false,
      });
    });

    it('planEnabled 覆盖时预置临时 epoch，避免 initialize() 把覆盖写回会话', async () => {
      const session = baseSession();
      const { service, sessionContextFactory } = buildRunner({ session });

      await service.startStream({
        ...startParams,
        settingsOverride: { planEnabled: true },
      });

      const effective = sessionContextFactory.createFromSession.mock.calls[0][0];
      expect(effective.settings.planEnabled).toBe(true);
      expect(typeof effective.settings.planModeEpoch).toBe('string');
      expect(effective.settings.planModeEpoch.length).toBeGreaterThan(0);
      // 原会话仍无 epoch、plan 仍关闭
      expect(session.settings.planEnabled).toBe(false);
      expect((session.settings as any).planModeEpoch).toBeUndefined();
    });

    it('未传覆盖时直接使用原会话对象', async () => {
      const session = baseSession();
      const { service, sessionContextFactory } = buildRunner({ session });

      await service.startStream(startParams);

      expect(sessionContextFactory.createFromSession.mock.calls[0][0]).toBe(session);
    });
  });
});
