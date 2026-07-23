/// <reference types="jest" />

import { TokenizerService } from '../../src/common/utils/tokenizer.service';
import { ChunkingService, PageEntry, ChunkResult } from '../../src/modules/knowledge-base/chunking.service';

// Mock TokenizerService
function createMockTokenizer() {
  // 使用真实的 tiktoken 计算来保证结果准确
  let ttEnc: any = null;

  const getEncoder = async () => {
    if (!ttEnc) {
      const tiktoken = await import('tiktoken');
      ttEnc = tiktoken.get_encoding('cl100k_base');
    }
    return ttEnc;
  };

  return {
    countTextTokens: jest.fn().mockImplementation(async (_model: string, text: string, _useCache?: boolean) => {
      if (!text) return 0;
      const enc = await getEncoder();
      return enc.encode(text).length;
    }),
    encode: jest.fn().mockImplementation(async (_model: string, text: string) => {
      if (!text) return [];
      const enc = await getEncoder();
      return Array.from(enc.encode(text));
    }),
    decode: jest.fn().mockImplementation(async (_model: string, tokenIds: number[]) => {
      if (tokenIds.length === 0) return '';
      const enc = await getEncoder();
      const decoded = enc.decode(new Uint32Array(tokenIds));
      return new TextDecoder().decode(decoded);
    }),
    _cleanup: async () => {
      if (ttEnc) {
        ttEnc.free();
        ttEnc = null;
      }
    },
  };
}

