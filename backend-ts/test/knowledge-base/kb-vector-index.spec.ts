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
import { KbVectorIndexService } from '../../src/modules/knowledge-base/kb-vector-index.service';
import {
  VEC_TABLE,
  countIndexedVectors,
  declaredVecDim,
  dropVecTable,
  vecTableExists,
} from '../../src/modules/knowledge-base/kb-vector-index';

/**
 * vec0 向量索引：**行为等价性**验证
 *
 * ## 这个文件要证明什么
 *
 * 索引路径（vec0 KNN）与扫描路径（标量 `vec_distance_cosine` 全表扫描）必须产出
 * **完全相同的 id 序列与分数**。这不是"差不多就行"——它决定了迁移是否引入行为变化。
 *
 * 依据：`sqlite-vec@0.1.9` 的 `distance_metric=cosine` 与标量 `vec_distance_cosine`
 * 实测**位级相同**（见 `docs/design/kb-architecture-review.md` 附录 A.1）。所以这里断言
 * 严格相等（`toBe`）而非容差比较；一旦将来 sqlite-vec 换了实现导致浮点差异，这里会红，
 * 那正是我们想知道的。
 *
 * ## 为什么黄金基线不需要重新生成
 *
 * `kb-search.service.spec.ts` 用 `new KbSearchService(service)` 构造（不传索引服务），
 * 因此恒走扫描路径——基线继续锁定"原实现行为"。而本文件独立断言"索引路径 == 扫描路径"。
 * 两条性质分开锁，比"改实现就重生成基线"强得多：后者会掩盖行为变化。
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'kb-search-golden.json');

/** 用 fixture 里的确定性合成向量当查询向量（与黄金基线同一套口径） */
function seededQuery(query: string, dim: number): number[] {
  const seed = `query::${query}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  const out: number[] = [];
  for (let i = 0; i < dim; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push((x / 4294967296) * 2 - 1);
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}

describe('vec0 向量索引：与扫描路径行为等价', () => {
  let root: string;
  let databases: KbDatabaseService;
  /** 带索引服务的实例：走 vec0 索引路径 */
  let indexed: KbSearchService;
  /** 不带索引服务的实例：恒走扫描路径（= 改造前行为） */
  let scanned: KbSearchService;
  let vectorIndex: KbVectorIndexService;
  let chunkRepo: KBChunkRepository;
  let kbId: string;
  let dim: number;
  let queries: string[];
  let fixture: any;

  beforeAll(async () => {
    fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    kbId = fixture.tableId;
    dim = fixture.dim;
    queries = fixture.queries;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vecidx-'));

    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    fs.mkdirSync(path.join(root, kbId), { recursive: true });
    fs.writeFileSync(
      path.join(root, kbId, 'kb.json'),
      JSON.stringify({ id: kbId, name: 'vecidx' }),
    );

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_KB);
    databases = new KbDatabaseService(gate);
    vectorIndex = new KbVectorIndexService(databases);
    indexed = new KbSearchService(databases, vectorIndex);
    scanned = new KbSearchService(databases);

    const fileRepo = new KBFileRepository(databases);
    chunkRepo = new KBChunkRepository(databases);

    await fileRepo.create(kbId, {
      id: 'vecidx-item',
      fileName: 'vecidx.txt',
      displayName: 'vecidx.txt',
      fileType: 'text',
      fileExtension: 'txt',
      processingStatus: 'completed',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });

    // 走 replaceChunks → 触发双写（这是写入路径的索引同步）
    // metadata 用**贴近真实摄入**的形状（kb-file.service 写的就是这几个键），
    // 而不是 fixture 里那份只有 chunkIndex 的精简版——否则测不出 fileId 这类定位信息。
    await chunkRepo.replaceChunks(
      kbId,
      'vecidx-item',
      fixture.documents.map((doc: any) => ({
        id: doc.id,
        vectorId: doc.id,
        chunkIndex: doc.metadata?.chunkIndex ?? 0,
        content: doc.content,
        tokenCount: 0,
        embedding: doc.embedding,
        embeddingDimensions: doc.embedding.length,
        metadata: {
          fileId: 'vecidx-item',
          knowledgeBaseId: kbId,
          fileName: 'vecidx.txt',
          overlapLength: 0,
          strategy: 'token',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    );
  });

  afterAll(async () => {
    await databases.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 双写：写入路径就把索引维护好，不需要靠回填补
  // ---------------------------------------------------------------------------
  describe('写入双写', () => {
    it('replaceChunks 后索引已存在，维度取自向量长度', async () => {
      const db = await databases.getDb(kbId);
      expect(vecTableExists(db)).toBe(true);
      expect(declaredVecDim(db)).toBe(dim);
      expect(countIndexedVectors(db)).toBe(fixture.documents.length);
    });

    it('双写后索引立即就绪（无需回填）', async () => {
      await expect(vectorIndex.isReady(kbId)).resolves.toBe(true);
      const result = await vectorIndex.ensureIndex(kbId);
      expect(result.state).toBe('ready');
      if (result.state === 'ready') {
        expect(result.dim).toBe(dim);
        expect(result.indexed).toBe(fixture.documents.length);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 核心：等价性
  // ---------------------------------------------------------------------------
  describe('等价性：索引路径 === 扫描路径', () => {
    it('每条查询的语义召回 id 序列与分数完全一致', async () => {
      let compared = 0;
      for (const query of queries) {
        const emb = seededQuery(query, dim);
        const viaIndex = await indexed.semanticSearch(kbId, emb, 20);
        const viaScan = await scanned.semanticSearch(kbId, emb, 20);

        expect(viaIndex.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
        for (let i = 0; i < viaScan.length; i++) {
          // 严格相等：cosine 距离与标量实现位级相同（附录 A.1）
          expect(viaIndex[i].score).toBe(viaScan[i].score);
          expect(viaIndex[i].semanticScore).toBe(viaScan[i].semanticScore);
        }
        expect(viaIndex.length).toBeGreaterThan(0);
        compared++;
      }
      expect(compared).toBe(queries.length);
    });

    it('metadata 形状一致（含文件名等条目信息）', async () => {
      const emb = seededQuery(queries[0], dim);
      const viaIndex = await indexed.semanticSearch(kbId, emb, 5);
      const viaScan = await scanned.semanticSearch(kbId, emb, 5);

      expect(viaIndex[0].metadata).toEqual(viaScan[0].metadata);
    });

    it('metadata 带定位信息：chunkIndex / chunkId / fileId（B2 的修复点）', async () => {
      const emb = seededQuery(queries[0], dim);
      const results = await indexed.semanticSearch(kbId, emb, 5);

      expect(results.length).toBeGreaterThan(0);
      const meta = results[0].metadata;
      // 这三项此前都不存在，导致 Agent 工具与前端都拿不到分块号/文件 id
      expect(typeof meta.chunkIndex).toBe('number');
      expect(meta.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(typeof meta.chunkId).toBe('string');
      expect(meta.chunkId).toBe(results[0].id);
      expect(typeof meta.fileId).toBe('string');
    });

    it('metadata 的 chunkIndex 与 chunk 表的 chunk_index 列一致', async () => {
      const emb = seededQuery(queries[1], dim);
      const results = await indexed.semanticSearch(kbId, emb, 5);
      const db = await databases.getDb(kbId);

      for (const r of results) {
        const row = db
          .prepare(`SELECT chunk_index FROM chunk WHERE id = ?`)
          .get(r.id) as { chunk_index: number };
        expect(r.metadata.chunkIndex).toBe(row.chunk_index);
      }
    });

    it('混合检索（含 FTS + BM25 + RRF 融合）在两条路径下结果一致', async () => {
      for (const query of queries) {
        const emb = seededQuery(query, dim);
        const viaIndex = await indexed.hybridSearch(kbId, emb, query, 5, 0.3, 0.7);
        const viaScan = await scanned.hybridSearch(kbId, emb, query, 5, 0.3, 0.7);

        expect(viaIndex.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
        for (let i = 0; i < viaScan.length; i++) {
          expect(viaIndex[i].score).toBe(viaScan[i].score);
        }
      }
    });

    it('k 大于总行数时两条路径都返回全部行', async () => {
      const emb = seededQuery(queries[0], dim);
      const total = fixture.documents.length;
      const viaIndex = await indexed.semanticSearch(kbId, emb, total + 50);
      const viaScan = await scanned.semanticSearch(kbId, emb, total + 50);

      expect(viaIndex).toHaveLength(total);
      expect(viaScan).toHaveLength(total);
      expect(viaIndex.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
    });
  });

  // ---------------------------------------------------------------------------
  // 回填与自愈
  // ---------------------------------------------------------------------------
  describe('回填与自愈', () => {
    it('索引被丢弃后：isReady 变 false，ensureIndex 能重建并恢复等价', async () => {
      const db = await databases.getDb(kbId);
      dropVecTable(db);
      expect(vecTableExists(db)).toBe(false);

      await expect(vectorIndex.isReady(kbId)).resolves.toBe(false);

      const result = await vectorIndex.ensureIndex(kbId);
      expect(result.state).toBe('ready');
      await expect(vectorIndex.isReady(kbId)).resolves.toBe(true);

      // 重建后仍与扫描路径等价
      const emb = seededQuery(queries[1], dim);
      const viaIndex = await indexed.semanticSearch(kbId, emb, 20);
      const viaScan = await scanned.semanticSearch(kbId, emb, 20);
      expect(viaIndex.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
      for (let i = 0; i < viaScan.length; i++) {
        expect(viaIndex[i].score).toBe(viaScan[i].score);
      }
    });

    it('索引行被清空后：计数比对判定未就绪（不靠水位，能自愈）', async () => {
      const db = await databases.getDb(kbId);
      db.exec(`DELETE FROM ${VEC_TABLE}`);
      await expect(vectorIndex.isReady(kbId)).resolves.toBe(false);

      const result = await vectorIndex.ensureIndex(kbId);
      expect(result.state).toBe('ready');
      await expect(vectorIndex.isReady(kbId)).resolves.toBe(true);
    });

    it('索引未就绪时 semanticSearch 仍返回正确结果（降级扫描，不静默出错）', async () => {
      const db = await databases.getDb(kbId);
      dropVecTable(db);

      const emb = seededQuery(queries[2], dim);
      const degraded = await indexed.semanticSearch(kbId, emb, 20);
      const viaScan = await scanned.semanticSearch(kbId, emb, 20);

      // 降级路径的结果必须与扫描路径完全一致（也就是"正确但不快"）
      expect(degraded.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
      for (let i = 0; i < viaScan.length; i++) {
        expect(degraded[i].score).toBe(viaScan[i].score);
      }

      // 降级时会异步触发一次回填，等它落地后索引应恢复
      await vectorIndex.ensureIndex(kbId);
      await expect(vectorIndex.isReady(kbId)).resolves.toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 按条目过滤：走受限扫描（不赌 vec0 的元数据列过滤）
  // ---------------------------------------------------------------------------
  describe('按条目过滤', () => {
    it('带 itemId 过滤时结果与扫描路径一致，且只含该条目的分块', async () => {
      const emb = seededQuery(queries[3], dim);
      const viaIndex = await indexed.semanticSearch(kbId, emb, 10, {
        itemId: 'vecidx-item',
      });
      const viaScan = await scanned.semanticSearch(kbId, emb, 10, {
        itemId: 'vecidx-item',
      });

      expect(viaIndex.map((r) => r.id)).toEqual(viaScan.map((r) => r.id));
      expect(viaIndex.length).toBeGreaterThan(0);
    });

    it('过滤到不存在的条目时返回空（两条路径一致）', async () => {
      const emb = seededQuery(queries[0], dim);
      const viaIndex = await indexed.semanticSearch(kbId, emb, 10, {
        itemId: 'no-such-item',
      });
      const viaScan = await scanned.semanticSearch(kbId, emb, 10, {
        itemId: 'no-such-item',
      });

      expect(viaIndex).toEqual([]);
      expect(viaScan).toEqual([]);
    });
  });
});

// =============================================================================
// 边界：混合维度、零向量、空库
// =============================================================================
describe('vec0 索引：边界与异常态', () => {
  let root: string;
  let databases: KbDatabaseService;
  let vectorIndex: KbVectorIndexService;
  let chunkRepo: KBChunkRepository;
  let fileRepo: KBFileRepository;
  let kbId: string;

  beforeEach(async () => {
    kbId = 'kb_edge';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vecidx-edge-'));
    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    fs.mkdirSync(path.join(root, kbId), { recursive: true });
    fs.writeFileSync(
      path.join(root, kbId, 'kb.json'),
      JSON.stringify({ id: kbId, name: 'edge' }),
    );

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_KB);
    databases = new KbDatabaseService(gate);
    vectorIndex = new KbVectorIndexService(databases);
    chunkRepo = new KBChunkRepository(databases);
    fileRepo = new KBFileRepository(databases);

    await fileRepo.create(kbId, {
      id: 'edge-item',
      fileName: 'edge.txt',
      displayName: 'edge.txt',
      fileType: 'text',
      fileExtension: 'txt',
      processingStatus: 'completed',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    await databases.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function chunkRow(id: string, index: number, embedding: number[] | null) {
    return {
      id,
      vectorId: id,
      chunkIndex: index,
      content: `内容 ${id}`,
      tokenCount: 3,
      embedding,
      embeddingDimensions: embedding?.length ?? null,
      metadata: { fileId: 'edge-item', knowledgeBaseId: kbId, fileName: 'edge.txt' },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('空库：ensureIndex 返回 empty，不建索引', async () => {
    const result = await vectorIndex.ensureIndex(kbId);
    expect(result.state).toBe('empty');
    const db = await databases.getDb(kbId);
    expect(vecTableExists(db)).toBe(false);
  });

  it('全部无向量：ensureIndex 返回 empty（没有可索引的行）', async () => {
    await chunkRepo.replaceChunks(kbId, 'edge-item', [
      chunkRow('c1', 0, null),
      chunkRow('c2', 1, null),
    ]);
    const result = await vectorIndex.ensureIndex(kbId);
    expect(result.state).toBe('empty');
  });

  it('混合维度：拒绝建索引并报 inconsistent-dimension（不静默漏检）', async () => {
    // 维度 3 与 4 混在同一库里 —— 异常态（正常路径下换模型会先 deleteAll）
    await chunkRepo.replaceChunks(kbId, 'edge-item', [
      chunkRow('c1', 0, [1, 0, 0]),
      chunkRow('c2', 1, [1, 0, 0, 0]),
    ]);

    const result = await vectorIndex.ensureIndex(kbId);
    expect(result.state).toBe('inconsistent-dimension');
    if (result.state === 'inconsistent-dimension') {
      expect([...result.dims].sort()).toEqual([3, 4]);
    }
    await expect(vectorIndex.isReady(kbId)).resolves.toBe(false);
  });

  it('混合维度时检索仍可用：只在与查询同维度的向量上召回，不抛错', async () => {
    await chunkRepo.replaceChunks(kbId, 'edge-item', [
      chunkRow('c1', 0, [1, 0, 0]),
      chunkRow('c2', 1, [1, 0, 0, 0]),
    ]);
    const search = new KbSearchService(databases, vectorIndex);

    // 3 维查询：只应召回 3 维的行。
    // 改造前这里会直接抛 `Vector dimension mistmatch`，整个库语义检索不可用。
    const threeDim = await search.semanticSearch(kbId, [1, 0, 0], 5);
    expect(threeDim.map((r) => r.id)).toEqual(['c1']);

    // 4 维查询：只应召回 4 维的行
    const fourDim = await search.semanticSearch(kbId, [1, 0, 0, 0], 5);
    expect(fourDim.map((r) => r.id)).toEqual(['c2']);

    // 两条路径口径一致
    const scanOnly = new KbSearchService(databases);
    const scanThree = await scanOnly.semanticSearch(kbId, [1, 0, 0], 5);
    expect(scanThree.map((r) => r.id)).toEqual(['c1']);
  });

  it('零向量不产生"假满分"，两条路径都不返回它', async () => {
    await chunkRepo.replaceChunks(kbId, 'edge-item', [
      chunkRow('normal', 0, [1, 0, 0]),
      chunkRow('zero', 1, [0, 0, 0]),
    ]);

    const withIndex = new KbSearchService(databases, vectorIndex);
    const withoutIndex = new KbSearchService(databases);

    const viaIndex = await withIndex.semanticSearch(kbId, [1, 0, 0], 10);
    const viaScan = await withoutIndex.semanticSearch(kbId, [1, 0, 0], 10);

    // 零向量的余弦未定义（NULL）：不得以 score=1 的"假满分"出现在首位
    expect(viaIndex.map((r) => r.id)).toEqual(['normal']);
    expect(viaScan.map((r) => r.id)).toEqual(['normal']);
    for (const r of [...viaIndex, ...viaScan]) {
      expect(r.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('换维度后（模拟换嵌入模型）：写入路径不写旧索引，ensureIndex 重建为新维度', async () => {
    // 先建 3 维索引
    await chunkRepo.replaceChunks(kbId, 'edge-item', [chunkRow('c1', 0, [1, 0, 0])]);
    const db = await databases.getDb(kbId);
    expect(declaredVecDim(db)).toBe(3);

    // 模拟换模型：清空分块（真实路径是 clearAndReprocessKnowledgeBase）后按 4 维重写
    await chunkRepo.deleteAll(kbId);
    await chunkRepo.replaceChunks(kbId, 'edge-item', [chunkRow('c2', 0, [1, 0, 0, 0])]);

    // 写入路径不会为 4 维数据往 3 维表里插（否则会抛 Dimension mismatch）
    const result = await vectorIndex.ensureIndex(kbId);
    expect(result.state).toBe('ready');
    if (result.state === 'ready') expect(result.dim).toBe(4);
    expect(declaredVecDim(await databases.getDb(kbId))).toBe(4);
  });
});
