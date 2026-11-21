/**
 * 四协议流终止/工具完整性契约回归。
 *
 * 目标：正常终止必须 finalize 工具并给 argumentsComplete=true；
 * 提前结束必须抛 UpstreamStreamTruncatedError 且工具块 argumentsComplete=false；
 * 各协议的输出上限统一归一化为 finishReason=length。
 */
import { OpenAIAdapter } from '../../src/modules/llm-core/adapters/openai.adapter';
import { AnthropicAdapter } from '../../src/modules/llm-core/adapters/anthropic.adapter';
import { GeminiAdapter } from '../../src/modules/llm-core/adapters/gemini.adapter';
import { UpstreamStreamTruncatedError } from '../../src/modules/llm-core/utils/upstream-errors';

function capabilityStub() {
  return {
    resolveThinkingWireValue: () => undefined,
    resolveThinkingOff: () => ({ supported: true }),
  } as any;
}

async function* stream<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(gen: AsyncGenerator<any>): Promise<{
  chunks: any[];
  error?: Error;
}> {
  const chunks: any[] = [];
  try {
    for await (const chunk of gen) chunks.push(chunk);
  } catch (error) {
    return { chunks, error: error as Error };
  }
  return { chunks };
}

function toolEnds(chunks: any[]): any[] {
  return chunks
    .filter((c) => c.type === 'block_end' && c.block?.type === 'tool-call')
    .map((c) => c.block);
}

describe('Chat Completions 终止契约', () => {
  it('收到 finish_reason：工具参数 finalize=true，length 原样保留', async () => {
    const adapter = new OpenAIAdapter(capabilityStub());
    const { chunks, error } = await collect(
      (adapter as any).handleStreamResponse(
        stream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: { name: 'read', arguments: '{"path":"a"}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ]),
      ),
    );

    expect(error).toBeUndefined();
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(true);
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe(
      'length',
    );
  });

  it('没有 finish_reason：抛截断，工具参数 false', async () => {
    const adapter = new OpenAIAdapter(capabilityStub());
    const { chunks, error } = await collect(
      (adapter as any).handleStreamResponse(
        stream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: { name: 'read', arguments: '{"path"' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
        ]),
      ),
    );

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(false);
  });
});

describe('Anthropic 终止契约', () => {
  it('message_delta(max_tokens) → length；content_block_stop 工具 complete=true', async () => {
    const adapter = new AnthropicAdapter();
    const { chunks, error } = await collect(
      (adapter as any).handleStreamResponse(
        stream([
          { type: 'message_start', message: { usage: { input_tokens: 1 } } },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tool_1', name: 'read' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'max_tokens' },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ]),
      ),
    );

    expect(error).toBeUndefined();
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(true);
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe(
      'length',
    );
  });

  it('没有 message_delta：抛截断，未闭合工具 false', async () => {
    const adapter = new AnthropicAdapter();
    const { chunks, error } = await collect(
      (adapter as any).handleStreamResponse(
        stream([
          { type: 'message_start', message: { usage: { input_tokens: 1 } } },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tool_1', name: 'read' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"path"' },
          },
        ]),
      ),
    );

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(false);
  });
});

describe('Gemini 终止契约', () => {
  function geminiChunk(input: {
    text?: string;
    calls?: any[];
    finishReason?: string;
  }) {
    return {
      text: () => input.text ?? '',
      functionCalls: () => input.calls,
      candidates: input.finishReason
        ? [{ finishReason: input.finishReason }]
        : undefined,
    };
  }

  it('MAX_TOKENS → length；functionCall complete=true', async () => {
    const adapter = new GeminiAdapter();
    const { chunks, error } = await collect(
      (adapter as any).handleGeminiStream({
        stream: stream([
          geminiChunk({
            calls: [{ name: 'read', args: { path: 'a' } }],
            finishReason: 'MAX_TOKENS',
          }),
        ]),
        response: Promise.resolve({}),
      }),
    );

    expect(error).toBeUndefined();
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(true);
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe(
      'length',
    );
  });

  it('流和聚合结果都没有 finishReason：抛截断', async () => {
    const adapter = new GeminiAdapter();
    const { chunks, error } = await collect(
      (adapter as any).handleGeminiStream({
        stream: stream([
          geminiChunk({
            text: '写到一半',
            calls: [{ name: 'read', args: { path: 'a' } }],
          }),
        ]),
        response: Promise.resolve({ candidates: [{}] }),
      }),
    );

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(false);
  });
});
