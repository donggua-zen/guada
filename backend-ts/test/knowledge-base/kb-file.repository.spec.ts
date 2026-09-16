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
import {
  KBFileRepository,
  KB_ITEM_ID_PREFIX,
} from '../../src/modules/knowledge-base/kb-file.repository';
import { KBChunkRepository } from '../../src/modules/knowledge-base/kb-chunk.repository';
import { KbSearchService } from '../../src/modules/knowledge-base/kb-search.service';

/**
 * 条目仓储测试
 *
 * 重点覆盖两类回归：
 * 1. **缺 id 生成**：旧实现 `String(data.id)` 在缺 id 时得到字面量 "undefined"，
 *    所有新建条目共用一个 file.json 互相覆盖（与 session store 同款缺陷）。
 * 2. **排序保真**：平铺按 uploadedAt 降序、目录树按"文件夹优先 → 名称 → id"，
 *    且名称比较必须用 localeCompare（SQLite 默认 collation 对中文/大小写结果不同）。
 */
describe('KBFileRepository', () => {
  let root: string;
  let service: KbDatabaseService;
  let repo: KBFileRepository;
  let chunkRepo: KBChunkRepository;
  const kbId = 'kb-test';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-item-'));
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
    repo = new KBFileRepository(service);
    chunkRepo = new KBChunkRepository(service);

    // env 是进程级（jest 复用 worker），断言库文件确实落在本用例的临时根下，
    // 避免其它 spec 泄漏 KB_DATA_DIR/USERDATA_DIR 造成偶发难查失败
    await service.getDb(kbId);
    expect(service.getDbPath(kbId).startsWith(root + path.sep)).toBe(true);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ============ id 生成（回归） ============

  it('缺 id 时生成 kbf-<uuid v4> 且互不相同（不再共用 undefined）', async () => {
    const a = await repo.create(kbId, { displayName: 'A' });
    const b = await repo.create(kbId, { displayName: 'B' });

    expect(a.id).not.toBe('undefined');
    expect(a.id.startsWith(KB_ITEM_ID_PREFIX)).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(await repo.countByKnowledgeBaseId(kbId)).toBe(2);

    // 两条都能按 id 取回，说明没有互相覆盖
    expect((await repo.findById(kbId, a.id))?.displayName).toBe('A');
    expect((await repo.findById(kbId, b.id))?.displayName).toBe('B');
  });

  it('显式 id 被保留（迁移/测试场景）', async () => {
    const row = await repo.create(kbId, { id: 'cuid-legacy-1', displayName: 'X' });
    expect(row.id).toBe('cuid-legacy-1');
    expect(await repo.findById(kbId, 'cuid-legacy-1')).not.toBeNull();
  });

  it.each(['undefined', 'null', '../escape', 'a/b', 'a\\b', '.hidden', 'bad:id'])(
    '非法 id 被拒绝且不落库：%s',
    async (bad) => {
      await expect(repo.create(kbId, { id: bad, displayName: 'X' })).rejects.toThrow(
        /非法/,
      );
      expect(await repo.countByKnowledgeBaseId(kbId)).toBe(0);
    },
  );

  // ============ 排序保真 ============

  it('平铺列表按 uploadedAt 降序 + id 升序（同刻）', async () => {
    await repo.create(kbId, {
      id: 'b',
      displayName: 'b',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });
    await repo.create(kbId, {
      id: 'a',
      displayName: 'a',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });
    await repo.create(kbId, {
      id: 'c',
      displayName: 'c',
      uploadedAt: '2026-02-01T00:00:00.000Z',
    });

    const { items, total } = await repo.findByKnowledgeBaseId(kbId, 0, 10);
    expect(total).toBe(3);
    // c 最新在前；a/b 同刻按 id 升序
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('目录树按「文件夹优先 → localeCompare 名称 → id」排序', async () => {
    // 含中文、大写、小写、数字，专门验证不是 SQLite BINARY collation
    const names = ['apple', 'Banana', '中文', '10 数字', 'Zebra'];
    for (const name of names) {
      await repo.create(kbId, { id: `f-${name}`, displayName: name, fileType: 'file' });
    }
    await repo.create(kbId, {
      id: 'd-folder',
      displayName: 'zzz-folder',
      isDirectory: true,
      fileType: 'directory',
    });

    const { items } = await repo.findByParentFolderId(kbId, null, 0, 50);

    // 文件夹恒在最前（即便名字排序靠后）
    expect(items[0].id).toBe('d-folder');
    // 其余按 localeCompare 升序
    const files = items.slice(1).map((i) => i.displayName);
    const expected = [...names].sort((a, b) => a.localeCompare(b));
    expect(files).toEqual(expected);
  });

  it('同级同名时按 id 决定顺序（稳定排序）', async () => {
    await repo.create(kbId, { id: 'z', displayName: '同名', fileType: 'file' });
    await repo.create(kbId, { id: 'a', displayName: '同名', fileType: 'file' });

    const { items } = await repo.findByParentFolderId(kbId, null, 0, 50);
    expect(items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('分页在内存排序之后切分（total 是全量匹配数）', async () => {
    for (let i = 0; i < 7; i++) {
      await repo.create(kbId, {
        id: `p${i}`,
        displayName: `p${i}`,
        fileType: 'file',
        uploadedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      });
    }
    const page1 = await repo.findByKnowledgeBaseId(kbId, 0, 3);
    const page2 = await repo.findByKnowledgeBaseId(kbId, 3, 3);
    expect(page1.total).toBe(7);
    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(3);
    // 最新在前：p6, p5, p4
    expect(page1.items.map((i) => i.id)).toEqual(['p6', 'p5', 'p4']);
    expect(page2.items.map((i) => i.id)).toEqual(['p3', 'p2', 'p1']);
  });

  // ============ 更新与级联 ============

  it('update 只改给定字段，其它字段保持', async () => {
    const row = await repo.create(kbId, {
      id: 'u1',
      displayName: 'old',
      contentHash: 'hash-1',
      fileSize: 123,
    });
    const updated = await repo.update(kbId, 'u1', { displayName: 'new' });
    expect(updated?.displayName).toBe('new');
    expect(updated?.contentHash).toBe('hash-1');
    expect(updated?.fileSize).toBe(123);
  });

  it('update 对不存在的 id 返回 null（不静默插入）', async () => {
    expect(await repo.update(kbId, 'nope', { displayName: 'x' })).toBeNull();
  });

  it('rewriteRelativePathPrefix 一条语句级联改前缀，且不动 parentFolderId', async () => {
    const folder = await repo.create(kbId, {
      id: 'folder',
      displayName: 'old',
      isDirectory: true,
      fileType: 'directory',
      relativePath: 'old',
    });
    const child = await repo.create(kbId, {
      id: 'child',
      displayName: 'c.txt',
      fileType: 'text',
      relativePath: 'old/c.txt',
      parentFolderId: 'folder',
    });
    const grand = await repo.create(kbId, {
      id: 'grand',
      displayName: 'g.txt',
      fileType: 'text',
      relativePath: 'old/sub/g.txt',
      parentFolderId: 'child',
    });
    // 前缀相似但不应被误改（oldish vs old/）
    const unrelated = await repo.create(kbId, {
      id: 'unrelated',
      displayName: 'u.txt',
      fileType: 'text',
      relativePath: 'oldish/u.txt',
    });

    const changed = await repo.rewriteRelativePathPrefix(kbId, 'old/', 'new/');
    expect(changed).toBe(2);

    expect((await repo.findById(kbId, 'child'))?.relativePath).toBe('new/c.txt');
    expect((await repo.findById(kbId, 'grand'))?.relativePath).toBe('new/sub/g.txt');
    expect((await repo.findById(kbId, 'unrelated'))?.relativePath).toBe('oldish/u.txt');
    // 指向关系不变
    expect((await repo.findById(kbId, 'child'))?.parentFolderId).toBe('folder');
    expect(folder.id).toBe('folder');
  });

  it('名称含 SQL 通配符 % _ 时前缀匹配不被误伤（用 substr 而非 LIKE）', async () => {
    await repo.create(kbId, {
      id: 'pct',
      displayName: 'a%b',
      isDirectory: true,
      fileType: 'directory',
      relativePath: 'a%b',
    });
    await repo.create(kbId, {
      id: 'pct-child',
      displayName: 'c.txt',
      fileType: 'text',
      relativePath: 'a%b/c.txt',
    });
    await repo.create(kbId, {
      id: 'other',
      displayName: 'axb.txt',
      fileType: 'text',
      relativePath: 'axb/c.txt',
    });

    const changed = await repo.rewriteRelativePathPrefix(kbId, 'a%b/', 'a%b-new/');
    expect(changed).toBe(1);
    expect((await repo.findById(kbId, 'pct-child'))?.relativePath).toBe(
      'a%b-new/c.txt',
    );
    expect((await repo.findById(kbId, 'other'))?.relativePath).toBe('axb/c.txt');
  });

  // ============ 查询 ============

  it('findByPathAndParent 区分同级同名与不同级同名', async () => {
    await repo.create(kbId, {
      id: 'root-a',
      displayName: 'a.txt',
      fileType: 'text',
      parentFolderId: null,
    });
    await repo.create(kbId, {
      id: 'sub-a',
      displayName: 'a.txt',
      fileType: 'text',
      parentFolderId: 'folder-x',
    });

    expect((await repo.findByPathAndParent(kbId, 'a.txt', null))?.id).toBe('root-a');
    expect((await repo.findByPathAndParent(kbId, 'a.txt', 'folder-x'))?.id).toBe(
      'sub-a',
    );
    expect(await repo.findByPathAndParent(kbId, 'a.txt', 'nope')).toBeNull();
  });

  it('findByIds 保持入参顺序并跳过不存在的 id', async () => {
    await repo.create(kbId, { id: 'x', displayName: 'x' });
    await repo.create(kbId, { id: 'y', displayName: 'y' });
    const rows = await repo.findByIds(kbId, ['y', 'missing', 'x']);
    expect(rows.map((r) => r.id)).toEqual(['y', 'x']);
  });

  it('跨库隔离：A 库的条目在 B 库查不到', async () => {
    const otherKb = 'kb-other';
    fs.mkdirSync(path.join(root, otherKb), { recursive: true });
    fs.writeFileSync(
      path.join(root, otherKb, 'kb.json'),
      JSON.stringify({ id: otherKb, name: 'other' }),
    );
    await repo.create(kbId, { id: 'only-in-a', displayName: 'a' });

    expect(await repo.findById(otherKb, 'only-in-a')).toBeNull();
    expect(await repo.countByKnowledgeBaseId(otherKb)).toBe(0);
  });

  it('删除条目后分块一并消失（同库同事务语义）', async () => {
    await repo.create(kbId, { id: 'i1', displayName: 'f.txt' });
    await chunkRepo.replaceChunks(kbId, 'i1', [
      {
        id: 'c0',
        vectorId: 'c0',
        chunkIndex: 0,
        content: '内容',
        tokenCount: 1,
        embedding: [1, 0, 0],
        embeddingDimensions: 3,
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await chunkRepo.deleteByItemId(kbId, 'i1');
    await repo.delete(kbId, 'i1');

    expect(await repo.findById(kbId, 'i1')).toBeNull();
    expect(await chunkRepo.countByItemId(kbId, 'i1')).toBe(0);
    // FTS 也应清干净（否则搜出幽灵结果）
    const search = new KbSearchService(service);
    const hits = await search.keywordSearch(kbId, '内容', 10);
    expect(hits).toHaveLength(0);
  });
});
