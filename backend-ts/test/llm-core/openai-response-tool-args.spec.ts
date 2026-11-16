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
});
