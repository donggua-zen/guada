/**
 * OpenAI Responses 流式工具参数回归测试。
 *
 * 背景：GPT6 并发多工具调用时客户端拿到成批 `arguments: "{}"`。根因是适配器
 * 只累计 `response.function_call_arguments.delta`，忽略了标准事件
 * `function_call_arguments.done` / `output_item.done.item.arguments` /
 * `response.completed.response.output[]`，且 delta 早于 added 时被静默丢弃。
 *
 * 这些用例直接驱动私有的 handleStreamResponse，断言最终 block_end 里的
 * tool-call 参数，不依赖网络。
 */
import { OpenAIResponseAdapter } from '../../src/modules/llm-core/adapters/openai-response.adapter';
import {
  UpstreamResponseFailedError,
  UpstreamStreamTruncatedError,
} from '../../src/modules/llm-core/utils/upstream-errors';

function makeCapabilityStub() {
  return {} as any;
}

async function* stream(events: any[]): AsyncGenerator<any> {
  for (const event of events) yield event;
}

async function run(events: any[]): Promise<any[]> {
  const adapter = new OpenAIResponseAdapter(makeCapabilityStub());
  const chunks: any[] = [];
  for await (const chunk of (adapter as any).handleStreamResponse(stream(events))) {
    chunks.push(chunk);
  }
  return chunks;
}

/** 跑完（允许抛错），返回已产出的 chunk 与错误 */
async function runCollecting(
  events: any[],
  abortSignal?: AbortSignal,
): Promise<{ chunks: any[]; error?: Error }> {
  const adapter = new OpenAIResponseAdapter(makeCapabilityStub());
  const chunks: any[] = [];
  try {
    for await (const chunk of (adapter as any).handleStreamResponse(
      stream(events),
      abortSignal,
    )) {
      chunks.push(chunk);
    }
  } catch (error) {
    return { chunks, error: error as Error };
  }
  return { chunks };
}

function added(outputIndex: number, item: Record<string, any>) {
  return {
    type: 'response.output_item.added',
    output_index: outputIndex,
    item: { type: 'function_call', ...item },
  };
}

function completed(output: any[] = [], usage?: any) {
  return {
    type: 'response.completed',
    response: { output, ...(usage ? { usage } : {}) },
  };
}

function toolEnds(chunks: any[]): any[] {
  return chunks
    .filter((c) => c.type === 'block_end' && c.block?.type === 'tool-call')
    .map((c) => c.block);
}

function byCallId(blocks: any[]): Map<string, any> {
  return new Map(blocks.map((b) => [b.toolCallId, b]));
}

