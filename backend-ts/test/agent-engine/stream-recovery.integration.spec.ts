/// <reference types="jest" />

/**
 * Adapter → AgentEngine 的端到端流恢复回归。
 *
 * 用真实 OpenAIResponseAdapter 生成 StreamChunk，验证 response.failed
 * 不再被合成 finish{error} 静默收尾，而是走 Core Stream Recovery：
 * 丢弃半截正文、发 retry、重新请求并成功。
 */
import { AgentEngine } from '../../src/modules/chat/agent-engine.service';
import { OpenAIResponseAdapter } from '../../src/modules/llm-core/adapters/openai-response.adapter';
import { createAllMocks } from './helpers/mock-factories';

jest.mock('../../src/modules/llm-core/utils/retry-on-error.util', () => {
  const actual = jest.requireActual(
    '../../src/modules/llm-core/utils/retry-on-error.util',
  );
  return {
    ...actual,
    computeRetryDelayMs: () => 0,
    retrySleep: async () => undefined,
  };
});

async function* eventStream(events: any[]): AsyncGenerator<any> {
  for (const event of events) yield event;
}

describe('stream recovery integration', () => {
  it('response.failed（可见正文）→ 丢弃半截并恢复成功', async () => {
    const adapter = new OpenAIResponseAdapter({} as any);
    let calls = 0;

    const mocks = createAllMocks({});
    (mocks.llmService as any).completions = jest.fn(() => {
      calls += 1;
      if (calls === 1) {
        return (adapter as any).handleStreamResponse(
          eventStream([
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: 'msg_1' },
            },
            {
              type: 'response.output_text.delta',
              item_id: 'msg_1',
              output_index: 0,
              delta: '半截正文',
            },
            {
              type: 'response.failed',
              response: {
                id: 'resp_failed',
                status: 'failed',
                error: {
                  code: 'server_error',
                  message: 'upstream timeout',
                  type: 'server_error',
                },
              },
            },
          ]),
        );
      }
      return (adapter as any).handleStreamResponse(
        eventStream([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'msg_2' },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'msg_2',
            output_index: 0,
            delta: '恢复后的回答',
          },
          {
            type: 'response.output_text.done',
            item_id: 'msg_2',
            output_index: 0,
            text: '恢复后的回答',
          },
          {
            type: 'response.completed',
            response: {
              output: [],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            },
          },
        ]),
      );
    });

    const engine = new AgentEngine(
      mocks.toolExecutor as any,
      mocks.llmService as any,
      {
        serial: jest.fn(
          async (_e: string, _p: unknown, fallback: () => unknown) =>
            fallback(),
        ),
        parallel: jest.fn(async () => []),
      } as any,
    );

    await engine.run(mocks.sessionContext, { id: 'msg-001' });

    const events = mocks.publishedEvents;
    expect(calls).toBe(2);
    expect(events.find((e) => e.type === 'turn_end')?.finishReason).toBe(
      'stop',
    );
    expect(
      events.some(
        (e) =>
          e.type === 'retry' &&
          (e as any).retrySource === 'stream_recovery' &&
          (e as any).retryAttempt === 1 &&
          (e as any).failedRequestId === 'resp_failed',
      ),
    ).toBe(true);

    const appended = (
      mocks.sessionContext.appendMessages as jest.Mock
    ).mock.calls.flatMap((c: any[]) => c[0]);
    const discarded = appended.find(
      (m: any) =>
        m.role === 'assistant' &&
        m.metadata?.excludedFromContext === true &&
        m.content?.some((b: any) => b.text === '半截正文'),
    );
    expect(discarded).toBeTruthy();
    expect(discarded.metadata.error?.name).toBe('StreamRecoveryDiscarded');
    expect(
      appended.some(
        (m: any) =>
          m.role === 'assistant' &&
          m.metadata?.excludedFromContext !== true &&
          m.content?.some((b: any) => b.text === '恢复后的回答'),
      ),
    ).toBe(true);
  });
});

