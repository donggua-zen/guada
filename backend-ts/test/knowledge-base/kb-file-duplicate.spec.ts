import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  KbDatabaseService,
  setConfiguredKbRoot,
} from '../../src/modules/knowledge-base/kb-database.service';
import { KbMetaStore } from '../../src/modules/knowledge-base/kb-meta.store';
import { KBFileRepository } from '../../src/modules/knowledge-base/kb-file.repository';
import { KBChunkRepository } from '../../src/modules/knowledge-base/kb-chunk.repository';
import { KbFileService } from '../../src/modules/knowledge-base/kb-file.service';

/**
 * 内容重复检测（`item.content_hash` 的首次真正使用）
 *
 * ## 背景
 *
 * `content_hash` 在上传时就被算出来并落库，但**全项目从未读过它**——于是同一份文件
 * 重复上传会重复解析、重复 OCR、重复嵌入、重复占空间，检索结果里还会出现重复条目。
 *
 * 现在按 `onDuplicate` 三档处理，且**默认档保持原行为**（照常新建），避免老调用方
 * 突然发现文件"上传失败"：
 *
 * - `keep-both`（默认）：新建，响应带 `duplicateOf`
 * - `skip`：不新建，返回已存在的那条（`skipped: true`）
 * - `overwrite`：先删旧的（含分块/向量/原件）再新建
 *
 * ## 测试策略
 *
 * 用**真实仓储 + 真实 sqlite**（重复检测的核心是 SQL 与事务，桩掉就测不到），
 * 只桩掉解析/分块/嵌入三个重依赖——它们与去重逻辑无关。
 */

/** 解析/分块/嵌入的最小桩：产出 1 个分块 + 1 个 3 维向量 */
function stubs() {
  const parserService = {
    detectFileType: jest.fn(async () => 'text'),
    parseFile: jest.fn(async () => ({ text: '内容', pages: [{ pageNum: 1, text: '内容' }] })),
  };
  const chunkingService = {
    chunkPages: jest.fn(async () => [
      {
        content: '内容',
        chunkIndex: 0,
        metadata: { overlapLength: 0, chunkSize: 2, tokenCount: 1, strategy: 'sentence-v2' },
      },
    ]),
    countTokens: jest.fn(async () => 1),
  };
  const embeddingService = {
    getEmbeddings: jest.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
    getEmbedding: jest.fn(async () => [1, 0, 0]),
  };
  return { parserService, chunkingService, embeddingService };
}

