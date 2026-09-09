/// <reference types="jest" />

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KbChunkFileStore, KbChunkFileRow } from '../../src/modules/knowledge-base/kb-chunk-file.store';

function createMockChunkRepo() {
  return {
    findByFileId: jest.fn().mockResolvedValue([]),
  };
}

function makeRow(index: number, fileId: string, content?: string): KbChunkFileRow {
  return {
    id: `chunk_${index}_${fileId}`,
    vectorId: `chunk_${index}_${fileId}`,
    chunkIndex: index,
    content: content ?? `分段内容 ${index}`,
    tokenCount: 100 + index,
    embeddingDimensions: 4096,
    metadata: {
      fileId,
      knowledgeBaseId: 'kb1',
      fileName: '测试文档.pdf',
      overlapLength: 10,
      strategy: 'token',
    },
    createdAt: '2026-09-09T00:00:00.000Z',
  };
}

describe('KbChunkFileStore', () => {
  let store: KbChunkFileStore;
  let mockRepo: ReturnType<typeof createMockChunkRepo>;
  let tmpRoot: string;
  let originalEnv: { KB_DATA_DIR?: string; USERDATA_DIR?: string };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-chunk-store-'));
    originalEnv = {
      KB_DATA_DIR: process.env.KB_DATA_DIR,
      USERDATA_DIR: process.env.USERDATA_DIR,
    };
    process.env.KB_DATA_DIR = tmpRoot;
    delete process.env.USERDATA_DIR;
    mockRepo = createMockChunkRepo();
    store = new KbChunkFileStore(mockRepo as any);
  });

  afterEach(async () => {
    if (originalEnv.KB_DATA_DIR === undefined) {
      delete process.env.KB_DATA_DIR;
    } else {
      process.env.KB_DATA_DIR = originalEnv.KB_DATA_DIR;
    }
    if (originalEnv.USERDATA_DIR === undefined) {
      delete process.env.USERDATA_DIR;
    } else {
      process.env.USERDATA_DIR = originalEnv.USERDATA_DIR;
    }
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  describe('writeChunks / readChunks', () => {
    it('应该写入 JSONL 并能完整读回', async () => {
      const rows = [makeRow(0, 'f1'), makeRow(1, 'f1'), makeRow(2, 'f1')];
      await store.writeChunks('kb1', 'f1', rows);

      const filePath = path.join(tmpRoot, 'kb1', 'f1', 'chunks.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);
      // 不应残留 tmp 文件
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);

      const view = await store.readChunks('kb1', 'f1', 0, 10);
      expect(view).toHaveLength(3);
      expect(view[0]).toMatchObject({
        id: 'chunk_0_f1',
        fileId: 'f1',
        knowledgeBaseId: 'kb1',
        content: '分段内容 0',
        chunkIndex: 0,
        tokenCount: 100,
        embeddingDimensions: 4096,
      });
      expect(view[2].content).toBe('分段内容 2');
    });

    it('应该支持 skip/limit 分页读取', async () => {
      const rows = [0, 1, 2, 3, 4].map((i) => makeRow(i, 'f1'));
      await store.writeChunks('kb1', 'f1', rows);

      const page2 = await store.readChunks('kb1', 'f1', 2, 2);
      expect(page2.map((c) => c.chunkIndex)).toEqual([2, 3]);

      const overLimit = await store.readChunks('kb1', 'f1', 4, 10);
      expect(overLimit.map((c) => c.chunkIndex)).toEqual([4]);

      const beyondEnd = await store.readChunks('kb1', 'f1', 100, 10);
      expect(beyondEnd).toEqual([]);
    });

    it('JSONL 缺失时应该 fallback 读主库并保持字段形状', async () => {
      mockRepo.findByFileId.mockResolvedValue([
        {
          id: 'cuid-1',
          fileId: 'f2',
          knowledgeBaseId: 'kb1',
          content: '主库存量分块',
          chunkIndex: 0,
          vectorId: 'chunk_0_f2',
          embeddingDimensions: 4096,
          tokenCount: 55,
          metadata: { fileName: 'legacy.pdf' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const view = await store.readChunks('kb1', 'f2', 0, 10);
      expect(mockRepo.findByFileId).toHaveBeenCalledWith('f2', 0, 10);
      expect(view).toHaveLength(1);
      expect(view[0]).toMatchObject({
        id: 'cuid-1',
        fileId: 'f2',
        knowledgeBaseId: 'kb1',
        content: '主库存量分块',
        vectorId: 'chunk_0_f2',
        tokenCount: 55,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('应该跳过 JSONL 中损坏的行而不中断读取', async () => {
      const filePath = path.join(tmpRoot, 'kb1', 'f3');
      fs.mkdirSync(filePath, { recursive: true });
      const goodRow = makeRow(0, 'f3');
      fs.writeFileSync(
        path.join(filePath, 'chunks.jsonl'),
        `${JSON.stringify(goodRow)}\n{broken json\n`,
        'utf-8',
      );

      const view = await store.readChunks('kb1', 'f3', 0, 10);
      expect(view).toHaveLength(1);
      expect(view[0].chunkIndex).toBe(0);
    });
  });

  describe('deleteChunks / deleteKbDir', () => {
    it('deleteChunks 应删除文件分块目录且不影响其他文件', async () => {
      await store.writeChunks('kb1', 'f1', [makeRow(0, 'f1')]);
      await store.writeChunks('kb1', 'f2', [makeRow(0, 'f2')]);

      await store.deleteChunks('kb1', 'f1');

      expect(fs.existsSync(path.join(tmpRoot, 'kb1', 'f1'))).toBe(false);
      expect(fs.existsSync(path.join(tmpRoot, 'kb1', 'f2', 'chunks.jsonl'))).toBe(true);
    });

    it('deleteKbDir 应删除整个知识库目录（目录不存在时静默成功）', async () => {
      await store.writeChunks('kb1', 'f1', [makeRow(0, 'f1')]);
      await store.writeChunks('kb2', 'f1', [makeRow(0, 'f1')]);

      await store.deleteKbDir('kb1');
      expect(fs.existsSync(path.join(tmpRoot, 'kb1'))).toBe(false);
      expect(fs.existsSync(path.join(tmpRoot, 'kb2'))).toBe(true);

      // 不存在时不应抛错
      await expect(store.deleteKbDir('kb_not_exist')).resolves.toBeUndefined();
    });
  });

  describe('listKbIds / listFileIds', () => {
    it('应该列出已落盘的知识库与文件目录', async () => {
      await store.writeChunks('kb1', 'f1', [makeRow(0, 'f1')]);
      await store.writeChunks('kb2', 'f2', [makeRow(0, 'f2')]);

      expect(store.listKbIds().then((ids) => ids.sort())).resolves.toEqual(['kb1', 'kb2']);
      expect(await store.listFileIds('kb1')).toEqual(['f1']);
      expect(await store.listFileIds('kb_not_exist')).toEqual([]);
    });

    it('根目录不存在时应返回空列表', async () => {
      process.env.KB_DATA_DIR = path.join(tmpRoot, 'no-such-dir');
      const isolated = new KbChunkFileStore(mockRepo as any);
      expect(await isolated.listKbIds()).toEqual([]);
    });
  });

  describe('getRootDir', () => {
    it('应该按 KB_DATA_DIR → USERDATA_DIR → ./data/kb 的优先级解析根目录', () => {
      expect(store.getRootDir()).toBe(path.resolve(tmpRoot));

      delete process.env.KB_DATA_DIR;
      process.env.USERDATA_DIR = '/fake/userdata';
      const store2 = new KbChunkFileStore(mockRepo as any);
      expect(store2.getRootDir()).toBe(path.join('/fake/userdata', 'data', 'kb'));

      delete process.env.USERDATA_DIR;
      const store3 = new KbChunkFileStore(mockRepo as any);
      expect(store3.getRootDir()).toBe(path.resolve(process.cwd(), 'data', 'kb'));
    });
  });
});
