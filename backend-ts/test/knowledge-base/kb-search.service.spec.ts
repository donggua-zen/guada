import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  KbDatabaseService,
  setConfiguredKbRoot,
} from '../../src/modules/knowledge-base/kb-database.service';
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from '../../src/common/database/metadata-bootstrap.gate';
import { KBChunkRepository } from '../../src/modules/knowledge-base/kb-chunk.repository';
import { KBFileRepository } from '../../src/modules/knowledge-base/kb-file.repository';
import { KbSearchService } from '../../src/modules/knowledge-base/kb-search.service';

/**
 * 搜索融合算法回归测试（黄金基线）
 *
 * 基线由 `scripts/_kb-capture-golden.cjs` 在**改造前**用旧实现（sqlite-vector-db）
 * 跑出：语料是 2324 条真实分块里均匀抽样的 160 条（中英混排，专门覆盖 jieba/FTS 路径），
 * 向量是确定性合成值（同样输入永远同样输出）。
 *
 * 本测试的价值在于「换了存储之后排序与分数不变」——融合算法是逐行搬运的，
 * 一旦有人改了 tokenize 口径、RRF 常数、BM25 参数或动态权重阈值，这里会立刻失败。
 */
describe('KbSearchService 黄金基线回归', () => {
  const FIXTURE = path.join(__dirname, 'fixtures', 'kb-search-golden.json');

  let root: string;
  let service: KbDatabaseService;
  let search: KbSearchService;
  let kbId: string;
  let fixture: any;

  beforeAll(async () => {
    fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    kbId = fixture.tableId;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-golden-'));

    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    fs.mkdirSync(path.join(root, kbId), { recursive: true });
    fs.writeFileSync(
      path.join(root, kbId, 'kb.json'),
      JSON.stringify({ id: kbId, name: 'golden' }),
    );

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_KB);
    service = new KbDatabaseService(gate);
    search = new KbSearchService(service);

    const fileRepo = new KBFileRepository(service);
    const chunkRepo = new KBChunkRepository(service);

    // 建一条条目，把 fixture 语料按条目分组灌进去（保留原始 chunk id）
    await fileRepo.create(kbId, {
      id: 'golden-item',
      fileName: 'golden.txt',
      displayName: 'golden.txt',
      fileType: 'text',
      fileExtension: 'txt',
      processingStatus: 'completed',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });

    await chunkRepo.replaceChunks(
      kbId,
      'golden-item',
      fixture.documents.map((doc: any) => ({
        id: doc.id,
        vectorId: doc.id,
        chunkIndex: doc.metadata?.chunkIndex ?? 0,
        content: doc.content,
        tokenCount: 0,
        embedding: doc.embedding,
        embeddingDimensions: doc.embedding.length,
        metadata: doc.metadata,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    );
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 分数比较：浮点误差容忍 1e-9 以内 */
  function expectClose(actual: number, expected: number, label: string) {
    expect(Math.abs(actual - expected)).toBeLessThan(1e-9);
    if (Math.abs(actual - expected) >= 1e-9) {
      throw new Error(`${label}: ${actual} != ${expected}`);
    }
  }

  function expectSameRanking(
    actual: Array<{ id: string; score: number; bm25Score?: number; semanticScore?: number }>,
    expected: Array<{ id: string; score: number; bm25Score?: number; semanticScore?: number }>,
    label: string,
  ) {
    expect(actual.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    for (let i = 0; i < expected.length; i++) {
      expectClose(actual[i].score, expected[i].score, `${label}[${i}].score`);
      if (expected[i].bm25Score !== undefined) {
        expectClose(
          actual[i].bm25Score ?? -1,
          expected[i].bm25Score!,
          `${label}[${i}].bm25Score`,
        );
      }
      if (expected[i].semanticScore !== undefined) {
        expectClose(
          actual[i].semanticScore ?? -1,
          expected[i].semanticScore!,
          `${label}[${i}].semanticScore`,
        );
      }
    }
  }

  it('语料装载完整（160 条，含向量）', async () => {
    const chunkRepo = new KBChunkRepository(service);
    const count = await chunkRepo.countByItemId(kbId, 'golden-item');
    expect(count).toBe(fixture.documents.length);
  });

  it.each(
    // 查询在 fixture 里，逐个生成用例便于定位是哪个查询回归了
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'kb-search-golden.json'),
        'utf8',
      ),
    ).queries as string[],
  )('语义检索排序与分数一致：%s', async (query) => {
    const expected = fixture.results[query].semantic;
    const actual = await search.semanticSearch(
      kbId,
      seededQuery(query),
      expected.length,
    );
    expectSameRanking(actual, expected, `semantic(${query})`);
  });

  it.each(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'kb-search-golden.json'),
        'utf8',
      ),
    ).queries as string[],
  )('关键词检索（jieba+FTS+BM25）排序与分数一致：%s', async (query) => {
    const expected = fixture.results[query].keyword;
    const actual = await search.keywordSearch(kbId, query, expected.length);
    expectSameRanking(actual, expected, `keyword(${query})`);
  });

  it.each(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'kb-search-golden.json'),
        'utf8',
      ),
    ).queries as string[],
  )('混合检索（RRF 融合）排序与分数一致：%s', async (query) => {
    const expected = fixture.results[query].hybrid;
    const actual = await search.hybridSearch(
      kbId,
      seededQuery(query),
      query,
      5,
      0.3,
      0.7,
      undefined,
      true,
    );
    expectSameRanking(actual, expected, `hybrid(${query})`);
  });

  it('结果 metadata 里的 fileName 取条目当前显示名（不是处理时快照）', async () => {
    const fileRepo = new KBFileRepository(service);
    await fileRepo.update(kbId, 'golden-item', { displayName: '改名后的名字.txt' });

    const results = await search.keywordSearch(kbId, 'selinux', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].metadata.fileName).toBe('改名后的名字.txt');
  });

  it('缺向量的分块不参与语义召回（迁移未补齐时不会误命中）', async () => {
    const fileRepo = new KBFileRepository(service);
    const chunkRepo = new KBChunkRepository(service);
    await fileRepo.create(kbId, {
      id: 'no-vector-item',
      fileName: 'nov.txt',
      displayName: 'nov.txt',
      processingStatus: 'completed',
      uploadedAt: '2026-01-02T00:00:00.000Z',
    });
    await chunkRepo.replaceChunks(kbId, 'no-vector-item', [
      {
        id: 'nov-chunk-0',
        vectorId: 'nov-chunk-0',
        chunkIndex: 0,
        content: '这一条没有向量，不应出现在语义检索结果里',
        tokenCount: 0,
        embedding: null,
        embeddingDimensions: null,
        metadata: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const results = await search.semanticSearch(kbId, seededQuery('随便什么'), 200);
    expect(results.some((r) => r.id === 'nov-chunk-0')).toBe(false);

    // 但 FTS 应该能搜到（正文正本还在，说明"向量缺失"是可恢复的中间态）
    const keyword = await search.keywordSearch(kbId, '向量', 50);
    expect(keyword.some((r) => r.id === 'nov-chunk-0')).toBe(true);
  });
});

/** 与 fixture 生成脚本完全一致的确定性查询向量 */
function seededQuery(query: string): number[] {
  const dim = 64;
  const seed = 'query::' + query;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = new Array(dim);
  let x = h >>> 0;
  for (let i = 0; i < dim; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = (x / 4294967296) * 2 - 1;
  }
  const norm = Math.sqrt(out.reduce((s: number, v: number) => s + v * v, 0)) || 1;
  return out.map((v: number) => v / norm);
}
