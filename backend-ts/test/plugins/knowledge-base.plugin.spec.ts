/**
 * KnowledgeBasePlugin 工具输出：特征测试（characterization test）
 *
 * ## 为什么单独测这个
 *
 * `knowledge-base.plugin.ts` 在此之前**零测试覆盖**，而它正是 Agent 唯一能碰到的知识库入口。
 * 评审文档定位到两个实际 bug 都在它的输出拼装里：
 *
 * - **B2**：`kb_search` 想显示分块号（`result.metadata?.chunkIndex`），但检索结果的 metadata
 *   里从来没有这个键，所以 `chunkLabel` 恒为空——那段代码从未生效。
 * - **B4**：工具文本只渲染 `fileName`，不输出 `file_id`，于是 Agent 拿到搜索结果后
 *   既无文件 id 也无分块序号，想深入看上下文只能先 `kb_list_files` 找 id。
 *
 * 本文件先把**现状**钉住（断言"确实没有"），这样后续修 B2/B4 时改动是显式可见的，
 * 而不是悄悄改了没人知道。修完后这些用例要**反向更新**为"确实有"。
 *
 * ## 为什么不用 Toolkit 类
 *
 * 插件用的是「返回值方式」注册（`const kit = api.registerToolKit(...); kit.registerTool(...)`），
 * 所以一个收集式 mock handle 就够，不必拉起 Toolkit 全套。
 */

import { KnowledgeBasePlugin } from '../../src/modules/knowledge-base/plugins/knowledge-base.plugin';

/** 收集式 mock：捕获工具与提示词，供断言与调用 */
function createPlugin(overrides: {
  kb?: any;
  model?: any;
  searchResults?: any[];
  hybridSearch?: jest.Mock;
  files?: any[];
  fileTotal?: number;
  chunks?: any[];
} = {}) {
  // 注意：不能用 `overrides.kb ?? 默认值` —— 那样显式传 null 会被当成"未提供"，
  // 于是"知识库不存在"这类用例根本走不到被测分支。
  const pick = <T,>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;

  const providerStore = {
    findModel: jest.fn(() =>
      pick(overrides.model, {
        provider: { apiUrl: 'http://x', apiKey: 'k' },
        modelName: 'embed-model',
      }),
    ),
  };
  const kbMetaStore = {
    getKb: jest.fn(async () =>
      pick(overrides.kb, { id: 'kb1', name: '测试库', embeddingModelId: 'm1' }),
    ),
  };
  const fileRepo = {
    findByKnowledgeBaseId: jest.fn(async () => ({
      items: overrides.files ?? [],
      total: overrides.fileTotal ?? 0,
    })),
    findById: jest.fn(async () => overrides.files?.[0] ?? null),
  };
  const chunkRepo = {
    findByItemId: jest.fn(async () => overrides.chunks ?? []),
  };
  const hybridSearch = overrides.hybridSearch ?? jest.fn(async () => overrides.searchResults ?? []);
  const searchService = { hybridSearch };
  const embeddingService = {
    getEmbedding: jest.fn(async () => [0.1, 0.2, 0.3]),
  };
  const kbFileService = {
    addTextDocument: jest.fn(async () => ({
      id: 'new-item', displayName: 'a.md', processingStatus: 'pending',
    })),
  };

  const plugin = new KnowledgeBasePlugin(
    providerStore as any,
    kbMetaStore as any,
    fileRepo as any,
    chunkRepo as any,
    searchService as any,
    embeddingService as any,
    kbFileService as any,
  );

  const tools = new Map<string, any>();
  let prompt: any;
  let kitDef: any;

  const handle = {
    registerTool: (def: any) => tools.set(def.name, def),
    registerPrompt: (def: any) => { prompt = def; },
  };
  plugin.onLoad({
    registerNls: jest.fn(),
    registerToolKit: (def: any) => { kitDef = def; return handle; },
  } as any);

  return { plugin, tools, kitDef, getPrompt: () => prompt, hybridSearch, embeddingService, kbFileService };
}

/** 一次命中结果，metadata 与真实检索输出同形（注意：没有 chunkIndex） */
function hit(overrides: Record<string, any> = {}) {
  return {
    id: 'chunk_0_item1',
    content: '命中内容',
    score: 0.9,
    semanticScore: 0.8,
    bm25Score: 0.5,
    metadata: {
      fileId: 'item1',
      knowledgeBaseId: 'kb1',
      fileName: '说明.md',
      overlapLength: 0,
      strategy: 'token',
      ...overrides,
    },
  };
}

