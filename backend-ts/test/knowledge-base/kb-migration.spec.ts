import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  KbDatabaseService,
  setConfiguredKbRoot,
} from '../../src/modules/knowledge-base/kb-database.service';
import {
  META_DOMAIN_KB,
  MetadataBootstrapGate,
} from '../../src/common/database/metadata-bootstrap.gate';
import { KbMetaStore } from '../../src/modules/knowledge-base/kb-meta.store';
import { KBFileRepository } from '../../src/modules/knowledge-base/kb-file.repository';
import { KBChunkRepository } from '../../src/modules/knowledge-base/kb-chunk.repository';
import {
  KbMigrationBootstrapService,
  KB_PRE_SQLITE_DIR,
  KB_SQLITE_MIGRATED_MARKER,
} from '../../src/common/database/bootstrap/kb-migration-bootstrap.service';
import { KB_DB_FILE } from '../../src/modules/knowledge-base/kb-schema';

/**
 * 知识库迁移导入器测试
 *
 * 迁移是本次改动风险最高的一步（可能丢用户数据），因此重点验证：
 * - 两种历史形态（旧 file.json / 冻结主库）都能导入
 * - 原件**移动**进库内 raw/（不额外占盘），无人引用的文件**只报告不删**
 * - 逐库幂等：重复运行不重复导入，已迁好的库不会被按旧形态重导（会丢条目）
 * - 切换可回滚：旧目录保留在 .pre-sqlite/
 * - 向量按 chunk id 对齐；缺失时留 NULL 并保留正文（可事后 kb:reembed）
 */