describe('KbFileService 内容重复检测', () => {
  let root: string;
  let databases: KbDatabaseService;
  let metaStore: KbMetaStore;
  let fileRepo: KBFileRepository;
  let chunkRepo: KBChunkRepository;
  let service: KbFileService;
  const kbId = 'kb_dup';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-dup-'));
    process.env.KB_DATA_DIR = root;
    setConfiguredKbRoot(null);
    databases = new KbDatabaseService();
    metaStore = new KbMetaStore(databases);
    fileRepo = new KBFileRepository(databases);
    chunkRepo = new KBChunkRepository(databases);
    const { parserService, chunkingService, embeddingService } = stubs();

    await metaStore.createKb({
      id: kbId,
      name: '去重测试库',
      embeddingModelId: 'p:m',
    });

    service = new KbFileService(
      { findModel: () => ({ provider: { apiUrl: '', apiKey: '' }, modelName: 'm' }) } as any,
      metaStore,
      fileRepo,
      chunkRepo,
      databases,
      parserService as any,
      embeddingService as any,
      chunkingService as any,
    );
  });

  afterEach(async () => {
    await databases.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function fakeUpload(name: string, content: string) {
    return { originalname: name, buffer: Buffer.from(content, 'utf8') };
  }

  /** 等后台处理链跑完（静态 Promise 信号量，串行） */
  async function drain() {
    for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  }

  it('首次上传不报重复', async () => {
    const res: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'hello'));
    expect(res.duplicateOf).toBeNull();
    expect(res.skipped).toBeUndefined();
    await drain();
  });

  it('默认 keep-both：仍新建，但回报 duplicateOf 指向已有条目', async () => {
    const first: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'same-bytes'));
    await drain();
    const second: any = await service.uploadFile(kbId, fakeUpload('b.txt', 'same-bytes'));

    expect(second.duplicateOf).toBe(first.id);
    expect(second.skipped).toBeUndefined();
    // 两条都在（默认不改行为）
    const { items, total } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    expect(total).toBe(2);
    expect(items.map((i) => i.id)).toContain(first.id);
    expect(items.map((i) => i.id)).toContain(second.id);
    await drain();
  });

  it('skip：不新建，返回已存在的那条', async () => {
    const first: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'dup-bytes'));
    await drain();
    const second: any = await service.uploadFile(
      kbId,
      fakeUpload('b.txt', 'dup-bytes'),
      undefined,
      'skip',
    );

    expect(second.skipped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.duplicateOf).toBe(first.id);

    const { total } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    expect(total).toBe(1);
  });

  it('overwrite：先删旧条目（含分块与原件）再新建', async () => {
    const first: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'over-bytes'));
    await drain();

    // 旧条目应该已经有分块与原件
    expect(await chunkRepo.countByItemId(kbId, first.id)).toBeGreaterThan(0);
    expect(fs.existsSync(databases.getItemRawDir(kbId, first.id))).toBe(true);

    const second: any = await service.uploadFile(
      kbId,
      fakeUpload('a.txt', 'over-bytes'),
      undefined,
      'overwrite',
    );
    await drain();

    expect(second.id).not.toBe(first.id);
    // 旧条目与它的分块、原件都该没了
    expect(await fileRepo.findById(kbId, first.id)).toBeNull();
    expect(await chunkRepo.countByItemId(kbId, first.id)).toBe(0);
    expect(fs.existsSync(databases.getItemRawDir(kbId, first.id))).toBe(false);

    const { total } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    expect(total).toBe(1);
  });

  it('不同内容不判为重复', async () => {
    const a: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'content-A'));
    await drain();
    const b: any = await service.uploadFile(kbId, fakeUpload('b.txt', 'content-B'));
    await drain();

    expect(a.duplicateOf).toBeNull();
    expect(b.duplicateOf).toBeNull();
    const { total } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    expect(total).toBe(2);
  });

  it('非法 onDuplicate 值按默认 keep-both 处理（不抛错）', async () => {
    const first: any = await service.uploadFile(kbId, fakeUpload('a.txt', 'x-bytes'));
    await drain();
    const second: any = await service.uploadFile(
      kbId,
      fakeUpload('b.txt', 'x-bytes'),
      undefined,
      'nonsense' as any,
    );

    expect(second.duplicateOf).toBe(first.id);
    expect(second.skipped).toBeUndefined();
    await drain();
  });

  it('addTextDocument 同样支持去重', async () => {
    const src = path.join(root, 'src.md');
    fs.writeFileSync(src, '文档内容', 'utf8');

    const first: any = await service.addTextDocument(kbId, src, 'docs/a.md');
    await drain();
    const second: any = await service.addTextDocument(kbId, src, 'docs/b.md', 'skip');

    expect(second.skipped).toBe(true);
    expect(second.id).toBe(first.id);

    // 注意：`docs/a.md` 会顺带建出 `docs` 文件夹节点，所以总数含文件夹，这里只数文件
    const { items } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    const files = items.filter((i) => !i.isDirectory);
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(first.id);
  });

  it('文件列表带上分块策略标记（前端据此提示旧方案）', async () => {
    await service.uploadFile(kbId, fakeUpload('a.md', 'md-content'));
    await drain();

    const { items } = await fileRepo.findByKnowledgeBaseId(kbId, 0, 50);
    const list = await service.listFiles(kbId, 0, 50);

    expect(list.items).toHaveLength(items.length);
    const item: any = list.items[0];
    // 桩的分块服务产出 sentence-v2 → 属当前版本，不应提示过时
    expect(item.chunkStrategy).toBe('sentence-v2');
    expect(item.chunkStrategyOutdated).toBe(false);
  });
});
