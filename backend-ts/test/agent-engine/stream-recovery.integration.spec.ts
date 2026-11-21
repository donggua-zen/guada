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