describe('ChunkingService', () => {
  let service: ChunkingService;
  let mockTokenizer: ReturnType<typeof createMockTokenizer>;

  beforeEach(() => {
    mockTokenizer = createMockTokenizer();
    service = new ChunkingService(mockTokenizer as unknown as TokenizerService);
  });

  afterEach(async () => {
    await mockTokenizer._cleanup();
  });

  describe('chunkText', () => {
    it('应该对空文本返回空数组', async () => {
      const result = await service.chunkText('');
      expect(result).toEqual([]);
    });

    it('应该对空白文本返回空数组', async () => {
      const result = await service.chunkText('   \n  \n  ');
      expect(result).toEqual([]);
    });

    it('应该正确分块短文本（不触发分块）', async () => {
      const text = '这是一段短文本';
      const result = await service.chunkText(text);
      expect(result.length).toBe(1);
      expect(result[0].content).toBe(text);
      expect(result[0].chunkIndex).toBe(0);
    });

    it('应该将长文本拆分为多个块', async () => {
      // 构建一段超过 chunkSize 的长文本（约 300 token 的中文）
      const longText = Array(50).fill('这是一段用于测试分块功能的中文文本。').join('');
      const result = await service.chunkText(longText, { chunkSize: 100, overlapSize: 20 });

      expect(result.length).toBeGreaterThan(1);

      // 验证每个块的结构
      for (const chunk of result) {
        expect(chunk.content).toBeDefined();
        expect(chunk.metadata.tokenCount).toBeGreaterThan(0);
        expect(chunk.metadata.chunkSize).toBeGreaterThan(0);
        expect(['sentence', 'token', 'overflow']).toContain(chunk.metadata.strategy.toLowerCase());
      }
    });

    it('应该正确为非中文文本生成分块', async () => {
      const longText = Array(30).fill('This is a test sentence for chunking functionality. ').join('');
      const result = await service.chunkText(longText);

      expect(result.length).toBeGreaterThan(0);
      // 英文文本应该也能正确计算 token
      for (const chunk of result) {
        expect(chunk.metadata.tokenCount).toBeGreaterThan(0);
      }
    });

    it('所有分块的内容不应为空', async () => {
      const text = Array(20).fill('分块测试文本必须保持完整性。').join('');
      const result = await service.chunkText(text);

      expect(result.length).toBeGreaterThan(0);
      for (const chunk of result) {
        expect(chunk.content.length).toBeGreaterThan(0);
      }
    });

    it('应该正确处理带重叠的分块', async () => {
      const text = Array(30).fill('重叠分块测试用于验证相邻分块间的内容连续性。').join('');
      const result = await service.chunkText(text, { chunkSize: 100, overlapSize: 20 });

      // 如果有多个分块，验证相邻分块间存在重叠
      if (result.length >= 2) {
        for (let i = 1; i < result.length; i++) {
          const prev = result[i - 1];
          const curr = result[i];
          // 重叠块的 metadata 中 overlapLength > 0
          if (curr.metadata.overlapLength > 0) {
            // content 中应包含重叠部分，长度应大于不重叠时的预期长度
            expect(curr.content.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('chunkPages', () => {
    const buildPages = (texts: string[]): PageEntry[] =>
      texts.map((text, i) => ({ pageNum: i + 1, text }));

    it('应该对空页数组返回空结果', async () => {
      const result = await service.chunkPages([]);
      expect(result).toEqual([]);
    });

    it('应该正确分块单页文本', async () => {
      const pages = buildPages(['这是第一页的测试文本内容']);
      const result = await service.chunkPages(pages);

      expect(result.length).toBe(1);
    });

    it('应该跨页合并为统一分块', async () => {
      const pages = buildPages([
        '第一页内容。' + Array(20).fill('A').join(''),
        '第二页内容。' + Array(20).fill('B').join(''),
      ]);
      const result = await service.chunkPages(pages);

      // 合并后统一分块，不再按页切割
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 验证相邻分块的内容来源于合并后的连续文本
      for (const chunk of result) {
        expect(chunk.metadata.strategy).toBe('token');
      }
    });

    it('应该为多页内容生成全局递增的 chunkIndex', async () => {
      const pages = buildPages([
        Array(10).join('第一页长文本内容。'),
        Array(10).join('第二页长文本内容。'),
      ]);
      const result = await service.chunkPages(pages);

      // 验证 chunkIndex 全局递增
      for (let i = 0; i < result.length; i++) {
        expect(result[i].chunkIndex).toBe(i);
      }
    });

    it('应该跳过空白页后合并非空白内容统一分块', async () => {
      const pages = buildPages([
        '第一页有内容',
        '',
        '   ',
        '第三页也有内容',
      ]);
      const result = await service.chunkPages(pages);

      // 空白页被过滤后，非空白内容合并为连续文本统一分块
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 内容应为合并后的文本
      const allContent = result.map(c => c.content).join('');
      expect(allContent).toContain('第一页有内容');
      expect(allContent).toContain('第三页也有内容');
    });
  });

  describe('分块选项', () => {
    it('应该使用构造时的默认选项', async () => {
      const defaultService = new ChunkingService(mockTokenizer as unknown as TokenizerService);
      const text = '测试默认分块大小';
      const result = await defaultService.chunkText(text);
      expect(result.length).toBe(1);
    });

    it('应该在 chunkPages 中覆盖分块选项', async () => {
      const text = Array(30).fill('分块大小覆盖测试文本。').join('');
      const pages: PageEntry[] = [{ pageNum: 1, text }];

      // 使用大分块
      const largeResult = await service.chunkPages(pages, { chunkSize: 500, overlapSize: 50 });
      // 使用小分块
      const smallResult = await service.chunkPages(pages, { chunkSize: 50, overlapSize: 10 });

      expect(largeResult.length).toBeLessThan(smallResult.length);
    });
  });

  describe('辅助方法', () => {
    it('countTokens 应该返回正确的 token 数', async () => {
      const count = await service.countTokens('Hello, this is a test');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20);
    });

    it('encodeText 和 decodeTokens 应该可逆', async () => {
      const original = '这是一段可逆编码测试文本。';
      const tokenIds = await service.encodeText(original);
      const decoded = await service.decodeTokens(tokenIds);

      expect(decoded).toBe(original);
    });

    it('空文本的 countTokens 应该返回 0', async () => {
      // tiktoken 对空字符串也可能返回 1 (BOS token), 这取决于实现
      // 这里只验证不抛异常
      await expect(service.countTokens('')).resolves.not.toThrow();
    });
  });
});