describe('KbMigrationBootstrapService', () => {
  let root: string;
  let dataRoot: string;
  let uploadRoot: string;
  let gate: MetadataBootstrapGate;
  let service: KbDatabaseService;

  /** 造一个旧的 file.json 形态知识库 */
  function makeLegacyKb(kbId: string): void {
    const kbDir = path.join(root, kbId);
    fs.mkdirSync(path.join(kbDir, 'item-1'), { recursive: true });
    fs.mkdirSync(path.join(kbDir, 'folder-1'), { recursive: true });
    fs.writeFileSync(
      path.join(kbDir, 'kb.json'),
      JSON.stringify({
        id: kbId,
        name: '旧库',
        embeddingModelId: 'provider:model',
        chunkMaxSize: 800,
        chunkOverlapSize: 80,
        chunkMinSize: 40,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    );

    // 有原件的文件条目
    const rawSource = path.join(uploadRoot, 'knowledge-base', '20260101', 'doc.txt');
    fs.mkdirSync(path.dirname(rawSource), { recursive: true });
    fs.writeFileSync(rawSource, '原件内容');

    fs.writeFileSync(
      path.join(kbDir, 'item-1', 'file.json'),
      JSON.stringify({
        id: 'item-1',
        knowledgeBaseId: kbId,
        fileName: 'doc.txt',
        displayName: 'doc.txt',
        fileSize: 12,
        fileType: 'text',
        fileExtension: 'txt',
        contentHash: 'hash-1',
        filePath: rawSource,
        relativePath: 'doc.txt',
        parentFolderId: null,
        isDirectory: false,
        processingStatus: 'completed',
        progressPercentage: 100,
        currentStep: '处理完成',
        errorMessage: null,
        totalChunks: 2,
        totalTokens: 20,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        processedAt: '2026-01-01T00:10:00.000Z',
      }),
    );
    fs.writeFileSync(
      path.join(kbDir, 'folder-1', 'file.json'),
      JSON.stringify({
        id: 'folder-1',
        knowledgeBaseId: kbId,
        fileName: 'folder-1',
        displayName: '资料',
        fileSize: 0,
        fileType: 'directory',
        fileExtension: '',
        contentHash: '',
        filePath: null,
        relativePath: '资料',
        parentFolderId: null,
        isDirectory: true,
        processingStatus: 'completed',
        progressPercentage: 100,
        currentStep: '文件夹节点',
        errorMessage: null,
        totalChunks: 0,
        totalTokens: 0,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        processedAt: null,
      }),
    );

    // chunks.jsonl（旧分块正本，无向量——向量在全局向量库里）
    const chunks = [
      {
        id: 'chunk_0_item-1',
        vectorId: 'chunk_0_item-1',
        chunkIndex: 0,
        content: '第一段：编译 userdebug 版本',
        tokenCount: 10,
        embeddingDimensions: 3,
        metadata: { fileId: 'item-1', knowledgeBaseId: kbId, fileName: 'doc.txt' },
        createdAt: '2026-01-01T00:05:00.000Z',
      },
      {
        id: 'chunk_1_item-1',
        vectorId: 'chunk_1_item-1',
        chunkIndex: 1,
        content: '第二段：关闭 selinux 权限',
        tokenCount: 10,
        embeddingDimensions: 3,
        metadata: { fileId: 'item-1', knowledgeBaseId: kbId, fileName: 'doc.txt' },
        createdAt: '2026-01-01T00:05:00.000Z',
      },
    ];
    fs.writeFileSync(
      path.join(kbDir, 'item-1', 'chunks.jsonl'),
      chunks.map((c) => JSON.stringify(c)).join('\n') + '\n',
    );
  }

  /** 造一个旧全局向量库（带两条分块的向量） */
  function makeLegacyVectorDb(): string {
    const dbPath = path.join(dataRoot, 'vector_db.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE kb_legacy (id TEXT PRIMARY KEY, document_id TEXT, content TEXT, embedding BLOB, metadata_json TEXT);
      CREATE VIRTUAL TABLE kb_legacy_fts USING fts5(content, content_rowid='rowid');
    `);
    const insert = db.prepare(
      `INSERT INTO kb_legacy (id, document_id, content, embedding, metadata_json) VALUES (?,?,?,?,?)`,
    );
    for (const [id, content] of [
      ['chunk_0_item-1', '第一段：编译 userdebug 版本'],
      ['chunk_1_item-1', '第二段：关闭 selinux 权限'],
    ]) {
      insert.run(
        id,
        'item-1',
        content,
        Buffer.from(new Float32Array([0.5, 0.5, 0.5]).buffer),
        '{}',
      );
    }
    db.close();
    return dbPath;
  }

  function makeImporter(
    prismaLike: any = { knowledgeBase: { findMany: async () => [] }, kBFile: { findMany: async () => [] }, kBChunk: { findMany: async () => [] } },
  ): KbMigrationBootstrapService {
    const svc = new KbMigrationBootstrapService(prismaLike, gate);
    // 构造器已自持构造 KB 数据层；这里用本 spec 统一管理连接的实例覆盖
    // （readonly 仅编译期约束；自持实例未开过任何连接，直接丢弃无句柄泄漏）
    (svc as any).databases = service;
    (svc as any).kbMetaStore = new KbMetaStore(service);
    (svc as any).fileRepo = new KBFileRepository(service);
    (svc as any).chunkRepo = new KBChunkRepository(service);
    return svc;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migrate-'));
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migrate-data-'));
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migrate-up-'));

    process.env.KB_DATA_DIR = root;
    process.env.UPLOAD_ROOT_DIR = uploadRoot;
    process.env.VECTOR_DB_PATH = path.join(dataRoot, 'vector_db.sqlite');
    setConfiguredKbRoot(null);

    gate = new MetadataBootstrapGate();
    service = new KbDatabaseService(gate);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    delete process.env.KB_DATA_DIR;
    delete process.env.UPLOAD_ROOT_DIR;
    delete process.env.VECTOR_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(uploadRoot, { recursive: true, force: true });
  });

  it('旧 file.json 形态 → kb.db：条目、分块、原件、元信息全部就位', async () => {
    makeLegacyKb('legacy-1');
    await makeImporter().run();

    const kbDir = path.join(root, 'legacy-1');
    expect(fs.existsSync(path.join(kbDir, KB_DB_FILE))).toBe(true);
    expect(fs.existsSync(path.join(root, KB_SQLITE_MIGRATED_MARKER))).toBe(true);

    // 旧形态目录被移走（备份），而不是留在原地冒充新库
    expect(fs.existsSync(path.join(kbDir, 'item-1', 'file.json'))).toBe(false);
    const backup = path.join(root, KB_PRE_SQLITE_DIR, 'legacy-1');
    expect(fs.existsSync(path.join(backup, 'item-1', 'file.json'))).toBe(true);

    const fileRepo = new KBFileRepository(service);
    const item = await fileRepo.findById('legacy-1', 'item-1');
    expect(item).not.toBeNull();
    expect(item!.displayName).toBe('doc.txt');
    expect(item!.contentHash).toBe('hash-1');
    expect(item!.totalChunks).toBe(2);
    // 原件移入库内，来源路径留作"重新摄取"提示
    expect(item!.rawName).toBe('doc.txt');
    expect(
      fs.existsSync(path.join(kbDir, 'raw', 'item-1', 'doc.txt')),
    ).toBe(true);
    expect(item!.sourcePath).toBe(
      path.join(uploadRoot, 'knowledge-base', '20260101', 'doc.txt'),
    );
    // 共享上传目录里的原件已被**移走**（不是复制）
    expect(
      fs.existsSync(path.join(uploadRoot, 'knowledge-base', '20260101', 'doc.txt')),
    ).toBe(false);

    // 文件夹条目保留目录语义
    const folder = await fileRepo.findById('legacy-1', 'folder-1');
    expect(folder!.isDirectory).toBe(true);
    expect(folder!.displayName).toBe('资料');

    // 分块正文导入且可搜
    const chunkRepo = new KBChunkRepository(service);
    expect(await chunkRepo.countByItemId('legacy-1', 'item-1')).toBe(2);

    // KB 配置保留（含 chunk 参数）
    const metaStore = new KbMetaStore(service);
    const meta = await metaStore.getKbMeta('legacy-1');
    expect(meta!.chunkMaxSize).toBe(800);
    expect(meta!.embeddingModelId).toBe('provider:model');
  });

  it('向量按 chunk id 对齐从旧全局向量库搬运', async () => {
    makeLegacyKb('legacy-1');
    makeLegacyVectorDb();
    await makeImporter().run();

    const db = await service.getDb('legacy-1');
    const rows = db
      .prepare(`SELECT id, embedding, embedding_dimensions FROM chunk ORDER BY chunk_index`)
      .all() as Array<{ id: string; embedding: Buffer | null; embedding_dimensions: number | null }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.embedding).not.toBeNull();
      expect(r.embedding_dimensions).toBe(3);
    }

    // 旧向量库改名保留（可回滚），不删除
    expect(fs.existsSync(path.join(dataRoot, 'vector_db.sqlite'))).toBe(false);
    expect(
      fs.existsSync(path.join(dataRoot, 'vector_db.sqlite.pre-sqlite')),
    ).toBe(true);
  });

  it('向量缺失时留 NULL 且正文可用（可事后 kb:reembed，不必重新解析）', async () => {
    makeLegacyKb('legacy-1'); // 不造向量库
    await makeImporter().run();

    const db = await service.getDb('legacy-1');
    const rows = db
      .prepare(`SELECT id, content, embedding FROM chunk`)
      .all() as Array<{ id: string; content: string; embedding: Buffer | null }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.embedding).toBeNull();
      expect(r.content.length).toBeGreaterThan(0);
    }

    // 关键词搜索仍可用（正文与 FTS 都在）
    const search = new (require('../../src/modules/knowledge-base/kb-search.service').KbSearchService)(service);
    expect((await search.keywordSearch('legacy-1', 'selinux', 5)).length).toBe(1);
  });

  it('逐库幂等：重复运行不重复导入，已迁库不被按旧形态重导', async () => {
    makeLegacyKb('legacy-1');
    await makeImporter().run();

    const fileRepo = new KBFileRepository(service);
    const before = await fileRepo.countByKnowledgeBaseId('legacy-1');
    expect(before).toBe(2);

    // 第二次运行：marker 已存在 → 直接放行
    await makeImporter().run();
    expect(await fileRepo.countByKnowledgeBaseId('legacy-1')).toBe(2);

    // 抹掉 marker 强制走导入逻辑：已迁好的库应被识别为"已是 kb.db 形态"并跳过
    fs.rmSync(path.join(root, KB_SQLITE_MIGRATED_MARKER));
    await service.close('legacy-1');
    await makeImporter().run();
    expect(await fileRepo.countByKnowledgeBaseId('legacy-1')).toBe(2);
  });

  it('冻结主库来源：knowledge_base / kb_file / kb_chunk 被导入', async () => {
    const prismaLike = {
      knowledgeBase: {
        findMany: async () => [
          {
            id: 'db-kb-1',
            name: '主库库',
            description: '来自冻结表',
            embeddingModelId: 'p:m',
            chunkMaxSize: 1000,
            chunkOverlapSize: 100,
            chunkMinSize: 50,
            isActive: true,
            isPublic: false,
            metadataConfig: null,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-02T00:00:00.000Z'),
          },
        ],
      },
      kBFile: {
        findMany: async () => [
          {
            id: 'db-item-1',
            knowledgeBaseId: 'db-kb-1',
            fileName: 'db.txt',
            displayName: 'db.txt',
            fileSize: 5,
            fileType: 'text',
            fileExtension: 'txt',
            contentHash: 'h',
            filePath: null,
            relativePath: 'db.txt',
            parentFolderId: null,
            isDirectory: false,
            processingStatus: 'completed',
            progressPercentage: 100,
            currentStep: null,
            errorMessage: null,
            totalChunks: 1,
            totalTokens: 5,
            uploadedAt: new Date('2026-03-01T00:00:00.000Z'),
            processedAt: null,
          },
        ],
      },
      kBChunk: {
        findMany: async () => [
          {
            id: 'chunk_0_db-item-1',
            fileId: 'db-item-1',
            chunkIndex: 0,
            content: '主库里的分块内容',
            tokenCount: 5,
            vectorId: 'chunk_0_db-item-1',
            embeddingDimensions: null,
            metadata: null,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        ],
      },
    };

    await makeImporter(prismaLike).run();

    const metaStore = new KbMetaStore(service);
    expect((await metaStore.getKbMeta('db-kb-1'))?.name).toBe('主库库');

    const fileRepo = new KBFileRepository(service);
    expect((await fileRepo.findById('db-kb-1', 'db-item-1'))?.displayName).toBe('db.txt');

    const chunkRepo = new KBChunkRepository(service);
    expect(await chunkRepo.countByItemId('db-kb-1', 'db-item-1')).toBe(1);
  });

  it('共享上传目录里无人引用的文件只报告不删', async () => {
    makeLegacyKb('legacy-1');
    // 造一个没有任何元信息引用的孤儿文件
    const orphan = path.join(uploadRoot, 'knowledge-base', '20250101', 'orphan.pdf');
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, '无人引用');

    await makeImporter().run();

    // 孤儿文件仍在（那是用户的字节，不自动删）
    expect(fs.existsSync(orphan)).toBe(true);
    // 清单落盘供人工处理
    const listPath = path.join(root, 'orphan-uploads.txt');
    expect(fs.existsSync(listPath)).toBe(true);
    expect(fs.readFileSync(listPath, 'utf8')).toContain('orphan.pdf');
  });

  it('中断迁移留下的空 kb.db 不阻止真正导入（回归：按内容而非文件存在判断）', async () => {
    makeLegacyKb('legacy-1');

    // 模拟"启动期对账建了空库、导入尚未跑完就被打断"：只有表、没有行
    const kbDir = path.join(root, 'legacy-1');
    const emptyDb = new Database(path.join(kbDir, KB_DB_FILE));
    emptyDb.pragma('journal_mode = WAL');
    emptyDb.close();

    await makeImporter().run();

    // 条目必须真的被导入（若按"kb.db 存在就跳过"，这里会是 0）
    const fileRepo = new KBFileRepository(service);
    expect(await fileRepo.countByKnowledgeBaseId('legacy-1')).toBe(2);
    const item = await fileRepo.findById('legacy-1', 'item-1');
    expect(item!.displayName).toBe('doc.txt');
    expect(item!.rawName).toBe('doc.txt');
  });

  it('原件缺失的历史残留行仍建条目并标记 failed（界面上可见可删，不静默丢失）', async () => {
    const prismaLike = {
      knowledgeBase: { findMany: async () => [] },
      kBFile: {
        findMany: async () => [
          {
            id: 'stale-1',
            knowledgeBaseId: 'db-kb-1',
            fileName: 'gone.txt',
            displayName: 'gone.txt',
            fileSize: 9,
            fileType: 'text',
            fileExtension: 'txt',
            contentHash: 'h',
            // 指向一个不存在的文件（历史残留）
            filePath: path.join(uploadRoot, 'knowledge-base', '20200101', 'gone.txt'),
            relativePath: 'gone.txt',
            parentFolderId: null,
            isDirectory: false,
            processingStatus: 'completed',
            progressPercentage: 100,
            currentStep: '处理完成',
            errorMessage: null,
            totalChunks: 3,
            totalTokens: 30,
            uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
            processedAt: null,
          },
        ],
      },
      kBChunk: { findMany: async () => [] },
    };
    // kb 配置得先存在，否则该库不会进入导入循环
    await new KBChunkRepository(service); // 仅为保持依赖引用（无副作用）
    const metaStore = new KbMetaStore(service);
    await metaStore.writeKbDirect({
      id: 'db-kb-1',
      name: '残留库',
      description: null,
      embeddingModelId: 'p:m',
      chunkMaxSize: 1000,
      chunkOverlapSize: 100,
      chunkMinSize: 50,
      isActive: true,
      isPublic: false,
      metadataConfig: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await makeImporter(prismaLike).run();

    const fileRepo = new KBFileRepository(service);
    const item = await fileRepo.findById('db-kb-1', 'stale-1');
    expect(item).not.toBeNull();
    expect(item!.processingStatus).toBe('failed');
    expect(item!.currentStep).toBe('迁移时未找到原件');
    expect(item!.errorMessage).toContain('迁移时未找到原件');
    expect(item!.rawName).toBeNull();
  });

  it('冻结表读成 snake_case 行也能正确导入（回归：字段名形状不匹配会静默丢条目）', async () => {
    // 离线脚本/直接 open sqlite 时拿到的是原始列名（knowledge_base_id、is_directory=0/1）。
    // 第一版只认 Prisma 的 camelCase，导致 kbId 为 undefined、条目被整条跳过且不报错。
    const snakeRows = {
      knowledgeBase: {
        findMany: async () => [
          {
            id: 'snake-kb',
            name: '下划线库',
            embedding_model_id: 'p:m',
            chunk_max_size: 900,
            chunk_overlap_size: 90,
            chunk_min_size: 45,
            is_active: 1,
            is_public: 0,
            metadata_config: null,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-02T00:00:00.000Z',
          },
        ],
      },
      kBFile: {
        findMany: async () => [
          {
            id: 'snake-item',
            knowledge_base_id: 'snake-kb',
            file_name: 's.txt',
            display_name: 's.txt',
            file_size: 7,
            file_type: 'text',
            file_extension: 'txt',
            content_hash: 'h2',
            file_path: null,
            relative_path: 's.txt',
            parent_folder_id: null,
            is_directory: 0,
            processing_status: 'completed',
            progress_percentage: 100,
            current_step: null,
            error_message: null,
            total_chunks: 1,
            total_tokens: 7,
            uploaded_at: '2026-04-01T00:00:00.000Z',
            processed_at: null,
          },
        ],
      },
      kBChunk: {
        findMany: async () => [
          {
            id: 'chunk_0_snake-item',
            file_id: 'snake-item',
            chunk_index: 0,
            content: '下划线来源的分块',
            token_count: 7,
            vector_id: 'chunk_0_snake-item',
            embedding_dimensions: null,
            metadata: null,
            created_at: '2026-04-01T00:00:00.000Z',
          },
        ],
      },
    };

    await makeImporter(snakeRows).run();

    const metaStore = new KbMetaStore(service);
    const meta = await metaStore.getKbMeta('snake-kb');
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('下划线库');
    expect(meta!.chunkMaxSize).toBe(900);

    const fileRepo = new KBFileRepository(service);
    const item = await fileRepo.findById('snake-kb', 'snake-item');
    expect(item).not.toBeNull();
    expect(item!.isDirectory).toBe(false);
    expect(item!.displayName).toBe('s.txt');

    const chunkRepo = new KBChunkRepository(service);
    expect(await chunkRepo.countByItemId('snake-kb', 'snake-item')).toBe(1);
  });

  it('主库不可读时不阻塞启动（放行门控但不落 marker，下次重试）', async () => {
    const prismaLike = {
      knowledgeBase: { findMany: async () => { throw new Error('db locked'); } },
      kBFile: { findMany: async () => { throw new Error('db locked'); } },
      kBChunk: { findMany: async () => { throw new Error('db locked'); } },
    };

    // 不该抛
    await expect(makeImporter(prismaLike).run()).resolves.toBeUndefined();
    // 门控必须放行，否则所有 KB 读会挂到 30s 超时
    expect(gate.isCompleted(META_DOMAIN_KB)).toBe(true);
  });
});