describe('KnowledgeBasePlugin 工具输出（特征测试）', () => {
  it('注册了 4 个工具与 1 条提示词', () => {
    const { tools, getPrompt } = createPlugin();
    expect([...tools.keys()].sort()).toEqual([
      'kb_add_document',
      'kb_get_chunks',
      'kb_list_files',
      'kb_search',
    ]);
    expect(getPrompt()).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 已修复（原为特征测试，随 B2/B4/B5 修复后反转）
  // ---------------------------------------------------------------------------
  describe('已修复：kb_search 文本投影带上定位信息', () => {
    it('输出里带 file_id —— Agent 可从搜索直接走到 kb_get_chunks（B4 已修）', async () => {
      const { tools } = createPlugin({ searchResults: [hit()] });
      const out = await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: '问题',
      });

      expect(out).toContain('file_id: item1');
    });

    it('metadata 带 chunkIndex 时输出分块号（B2 已修）', async () => {
      const { tools } = createPlugin({
        searchResults: [hit({ chunkIndex: 7 })],
      });
      const out = await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: '问题',
      });

      expect(out).toContain('chunk: 7');
      expect(out).toContain('file: 说明.md');
    });

    it('chunkIndex 为 null 时不渲染 "chunk: null"（老数据缺列时的容错）', async () => {
      const { tools } = createPlugin({
        searchResults: [hit({ chunkIndex: null })],
      });
      const out = await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: '问题',
      });

      expect(out).not.toContain('chunk:');
      expect(out).not.toContain('null');
    });

    it('metadata 缺 fileId 时省略该段（不输出 "file_id: undefined"）', async () => {
      const { tools } = createPlugin({
        searchResults: [hit({ fileId: undefined })],
      });
      const out = await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: '问题',
      });

      expect(out).not.toContain('file_id');
      expect(out).not.toContain('undefined');
    });
  });

  describe('已修复：kb_search 的融合权重读知识库配置（B5 已修）', () => {
    it('用 kb 配置里的权重调 hybridSearch', async () => {
      const { tools, hybridSearch } = createPlugin({
        kb: { id: 'kb1', embeddingModelId: 'm1', semanticWeight: 0.1, keywordWeight: 0.9 },
        searchResults: [hit()],
      });
      await tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' });

      // 签名：(kbId, queryEmbedding, queryText, topK, semanticWeight, keywordWeight, ...)
      expect(hybridSearch.mock.calls[0][4]).toBe(0.1);
      expect(hybridSearch.mock.calls[0][5]).toBe(0.9);
    });

    it('kb 配置缺权重时回退默认 0.3 / 0.7（与 REST 路径一致）', async () => {
      const { tools, hybridSearch } = createPlugin({
        kb: { id: 'kb1', embeddingModelId: 'm1' },
        searchResults: [hit()],
      });
      await tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' });

      expect(hybridSearch.mock.calls[0][4]).toBe(0.3);
      expect(hybridSearch.mock.calls[0][5]).toBe(0.7);
    });

    it('kb 配置里权重同为 0 时回退默认（否则 RRF 恒为 0，排序退化成插入顺序）', async () => {
      const { tools, hybridSearch } = createPlugin({
        kb: { id: 'kb1', embeddingModelId: 'm1', semanticWeight: 0, keywordWeight: 0 },
        searchResults: [hit()],
      });
      await tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' });

      expect(hybridSearch.mock.calls[0][4]).toBe(0.3);
      expect(hybridSearch.mock.calls[0][5]).toBe(0.7);
    });
  });

  // ---------------------------------------------------------------------------
  // 应当保持不变的契约
  // ---------------------------------------------------------------------------
  describe('应保持不变的契约', () => {
    it('kb_search 未显式传 enableBM25Rerank（走服务默认 true）', async () => {
      const { tools, hybridSearch } = createPlugin({ searchResults: [hit()] });
      await tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' });
      expect(hybridSearch.mock.calls[0][7]).toBeUndefined();
    });

    it('kb_search 把 filter_file_id 映射为 itemId 过滤', async () => {
      const { tools, hybridSearch } = createPlugin({ searchResults: [hit()] });
      await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: 'q',
        filter_file_id: 'item9',
      });
      expect(hybridSearch.mock.calls[0][6]).toEqual({ itemId: 'item9' });
    });

    it('kb_search 未传 filter 时 filterOptions 为 undefined', async () => {
      const { tools, hybridSearch } = createPlugin({ searchResults: [hit()] });
      await tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' });
      expect(hybridSearch.mock.calls[0][6]).toBeUndefined();
    });

    it('kb_search 默认 top_k 为 5，可覆盖', async () => {
      const { tools, hybridSearch } = createPlugin({ searchResults: [hit()] });
      const tool = tools.get('kb_search');
      await tool.execute({ knowledge_base_id: 'kb1', query: 'q' });
      expect(hybridSearch.mock.calls[0][3]).toBe(5);
      await tool.execute({ knowledge_base_id: 'kb1', query: 'q', top_k: 12 });
      expect(hybridSearch.mock.calls[1][3]).toBe(12);
    });

    it('kb_search 无结果时返回可读文案', async () => {
      const { tools } = createPlugin({ searchResults: [] });
      const out = await tools.get('kb_search').execute({
        knowledge_base_id: 'kb1',
        query: '找不到的东西',
      });
      expect(out).toContain('No results found');
    });

    it('kb_search 对不存在的知识库抛错', async () => {
      const { tools } = createPlugin({ kb: null });
      await expect(
        tools.get('kb_search').execute({ knowledge_base_id: 'nope', query: 'q' }),
      ).rejects.toThrow(/not found/i);
    });

    it('kb_search 对找不到的嵌入模型抛错（不静默返回空）', async () => {
      const { tools } = createPlugin({ model: null, searchResults: [hit()] });
      await expect(
        tools.get('kb_search').execute({ knowledge_base_id: 'kb1', query: 'q' }),
      ).rejects.toThrow(/Embedding model not found/);
    });

    it('kb_list_files 输出条目 id（Agent 靠它继续操作）', async () => {
      const { tools } = createPlugin({
        files: [{
          id: 'item1', displayName: 'a.md', fileType: 'text', fileSize: 100,
          processingStatus: 'completed', progressPercentage: 100, totalChunks: 3,
        }],
        fileTotal: 1,
      });
      const out = await tools.get('kb_list_files').execute({ knowledge_base_id: 'kb1' });
      expect(out).toContain('a.md');
      expect(out).toContain('id: item1');
      expect(out).toContain('3 chunks');
    });

    it('kb_list_files 在还有更多时给出续取提示', async () => {
      const { tools } = createPlugin({
        files: [{
          id: 'item1', displayName: 'a.md', fileType: 'text', fileSize: 1,
          processingStatus: 'completed', progressPercentage: 100, totalChunks: 1,
        }],
        fileTotal: 30,
      });
      const out = await tools.get('kb_list_files').execute({ knowledge_base_id: 'kb1', limit: 1 });
      expect(out).toContain('29 more files');
    });

    it('kb_get_chunks 对未处理完的文件明确报错（而不是返回空）', async () => {
      const { tools } = createPlugin({
        files: [{ id: 'item1', displayName: 'a.md', processingStatus: 'processing' }],
      });
      await expect(
        tools.get('kb_get_chunks').execute({
          knowledge_base_id: 'kb1',
          file_id: 'item1',
        }),
      ).rejects.toThrow(/not ready/);
    });

    it('kb_get_chunks 输出分块序号与 token 数', async () => {
      const { tools } = createPlugin({
        files: [{ id: 'item1', displayName: 'a.md', processingStatus: 'completed' }],
        chunks: [{ chunkIndex: 2, tokenCount: 42, content: '第二块内容' }],
      });
      const out = await tools.get('kb_get_chunks').execute({
        knowledge_base_id: 'kb1',
        file_id: 'item1',
      });
      expect(out).toContain('[2] tokens: 42');
      expect(out).toContain('第二块内容');
    });

    it('kb_add_document 是唯一的高危工具（dangerLevel high）', () => {
      const { tools } = createPlugin();
      expect(tools.get('kb_add_document').dangerLevel).toBe('high');
      expect(tools.get('kb_search').dangerLevel).toBeUndefined();
    });
  });
});
