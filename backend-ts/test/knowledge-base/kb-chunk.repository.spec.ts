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
import type { KbChunkFileRow } from '../../src/modules/knowledge-base/kb-chunk.repository';

/**
 * 分块仓储测试
 *
 * 覆盖旧实现做不到的三件事：
 * 1. **单事务替换**：分块正文 + 向量 + FTS 一起换，不再有"向量写成功、正本写失败"
 * 2. **LIMIT/OFFSET 分页**：旧实现要流式扫整个 JSONL 才能 skip
 * 3. **中文 FTS**：写入侧 jieba 分词与查询侧必须同口径，否则静默搜不到
 */
describe('KBChunkRepository', () => {
  let root: string;
  let service: KbDatabaseService;
  let repo: KBChunkRepository;
  let fileRepo: KBFileRepository;
  let search: KbSearchService;
  const kbId = 'kb-chunk-test';

  function row(
    id: string,
    chunkIndex: number,
    content: string,
    embedding?: number[] | null,
  ): KbChunkFileRow {
    return {
      id,
      vectorId: id,
      chunkIndex,
      content,
      tokenCount: content.length,
      embedding: embedding ?? null,
      embeddingDimensions: embedding?.length ?? null,
      metadata: { fileId: 'item-1', knowledgeBaseId: kbId, fileName: 'f.txt' },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-chunk-'));
    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    fs.mkdirSync(path.join(root, kbId), { recursive: true });
    fs.writeFileSync(
      path.join(root, kbId, 'kb.json'),
      JSON.stringify({ id: kbId, name: 'test' }),
    );
    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_KB);
    service = new KbDatabaseService(gate);
    repo = new KBChunkRepository(service);
    fileRepo = new KBFileRepository(service);
    search = new KbSearchService(service);

    // 存储根是**进程级 env**，jest 会复用 worker 进程跑不同 spec 文件。
    // 这里显式断言库文件落在本用例自己的临时目录里：一旦别的 spec 泄漏了
    // KB_DATA_DIR/USERDATA_DIR，就会在这里直接报错，而不是变成"到处找不到库"
    // 这种难查的偶发失败。
    await service.getDb(kbId);
    expect(service.getDbPath(kbId).startsWith(root + path.sep)).toBe(true);

    await fileRepo.create(kbId, { id: 'item-1', displayName: 'f.txt', fileType: 'text' });
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('写入后可读，字段与 API 形状不变', async () => {
    await repo.replaceChunks(kbId, 'item-1', [
      row('c0', 0, '第一段内容'),
      row('c1', 1, '第二段内容'),
    ]);

    const chunks = await repo.findByItemId(kbId, 'item-1', 0, 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].fileId).toBe('item-1');
    expect(chunks[0].knowledgeBaseId).toBe(kbId);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toBe('第一段内容');
    expect(chunks[0].createdAt).toBeInstanceOf(Date);
  });

  it('分页走 LIMIT/OFFSET（不扫全表即能 skip）', async () => {
    await repo.replaceChunks(
      kbId,
      'item-1',
      Array.from({ length: 25 }, (_, i) => row(`c${i}`, i, `内容 ${i}`)),
    );

    const page = await repo.findByItemId(kbId, 'item-1', 20, 5);
    expect(page.map((c) => c.chunkIndex)).toEqual([20, 21, 22, 23, 24]);
    expect(await repo.countByItemId(kbId, 'item-1')).toBe(25);
  });

  it('replaceChunks 是整体替换（重复处理不留半套旧分块）', async () => {
    await repo.replaceChunks(kbId, 'item-1', [
      row('old-0', 0, '旧内容 A'),
      row('old-1', 1, '旧内容 B'),
      row('old-2', 2, '旧内容 C'),
    ]);
    await repo.replaceChunks(kbId, 'item-1', [row('new-0', 0, '新内容')]);

    const chunks = await repo.findByItemId(kbId, 'item-1', 0, 10);
    expect(chunks.map((c) => c.id)).toEqual(['new-0']);
    // 旧分块的 FTS 行必须一并清掉，否则搜出幽灵
    expect(await search.keywordSearch(kbId, '旧内容', 10)).toHaveLength(0);
    expect(await search.keywordSearch(kbId, '新内容', 10)).toHaveLength(1);
  });

  it('中文 FTS：写入侧 jieba 分词与查询侧同口径', async () => {
    await repo.replaceChunks(kbId, 'item-1', [
      row('cn', 0, '编译 userdebug 版本需要关闭 selinux 权限'),
    ]);
    // 中文词（jieba 应切出「编译」「版本」）
    expect((await search.keywordSearch(kbId, '编译', 5)).length).toBeGreaterThan(0);
    expect((await search.keywordSearch(kbId, '版本', 5)).length).toBeGreaterThan(0);
    // 中英混排里的英文词
    expect((await search.keywordSearch(kbId, 'userdebug', 5)).length).toBeGreaterThan(0);
    // 不相关的词搜不到
    expect(await search.keywordSearch(kbId, '完全不相干的词汇', 5)).toHaveLength(0);
  });

  it('向量 BLOB 往返无损（float32 精度）', async () => {
    const vector = [0.123456, -0.987654, 1.5, 0];
    await repo.replaceChunks(kbId, 'item-1', [row('v0', 0, '带向量的分块', vector)]);

    const db = await service.getDb(kbId);
    const stored = db
      .prepare(`SELECT embedding, embedding_dimensions FROM chunk WHERE id = 'v0'`)
      .get() as { embedding: Buffer; embedding_dimensions: number };
    expect(stored.embedding_dimensions).toBe(4);
    const floats = new Float32Array(
      stored.embedding.buffer,
      stored.embedding.byteOffset,
      stored.embedding.byteLength / 4,
    );
    expect(Math.abs(floats[0] - 0.123456)).toBeLessThan(1e-6);
    expect(Math.abs(floats[1] + 0.987654)).toBeLessThan(1e-6);
  });

  it('updateEmbeddings 只补向量，不动正文与 FTS', async () => {
    await repo.replaceChunks(kbId, 'item-1', [row('no-vec', 0, '待补向量的正文')]);

    // 补向量前：语义搜不到，关键词能搜到
    expect(
      (await search.semanticSearch(kbId, [1, 0, 0], 10)).some((r) => r.id === 'no-vec'),
    ).toBe(false);
    expect(await search.keywordSearch(kbId, '待补向量', 5)).toHaveLength(1);

    const written = await repo.updateEmbeddings(kbId, ['no-vec'], [[1, 0, 0]]);
    expect(written).toBe(1);

    // 补向量后：语义能搜到，正文与 FTS 不受影响
    expect(
      (await search.semanticSearch(kbId, [1, 0, 0], 10)).some((r) => r.id === 'no-vec'),
    ).toBe(true);
    expect((await repo.findById(kbId, 'no-vec'))?.content).toBe('待补向量的正文');
    expect(await search.keywordSearch(kbId, '待补向量', 5)).toHaveLength(1);
  });

  it('deleteMany 批量删多个条目（文件夹删除用），FTS 同步清空', async () => {
    await fileRepo.create(kbId, { id: 'item-2', displayName: 'g.txt', fileType: 'text' });
    await repo.replaceChunks(kbId, 'item-1', [row('a0', 0, '甲条目内容')]);
    await repo.replaceChunks(kbId, 'item-2', [row('b0', 0, '乙条目内容')]);

    const deleted = await repo.deleteMany(kbId, ['item-1', 'item-2']);
    expect(deleted).toBe(2);
    expect(await repo.countByItemId(kbId, 'item-1')).toBe(0);
    expect(await repo.countByItemId(kbId, 'item-2')).toBe(0);
    expect(await search.keywordSearch(kbId, '甲条目', 5)).toHaveLength(0);
    expect(await search.keywordSearch(kbId, '乙条目', 5)).toHaveLength(0);
  });

  it('deleteAll 清空整库分块与 FTS', async () => {
    await repo.replaceChunks(kbId, 'item-1', [
      row('x0', 0, '内容一'),
      row('x1', 1, '内容二'),
    ]);
    await repo.deleteAll(kbId);

    expect(await repo.countByItemId(kbId, 'item-1')).toBe(0);
    const db = await service.getDb(kbId);
    const ftsCount = (
      db.prepare(`SELECT COUNT(*) c FROM chunk_fts`).get() as { c: number }
    ).c;
    expect(ftsCount).toBe(0);
  });

  it('替换失败时整个事务回滚（不留半套分块）', async () => {
    await repo.replaceChunks(kbId, 'item-1', [row('keep-0', 0, '原有内容')]);

    // 构造一个必然失败的批次：同批次两条相同 id（主键冲突）
    const bad = [row('dup', 0, '新内容一'), row('dup', 1, '新内容二')];
    let failure: unknown = null;
    try {
      await repo.replaceChunks(kbId, 'item-1', bad);
    } catch (err) {
      failure = err;
    }

    expect(failure).not.toBeNull();

    // 关键不变量：失败后旧数据必须原样保留（删除与插入一起回滚）。
    // 旧实现是「先删向量库、再删 JSONL、再写新文件」，中间失败就留下空库。
    const chunks = await repo.findByItemId(kbId, 'item-1', 0, 10);
    expect(chunks.map((c) => c.id)).toEqual(['keep-0']);
    expect(chunks[0].content).toBe('原有内容');
    // FTS 也必须是旧状态（不能出现新内容的幽灵行）
    expect(await search.keywordSearch(kbId, '新内容', 10)).toHaveLength(0);
    expect(await search.keywordSearch(kbId, '原有内容', 10)).toHaveLength(1);
  });

  it('跨库隔离：同 id 分块互不影响（每库一个 kb.db）', async () => {
    const otherKb = 'kb-other';
    fs.mkdirSync(path.join(root, otherKb), { recursive: true });
    fs.writeFileSync(
      path.join(root, otherKb, 'kb.json'),
      JSON.stringify({ id: otherKb, name: 'other' }),
    );
    const otherFileRepo = new KBFileRepository(service);
    await otherFileRepo.create(otherKb, {
      id: 'item-1',
      displayName: 'same-name.txt',
      fileType: 'text',
    });

    await repo.replaceChunks(kbId, 'item-1', [row('shared-id', 0, 'A 库内容')]);
    await repo.replaceChunks(otherKb, 'item-1', [row('shared-id', 0, 'B 库内容')]);

    expect((await repo.findById(kbId, 'shared-id'))?.content).toBe('A 库内容');
    const otherRepo = new KBChunkRepository(service);
    expect((await otherRepo.findById(otherKb, 'shared-id'))?.content).toBe('B 库内容');
  });
});