describe('OpenAIResponseAdapter 流式工具参数', () => {
  it('复现 GPT6 真实序列：无 delta，参数同时在 done/output_item.done/completed', async () => {
    const args = {
      call_0: '{"pattern":"**/*.ts"}',
      call_1: '{"file_path":"src/main.ts"}',
      call_2: '{"command":"git status"}',
    };
    const items = [
      { id: 'item_0', call_id: 'call_0', name: 'glob' },
      { id: 'item_1', call_id: 'call_1', name: 'read' },
      { id: 'item_2', call_id: 'call_2', name: 'run_command' },
    ];
    const chunks = await run([
      ...items.map((item, i) => added(i, item)),
      ...items.map((item, i) => ({
        type: 'response.function_call_arguments.done',
        item_id: item.id,
        output_index: i,
        arguments: args[item.call_id],
      })),
      ...items.map((item, i) => ({
        type: 'response.output_item.done',
        output_index: i,
        item: { type: 'function_call', ...item, arguments: args[item.call_id] },
      })),
      completed(
        items.map((item) => ({
          type: 'function_call',
          ...item,
          arguments: args[item.call_id],
        })),
      ),
    ]);

    const blocks = toolEnds(chunks);
    expect(blocks).toHaveLength(3);
    const map = byCallId(blocks);
    for (const item of items) {
      expect(JSON.parse(map.get(item.call_id).arguments)).toEqual(
        JSON.parse(args[item.call_id]),
      );
    }
  });

  it('message/reasoning 的 output_item.done 不能被当成工具', async () => {
    const chunks = await run([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '马上调用。',
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: '马上调用。' }],
        },
      },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: { type: 'reasoning', id: 'rs_1', summary: [] },
      },
      added(2, { id: 'item_a', call_id: 'call_a', name: 'glob' }),
      {
        type: 'response.output_item.done',
        output_index: 2,
        item: {
          type: 'function_call',
          id: 'item_a',
          call_id: 'call_a',
          name: 'glob',
          arguments: '{"pattern":"*.ts"}',
        },
      },
      completed([
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: '马上调用。' }],
        },
        { type: 'reasoning', id: 'rs_1', summary: [] },
        {
          type: 'function_call',
          id: 'item_a',
          call_id: 'call_a',
          name: 'glob',
          arguments: '{"pattern":"*.ts"}',
        },
      ]),
    ]);

    const blocks = toolEnds(chunks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe('call_a');
    expect(JSON.parse(blocks[0].arguments)).toEqual({ pattern: '*.ts' });
  });

  it('并发三工具：参数只在 function_call_arguments.done 时也完整落块', async () => {
    const args = {
      item_0: { pattern: '**/*.ts' },
      item_1: { file_path: 'src/main.ts' },
      item_2: { command: 'npm test' },
    };
    const chunks = await run([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      added(1, { id: 'item_1', call_id: 'call_1', name: 'read' }),
      added(2, { id: 'item_2', call_id: 'call_2', name: 'run_command' }),
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: JSON.stringify(args.item_0),
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_1',
        output_index: 1,
        arguments: JSON.stringify(args.item_1),
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_2',
        output_index: 2,
        arguments: JSON.stringify(args.item_2),
      },
      completed(),
    ]);

    const blocks = toolEnds(chunks);
    expect(blocks).toHaveLength(3);
    const map = byCallId(blocks);
    expect(JSON.parse(map.get('call_0').arguments)).toEqual(args.item_0);
    expect(JSON.parse(map.get('call_1').arguments)).toEqual(args.item_1);
    expect(JSON.parse(map.get('call_2').arguments)).toEqual(args.item_2);
  });

  it('参数只在 output_item.done.item.arguments 时也完整落块', async () => {
    const chunks = await run([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      added(1, { id: 'item_1', call_id: 'call_1', name: 'read' }),
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'glob',
          arguments: '{"pattern":"*.go"}',
        },
      },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: {
          type: 'function_call',
          id: 'item_1',
          call_id: 'call_1',
          name: 'read',
          arguments: '{"file_path":"main.go"}',
        },
      },
      completed(),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: '*.go' });
    expect(JSON.parse(map.get('call_1').arguments)).toEqual({ file_path: 'main.go' });
  });

  it('参数只在 response.completed.response.output[] 时也能补建工具块', async () => {
    const chunks = await run([
      completed([
        {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'glob',
          arguments: '{"pattern":"*.md"}',
        },
        {
          type: 'function_call',
          id: 'item_1',
          call_id: 'call_1',
          name: 'read',
          arguments: '{"file_path":"README.md"}',
        },
      ]),
    ]);

    const blocks = toolEnds(chunks);
    expect(blocks).toHaveLength(2);
    const map = byCallId(blocks);
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: '*.md' });
    expect(JSON.parse(map.get('call_1').arguments)).toEqual({ file_path: 'README.md' });
  });

  it('delta 早于 output_item.added 时缓存并在 added 后回放', async () => {
    const chunks = await run([
      // 故意不带 item_id，只靠 output_index 关联，覆盖旧实现直接丢弃的分支
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '{"pattern":',
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '"*.ts"}',
      },
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      completed(),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: '*.ts' });
  });

  it('完整参数在 output_item.added.item.arguments 时也落块', async () => {
    const chunks = await run([
      added(0, {
        id: 'item_0',
        call_id: 'call_0',
        name: 'glob',
        arguments: '{"pattern":"src/**/*.ts"}',
      }),
      completed(),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: 'src/**/*.ts' });
  });

  it('多工具交错 delta 不串号', async () => {
    const chunks = await run([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      added(1, { id: 'item_1', call_id: 'call_1', name: 'read' }),
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_0',
        output_index: 0,
        delta: '{"pattern":',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_1',
        output_index: 1,
        delta: '{"file_path":',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_0',
        output_index: 0,
        delta: '"*.ts"}',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_1',
        output_index: 1,
        delta: '"a.ts"}',
      },
      // done 逆序到达，验证不会按“当前工具”错配
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_1',
        output_index: 1,
        arguments: '{"file_path":"a.ts"}',
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"pattern":"*.ts"}',
      },
      completed(),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: '*.ts' });
    expect(JSON.parse(map.get('call_1').arguments)).toEqual({ file_path: 'a.ts' });
  });

  it('同一 call 的重复 final/done/completed 只落一个工具块', async () => {
    const chunks = await run([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'glob',
          arguments: '{"pattern":"*.ts"}',
        },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'glob',
          arguments: '{"pattern":"*.ts"}',
        },
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"pattern":"*.ts"}',
      },
      completed([
        {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'glob',
          arguments: '{"pattern":"*.ts"}',
        },
      ]),
    ]);

    const blocks = toolEnds(chunks);
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0].arguments)).toEqual({ pattern: '*.ts' });
  });

  it('function_call_arguments.done 早于 added 时先缓存再回填', async () => {
    const chunks = await run([
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"pattern":"early"}',
      },
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      completed(),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: 'early' });
  });

  it('单工具正常 delta 流保持原行为，且 usage/finish 不丢', async () => {
    const chunks = await run([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_0',
        output_index: 0,
        delta: '{"pattern":',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_0',
        output_index: 0,
        delta: '"*.ts"}',
      },
      completed([], {
        input_tokens: 10,
        output_tokens: 3,
        total_tokens: 13,
      }),
    ]);

    const map = byCallId(toolEnds(chunks));
    expect(JSON.parse(map.get('call_0').arguments)).toEqual({ pattern: '*.ts' });
    expect(chunks.find((c) => c.type === 'usage')?.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
    });
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe('stop');
  });

  it('无终止事件：抛截断错误，且 block_end 标记参数不完整', async () => {
    const { chunks, error } = await runCollecting([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'write' }),
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_0',
        output_index: 0,
        delta: '{"content":"<html>abc',
      },
    ]);

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    const end = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'tool-call',
    );
    // 半截 JSON 原样保留供审计，且明确标记不完整
    expect(end?.block.arguments).toBe('{"content":"<html>abc');
    expect(end?.block.argumentsComplete).toBe(false);
  });

  it('用户中止优先于截断判定：抛 AbortError 而不是截断错误', async () => {
    const controller = new AbortController();
    controller.abort();
    const { error } = await runCollecting(
      [
        added(0, { id: 'item_0', call_id: 'call_0', name: 'write' }),
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_0',
          output_index: 0,
          delta: '{"content":"abc',
        },
      ],
      controller.signal,
    );

    expect(error?.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(UpstreamStreamTruncatedError);
  });

  it('正常终止：block_end 标记参数完整', async () => {
    const { chunks, error } = await runCollecting([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'glob' }),
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"pattern":"*.ts"}',
      },
      completed(),
    ]);

    expect(error).toBeUndefined();
    const end = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'tool-call',
    );
    expect(end?.block.argumentsComplete).toBe(true);
  });

  it('工具已 done 但上游漏发 completed：按正常结束，不报截断', async () => {
    const { chunks, error } = await runCollecting([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'browser_run' }),
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"name":"x","script":"await tab.screenshot();"}',
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'item_0',
          call_id: 'call_0',
          name: 'browser_run',
          arguments: '{"name":"x","script":"await tab.screenshot();"}',
        },
      },
      // 上游到此直接关流，没有 response.completed
    ]);

    expect(error).toBeUndefined();
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe('stop');
    const end = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'tool-call',
    );
    expect(end?.block.argumentsComplete).toBe(true);
  });

  it('正文已 output_text.done 但漏发 completed：按正常结束', async () => {
    const { chunks, error } = await runCollecting([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: '完整的一句话。' },
      { type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, text: '完整的一句话。' },
    ]);

    expect(error).toBeUndefined();
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe('stop');
  });

  it('正文停在 delta 且漏发 completed：仍判截断', async () => {
    const { error } = await runCollecting([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: '写到一半就断' },
    ]);

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    expect((error as Error).message).toContain('last=response.output_text.delta');
  });

  it('工具只 added、参数 0 字符就断：判截断并标 argumentsComplete=false', async () => {
    const { chunks, error } = await runCollecting([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'read' }),
    ]);

    expect(error).toBeInstanceOf(UpstreamStreamTruncatedError);
    const end = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'tool-call',
    );
    expect(end?.block.argumentsComplete).toBe(false);
  });

  it('response.failed：抛结构化错误（读 response.error），不合成 finish', async () => {
    const { chunks, error } = await runCollecting([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '  ',
      },
      {
        type: 'response.failed',
        response: {
          id: 'resp_123',
          status: 'failed',
          error: {
            code: 'invalid_value',
            param: 'url',
            type: 'invalid_request_error',
            message:
              'Unable to download content from the provided URL before the timeout.',
          },
        },
      },
    ]);

    expect(error).toBeInstanceOf(UpstreamResponseFailedError);
    const failed = error as UpstreamResponseFailedError;
    expect(failed.code).toBe('invalid_value');
    expect(failed.param).toBe('url');
    expect(failed.requestId).toBe('resp_123');
    expect(failed.retryable).toBe(true);
    expect(chunks.find((c) => c.type === 'finish')).toBeUndefined();
    // 失败前已产出的正文仍先闭合，交给恢复层统计/丢弃
    expect(
      chunks.some(
        (c) => c.type === 'block_end' && c.block?.type === 'text',
      ),
    ).toBe(true);
  });

  it('response.failed 携带完整工具：block_end 带 argumentsComplete=true', async () => {
    const { chunks, error } = await runCollecting([
      added(0, { id: 'item_0', call_id: 'call_0', name: 'read' }),
      {
        type: 'response.function_call_arguments.done',
        item_id: 'item_0',
        output_index: 0,
        arguments: '{"path":"a.ts"}',
      },
      {
        type: 'response.failed',
        response: {
          status: 'failed',
          error: { code: 'server_error', message: 'boom' },
        },
      },
    ]);

    expect(error).toBeInstanceOf(UpstreamResponseFailedError);
    const ends = toolEnds(chunks);
    expect(ends).toHaveLength(1);
    expect(ends[0].argumentsComplete).toBe(true);
    expect(ends[0].arguments).toBe('{"path":"a.ts"}');
  });

  it('response.incomplete(max_output_tokens) → finishReason=length', async () => {
    const { chunks, error } = await runCollecting([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '写到一半',
      },
      {
        type: 'response.incomplete',
        response: {
          output: [],
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
    ]);

    expect(error).toBeUndefined();
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe(
      'length',
    );
  });

  it('response.failed 上游读流中断（upstream_error）→ retryable=true', async () => {
    const { chunks, error } = await runCollecting([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: ' ',
      },
      {
        type: 'response.failed',
        response: {
          id: 'resp_read_error',
          status: 'failed',
          error: {
            code: 'upstream_stream_read_error',
            param: null,
            type: 'upstream_error',
            message: 'Upstream response stream was interrupted',
          },
        },
      },
    ]);

    expect(error).toBeInstanceOf(UpstreamResponseFailedError);
    const failed = error as UpstreamResponseFailedError;
    expect(failed.code).toBe('upstream_stream_read_error');
    expect(failed.retryable).toBe(true);
    expect(chunks.find((c) => c.type === 'finish')).toBeUndefined();
  });

  it('response.failed 请求校验错误（invalid_request_error）→ retryable=false', async () => {
    const { error } = await runCollecting([
      {
        type: 'response.failed',
        response: {
          status: 'failed',
          error: {
            code: 'unsupported_parameter',
            type: 'invalid_request_error',
            message: 'Unsupported parameter: enable_thinking',
          },
        },
      },
    ]);

    expect(error).toBeInstanceOf(UpstreamResponseFailedError);
    expect((error as UpstreamResponseFailedError).retryable).toBe(false);
  });

  it('sub2api_placeholder 事件不计入正文/完成判定', async () => {
    const { chunks, error } = await runCollecting([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_ph' },
        sub2api_placeholder: true,
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_ph',
        output_index: 0,
        delta: ' ',
        sub2api_placeholder: true,
      },
      completed([], { input_tokens: 1, output_tokens: 0, total_tokens: 1 }),
    ]);

    expect(error).toBeUndefined();
    expect(
      chunks.some((c) => c.type === 'text_delta' || c.type === 'block_end'),
    ).toBe(false);
    expect(chunks.find((c) => c.type === 'finish')?.finishReason).toBe('stop');
  });
});
