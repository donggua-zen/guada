/**
 * OpenAI Chat 流式 usage 尾块回归测试。
 *
 * 背景：OpenAI 的 stream_options.include_usage 尾块是 choices:[]，usage 在 chunk 顶层；
 * 旧实现先 `if (!choice) continue`，导致该尾块被跳过、客户端永远统计不到 token。
 */
import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';

function makeCapabilityStub() {
  return {
    resolveThinkingWireValue: () => undefined,
    resolveThinkingOff: () => ({ supported: true }),
  } as any;
}

async function* stream(chunks: any[]): AsyncGenerator<any> {
  for (const chunk of chunks) yield chunk;
}

describe('OpenAIAdapter 流式 usage', () => {
  it('读取空 choices 的 usage 尾块并产出 usage chunk', async () => {
    const adapter = new OpenAIAdapter(makeCapabilityStub());
    const generator = (adapter as any).handleStreamResponse(
      stream([
        { choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
            prompt_tokens_details: { cached_tokens: 7 },
          },
        },
      ]),
    );
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);

    const usage = chunks.find((c) => c.type === 'usage')?.usage;
    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedTokens: { read: 7 },
    });
    const finish = chunks.find((c) => c.type === 'finish');
    expect(finish).toBeDefined();
  });
});
