/**
 * 代码型供应商包契约测试：用本地 HTTP mock 驱动 plugins/provider-ollama 的原生适配器。
 *
 * 验证：
 * - 协议注册回调可用
 * - StreamChunk 顺序（block_start → delta → block_end → usage → finish）
 * - 工具调用 / thinking / usage 映射
 * - 模型发现 / 连接测试 / embedding
 */
import * as http from 'http';
import * as path from 'path';

const OLLAMA_PLUGIN_PATH = path.resolve(
  __dirname,
  '../../../plugins/provider-ollama/index.js',
);

type Chunk = { type: string; [key: string]: any };

describe('Ollama 原生协议适配器（示例代码包）', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastChatBody: any = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || '';
      if (url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'nomic-embed-text' }] }));
        return;
      }
      if (url === '/api/embed') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ embeddings: [[0.1, 0.2]], prompt_eval_count: 3 }));
        });
        return;
      }
      if (url === '/api/chat') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          lastChatBody = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          const lines = [
            { message: { role: 'assistant', content: 'Hel' }, done: false },
            { message: { role: 'assistant', content: 'lo' }, done: false },
            { message: { role: 'assistant', thinking: 'think ' }, done: false },
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  { function: { name: 'get_weather', arguments: { city: 'SH' } } },
                ],
              },
              done: false,
            },
            {
              message: { role: 'assistant', content: '' },
              done: true,
              prompt_eval_count: 10,
              eval_count: 5,
            },
          ];
          for (const line of lines) res.write(JSON.stringify(line) + '\n');
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function loadAdapter() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Plugin = require(OLLAMA_PLUGIN_PATH);
    const plugin = new Plugin();
    const defs: any[] = [];
    return plugin
      .onLoad({ registerProtocolAdapter: (def: any) => defs.push(def) })
      .then(() => defs[0].adapter);
  }

  it('插件通过 registerProtocolAdapter 贡献 ollama-native', async () => {
    const adapter = await loadAdapter();
    expect(adapter.protocol).toBe('ollama-native');
    expect(adapter.capabilities).toMatchObject({
      streaming: true,
      tools: true,
      embeddings: true,
    });
  });

  it('chatCompletion 产出合法 StreamChunk 序列（文本/思考/工具/usage/finish）', async () => {
    const adapter = await loadAdapter();
    const chunks: Chunk[] = [];
    const stream = await adapter.chatCompletion({
      model: 'qwen3:8b',
      system: 'be helpful',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
      thinkingEffort: 'on',
      stream: true,
      providerConfig: { apiUrl: baseUrl, apiKey: 'test-key' },
    } as any);
    for await (const chunk of stream as AsyncGenerator<Chunk>) chunks.push(chunk);

    const types = chunks.map((c) => c.type);
    expect(types).toEqual([
      'block_start',
      'text_delta',
      'text_delta',
      'block_start',
      'reasoning_delta',
      'block_end', // reasoning
      'block_end', // text
      'block_start',
      'tool_call_delta',
      'block_end',
      'usage',
      'finish',
    ]);

    const textBlock = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'text',
    );
    expect(textBlock?.block).toEqual({ type: 'text', text: 'Hello' });

    const reasoningBlock = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'reasoning',
    );
    expect(reasoningBlock?.block).toEqual({ type: 'reasoning', summary: 'think ' });

    const toolBlock = chunks.find(
      (c) => c.type === 'block_end' && c.block?.type === 'tool-call',
    );
    expect(toolBlock?.block).toMatchObject({
      type: 'tool-call',
      name: 'get_weather',
      arguments: '{"city":"SH"}',
    });

    const usageIndex = types.lastIndexOf('usage');
    const finishIndex = types.lastIndexOf('finish');
    expect(usageIndex).toBeLessThan(finishIndex);
    expect(chunks[usageIndex].usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(chunks[finishIndex].finishReason).toBe('tool_calls');

    // 请求映射：system / tools / thinking / 鉴权头由适配器负责
    expect(lastChatBody.model).toBe('qwen3:8b');
    expect(lastChatBody.messages[0]).toEqual({ role: 'system', content: 'be helpful' });
    expect(lastChatBody.think).toBe(true);
    expect(lastChatBody.tools[0].function.name).toBe('get_weather');
  });

  it('testConnection / syncRemoteModels / embeddings', async () => {
    const adapter = await loadAdapter();
    const config = { apiUrl: baseUrl, apiKey: '' };

    await expect(adapter.testConnection(config)).resolves.toMatchObject({
      success: true,
      message: expect.stringContaining('2'),
    });

    const models = await adapter.syncRemoteModels(config);
    expect(models.map((m: any) => m.id)).toEqual(['qwen3:8b', 'nomic-embed-text']);

    const embedding = await adapter.embeddings({
      model: 'nomic-embed-text',
      input: 'hello',
      providerConfig: config,
    });
    expect(embedding.embeddings).toEqual([[0.1, 0.2]]);
  });
});