describe('stream recovery continuation integration', () => {
  it('纯文本且正文超阈值 → 保留正文 + 隐藏续写提示，不丢弃', async () => {
    const adapter = new OpenAIResponseAdapter({} as any);
    let calls = 0;
    // 超过 STREAM_FAILURE_CONTINUATION_MIN_CHARS(800) 的已输出正文
    const longText = '甲'.repeat(1000);

    const mocks = createAllMocks({});
    (mocks.llmService as any).completions = jest.fn(() => {
      calls += 1;
      if (calls === 1) {
        return (adapter as any).handleStreamResponse(
          eventStream([
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: 'msg_1' },
            },
            {
              type: 'response.output_text.delta',
              item_id: 'msg_1',
              output_index: 0,
              delta: longText,
            },
            {
              type: 'response.failed',
              response: {
                status: 'failed',
                error: {
                  code: 'server_error',
                  message: 'upstream stream interrupted',
                  type: 'server_error',
                },
              },
            },
          ]),
        );
      }
      return (adapter as any).handleStreamResponse(
        eventStream([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'msg_2' },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'msg_2',
            output_index: 0,
            delta: '续写完成',
          },
          {
            type: 'response.completed',
            response: {
              output: [],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            },
          },
        ]),
      );
    });

    const engine = new AgentEngine(
      mocks.toolExecutor as any,
      mocks.llmService as any,
      {
        serial: jest.fn(
          async (_e: string, _p: unknown, fallback: () => unknown) =>
            fallback(),
        ),
        parallel: jest.fn(async () => []),
      } as any,
    );

    await engine.run(mocks.sessionContext, { id: 'msg-cont-1' });

    const events = mocks.publishedEvents;
    expect(calls).toBe(2);
    expect(events.find((e) => e.type === 'turn_end')?.finishReason).toBe('stop');
    expect(
      events.some(
        (e) =>
          e.type === 'retry' &&
          (e as any).retrySource === 'stream_recovery' &&
          (e as any).retryAttempt === 1 &&
          String((e as any).message).includes('继续生成 1/3'),
      ),
    ).toBe(true);

    const appended = (
      mocks.sessionContext.appendMessages as jest.Mock
    ).mock.calls.flatMap((c: any[]) => c[0]);
    // 半截正文保留为正常消息（进上下文），不是 discarded
    const kept = appended.find(
      (m: any) =>
        m.role === 'assistant' &&
        m.content?.some((b: any) => b.text === longText),
    );
    expect(kept).toBeTruthy();
    expect(kept.metadata?.excludedFromContext).not.toBe(true);
    expect(kept.metadata?.finishReason).toBe('stream_interrupted');
    expect(kept.metadata?.streamContinuation?.attempt).toBe(1);
    // 隐藏续写提示
    expect(
      appended.some(
        (m: any) =>
          m.role === 'user' &&
          m.metadata?.hidden === true &&
          m.metadata?.queryScope === 'stream_failure_continuation',
      ),
    ).toBe(true);
    // 不应存在 discarded 的 assistant
    expect(
      appended.some(
        (m: any) =>
          m.role === 'assistant' && m.metadata?.excludedFromContext === true,
      ),
    ).toBe(false);
  });
});

describe('stream recovery continuation exhausted', () => {
  it('连续 3 次续写后仍断流 → 保留正文，以错误结束', async () => {
    const adapter = new OpenAIResponseAdapter({} as any);
    let calls = 0;
    const longText = '乙'.repeat(1000);

    const mocks = createAllMocks({});
    (mocks.llmService as any).completions = jest.fn(() => {
      calls += 1;
      const id = `msg_fail_${calls}`;
      return (adapter as any).handleStreamResponse(
        eventStream([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id },
          },
          {
            type: 'response.output_text.delta',
            item_id: id,
            output_index: 0,
            delta: longText,
          },
          {
            type: 'response.failed',
            response: {
              status: 'failed',
              error: {
                code: 'server_error',
                message: 'upstream stream interrupted',
                type: 'server_error',
              },
            },
          },
        ]),
      );
    });

    const engine = new AgentEngine(
      mocks.toolExecutor as any,
      mocks.llmService as any,
      {
        serial: jest.fn(
          async (_e: string, _p: unknown, fallback: () => unknown) =>
            fallback(),
        ),
        parallel: jest.fn(async () => []),
      } as any,
    );

    await engine.run(mocks.sessionContext, { id: 'msg-cont-exhausted' });

    const events = mocks.publishedEvents;
    // 首次请求 + 3 次续写
    expect(calls).toBe(4);
    expect(events.find((e) => e.type === 'turn_end')?.finishReason).toBe(
      'network_error',
    );
    const retries = events.filter(
      (e) =>
        e.type === 'retry' && (e as any).retrySource === 'stream_recovery',
    );
    expect(retries).toHaveLength(3);
    expect(retries.map((e) => (e as any).retryAttempt)).toEqual([1, 2, 3]);

    const appended = (
      mocks.sessionContext.appendMessages as jest.Mock
    ).mock.calls.flatMap((c: any[]) => c[0]);
    const assistants = appended.filter((m: any) => m.role === 'assistant');
    // 4 段正文全部保留（不是 discarded）
    expect(assistants).toHaveLength(4);
    expect(
      assistants.every(
        (m: any) => m.metadata?.excludedFromContext !== true,
      ),
    ).toBe(true);
    // 最后一段标 exhausted
    expect(assistants[3].metadata?.streamContinuation?.exhausted).toBe(true);
  });
});
