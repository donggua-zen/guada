/// <reference types="jest" />

/**
 * 分块「结构保真」测试
 *
 * ## 背景
 *
 * 原实现对**所有**文件用同一套预处理（`replace(/\s+/g, " ")`），于是 Markdown 的标题/
 * 列表/代码围栏全塌成一行、代码缩进丢失、表格列对齐消失。而知识库明确支持 37 种文本/
 * 代码扩展名——"支持这些格式"和"把它们的结构抹平"是自相矛盾的。
 *
 * 现在按 `chunking-kind.util.ts` 判定的类型分流：
 *
 * | 类型 | 预处理 | 切分单元 |
 * |---|---|---|
 * | `markdown` | 保留换行/缩进 + NFKC | ATX 标题层级，每块带标题路径前缀 |
 * | `code` | 保留换行/缩进，**不**归一化 | 空行分隔的代码块 |
 * | `table` | 保留换行/缩进，**不**归一化 | 行分组，重复表头 |
 * | `prose` | 折叠空白 + 压缩重复标点（**沿用旧行为**） | 句子边界 |
 *
 * ## 为什么 `prose` 刻意保留旧行为
 *
 * 纯中文散文里换行本来就不承载语义（PDF 抽出来的文本尤其如此），折叠空白对检索有利；
 * 而改了它会让已入库的老数据与新数据在同一个库里表现不同，收益却很小。
 * 所以这一块是**回归保护**（断言旧行为没变），不是待修的缺陷。
 */

import { TokenizerService } from '../../src/common/utils/tokenizer.service';
import { ChunkingService, PageEntry } from '../../src/modules/knowledge-base/chunking.service';
import {
  chunkKindForExtension,
  isLegacyChunkStrategy,
} from '../../src/modules/knowledge-base/chunking-kind.util';

/** 与 chunking.service.spec.ts 同款：用真实 tiktoken，保证 token 计数准确 */
function createMockTokenizer() {
  let ttEnc: any = null;

  const getEncoder = async () => {
    if (!ttEnc) {
      const tiktoken = await import('tiktoken');
      ttEnc = tiktoken.get_encoding('cl100k_base');
    }
    return ttEnc;
  };

  return {
    countTextTokens: jest.fn().mockImplementation(async (_model: string, text: string) => {
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
      return new TextDecoder().decode(enc.decode(new Uint32Array(tokenIds)));
    }),
    _cleanup: async () => {
      if (ttEnc) {
        ttEnc.free();
        ttEnc = null;
      }
    },
  };
}

describe('ChunkingService 结构保真', () => {
  let service: ChunkingService;
  let mockTokenizer: ReturnType<typeof createMockTokenizer>;

  beforeEach(() => {
    mockTokenizer = createMockTokenizer();
    service = new ChunkingService(mockTokenizer as unknown as TokenizerService);
  });

  afterEach(async () => {
    await mockTokenizer._cleanup();
  });

  // ===========================================================================
  // 扩展名 → 类型判定
  // ===========================================================================
  describe('类型判定', () => {
    it.each([
      ['md', 'markdown'],
      ['MARKDOWN', 'markdown'],
      ['.mdx', 'markdown'],
      ['py', 'code'],
      ['.ts', 'code'],
      ['json', 'code'],
      ['dts', 'code'],
      ['csv', 'table'],
      ['tsv', 'table'],
      ['txt', 'prose'],
      ['', 'prose'],
      [null, 'prose'],
      ['unknown-ext', 'prose'],
    ])('%s → %s', (ext, expected) => {
      expect(chunkKindForExtension(ext as any)).toBe(expected);
    });
  });

  // ===========================================================================
  // 结构化格式：保留换行与缩进
  // ===========================================================================
  describe('结构化格式：保留换行与缩进', () => {
    it('Markdown 保留段落边界（换行不再被压成空格）', async () => {
      const md = '# 标题\n\n第一段内容。\n\n第二段内容。';
      const result = await service.chunkText(md, { fileExtension: 'md' });
      const text = result.map((c) => c.content).join('\n');

      expect(text).toContain('# 标题');
      expect(text).toContain('第一段内容。');
      // 关键：段落之间仍有换行
      expect(text).toMatch(/第一段内容。\n+第二段内容。/);
    });

    it('代码缩进被保留（Python 可读）', async () => {
      const code = 'def f():\n    if True:\n        return 1\n    return 0';
      const result = await service.chunkText(code, { fileExtension: 'py' });
      const text = result.map((c) => c.content).join('\n');

      expect(text).toContain('    if True:');
      expect(text).toContain('        return 1');
      expect(text).toMatch(/^def f\(\):$/m);
    });

    it('Markdown 列表结构保留', async () => {
      const list = '- 第一项\n- 第二项\n- 第三项';
      const result = await service.chunkText(list, { fileExtension: 'md' });
      const text = result.map((c) => c.content).join('\n');

      expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
    });

    it('Markdown 代码围栏保留', async () => {
      const md = '说明：\n\n```ts\nconst a = 1;\n```';
      const result = await service.chunkText(md, { fileExtension: 'md' });
      const text = result.map((c) => c.content).join('\n');

      expect(text).toContain('```ts');
      expect(text).toMatch(/```ts\nconst a = 1;\n```/);
    });

    it('连续空行被压到 1 个（3+ 个空行合并，但段落边界保留）', async () => {
      const text = 'A\n\n\n\n\nB';
      const result = await service.chunkText(text, { fileExtension: 'md' });
      const joined = result.map((c) => c.content).join('\n');

      expect(joined).toContain('A\n\nB');
      expect(joined).not.toContain('\n\n\n');
    });

    it('代码不做 NFKC 归一化（全角字符可能是字面量的一部分）', async () => {
      const code = 'const label = "注意：全角（括号）";';
      const result = await service.chunkText(code, { fileExtension: 'ts' });
      const text = result.map((c) => c.content).join('\n');

      // 全角标点原样保留
      expect(text).toContain('：');
      expect(text).toContain('（');
    });

    it('CRLF 行尾被归一为 LF（但不丢结构）', async () => {
      const code = 'line1\r\n  line2\r\nline3';
      const result = await service.chunkText(code, { fileExtension: 'ts' });
      const text = result.map((c) => c.content).join('\n');

      expect(text).not.toContain('\r');
      expect(text).toContain('  line2');
    });
  });

  // ===========================================================================
  // 散文：刻意保留旧行为（回归保护）
  // ===========================================================================
  describe('散文：刻意沿用旧行为（回归保护，非缺陷）', () => {
    it('txt 仍折叠空白：换行变空格', async () => {
      const text = '第一段。\n\n第二段。';
      const result = await service.chunkText(text, { fileExtension: 'txt' });
      const joined = result.map((c) => c.content).join(' ');

      expect(joined).not.toContain('\n');
      expect(joined).toContain('第一段。 第二段。');
    });

    it('txt 仍做 NFKC 归一化（全角标点转半角，句号除外）', async () => {
      const text = '注意：全角（括号）、逗号，与问号？都会被改写。';
      const result = await service.chunkText(text, { fileExtension: 'txt' });
      const joined = result.map((c) => c.content).join(' ');

      expect(joined).not.toContain('：');
      expect(joined).not.toContain('（');
      expect(joined).not.toContain('？');
      expect(joined).toContain('。');
    });

    it('未指定扩展名时按 prose 处理（保守：最接近原行为）', async () => {
      const text = 'A\n\nB';
      const result = await service.chunkText(text);
      expect(result.map((c) => c.content).join('')).not.toContain('\n');
    });

    it('纯空白输入仍返回空数组', async () => {
      expect(await service.chunkText('   \n  \t  ', { fileExtension: 'md' })).toEqual([]);
    });
  });

  // ===========================================================================
  // 切分策略
  // ===========================================================================
  describe('切分策略按类型分流', () => {
    it('Markdown 按标题切分，且每块带标题路径前缀', async () => {
      const md = [
        '# 项目说明',
        '',
        '这是一段介绍。',
        '',
        '## 安装',
        '',
        '执行安装命令。',
        '',
        '## 使用',
        '',
        '执行使用命令。',
      ].join('\n');

      const result = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 500,
        overlapSize: 0,
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      // 每块都带标题路径（## 段的路径应包含父级 # 项目说明）
      const joined = result.map((c) => c.content).join('\n@@@\n');
      expect(joined).toContain('# 项目说明');
      expect(joined).toContain('## 安装');
      expect(joined).toContain('## 使用');

      // 找"安装"那一块：应同时含父标题与自身标题
      const installChunk = result.find((c) => c.content.includes('## 安装'));
      expect(installChunk).toBeDefined();
      expect(installChunk!.content).toContain('# 项目说明');
      expect(installChunk!.content).toContain('执行安装命令。');
    });

    it('代码按空行块聚合，不切在块内部', async () => {
      const code = [
        'function a() {',
        '  return 1;',
        '}',
        '',
        'function b() {',
        '  return 2;',
        '}',
      ].join('\n');

      const result = await service.chunkText(code, {
        fileExtension: 'js',
        chunkSize: 500,
        overlapSize: 0,
        chunkMinSize: 0,
      });

      expect(result).toHaveLength(1);
      // 两个函数在同一块里，各自内部完整
      expect(result[0].content).toContain('function a() {');
      expect(result[0].content).toContain('function b() {');
    });

    it('代码块超过 chunkSize 时按行切分（不丢内容）', async () => {
      const lines = Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`);
      const code = lines.join('\n'); // 无空行 → 单个大块

      const result = await service.chunkText(code, {
        fileExtension: 'js',
        chunkSize: 30,
        overlapSize: 0,
        chunkMinSize: 0,
      });

      expect(result.length).toBeGreaterThan(1);
      const all = result.map((c) => c.content).join('\n');
      for (const line of lines) expect(all).toContain(line);
    });

    it('表格分组时重复表头', async () => {
      const rows = ['name,value', ...Array.from({ length: 30 }, (_, i) => `k${i},${i}`)];
      const csv = rows.join('\n');

      const result = await service.chunkText(csv, {
        fileExtension: 'csv',
        chunkSize: 40,
        overlapSize: 0,
        chunkMinSize: 0,
      });

      expect(result.length).toBeGreaterThan(1);
      // 每一块都必须以表头开头
      for (const c of result) {
        expect(c.content.split('\n')[0]).toBe('name,value');
      }
    });

    it('策略标记带类型与版本', async () => {
      expect((await service.chunkText('a\n\nb', { fileExtension: 'md' }))[0].metadata.strategy)
        .toBe('md-heading-v2');
      expect((await service.chunkText('a\n\nb', { fileExtension: 'ts' }))[0].metadata.strategy)
        .toBe('code-block-v2');
      expect((await service.chunkText('h,v\n1,2', { fileExtension: 'csv' }))[0].metadata.strategy)
        .toBe('table-rows-v2');
      expect((await service.chunkText('一段话。', { fileExtension: 'txt' }))[0].metadata.strategy)
        .toBe('sentence-v2');
    });

    it('isLegacyChunkStrategy 能识别旧标记（历史数据策略为 "token"）', () => {
      expect(isLegacyChunkStrategy('token')).toBe(true);
      expect(isLegacyChunkStrategy(null)).toBe(true);
      expect(isLegacyChunkStrategy(undefined)).toBe(true);
      expect(isLegacyChunkStrategy('sentence-v2')).toBe(false);
      expect(isLegacyChunkStrategy('md-heading-v2')).toBe(false);
      expect(isLegacyChunkStrategy('sentence-v1')).toBe(true);
    });
  });

  // ===========================================================================
  // chunkMinSize（原死配置，现已接线）
  // ===========================================================================
  describe('chunkMinSize：尾块合并', () => {
    it('尾块低于阈值时并进前一块', async () => {
      const md = [
        '# 大章节',
        '',
        Array(60).fill('这一章有很多内容，需要占据足够多的 token 数。').join(''),
        '',
        '# 尾巴',
        '',
        '很短。',
      ].join('\n');

      const withMerge = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 200,
        overlapSize: 0,
        chunkMinSize: 50,
      });
      const withoutMerge = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 200,
        overlapSize: 0,
        chunkMinSize: 0,
      });

      // 合并后块数更少
      expect(withMerge.length).toBeLessThanOrEqual(withoutMerge.length);
      // 合并后最后一块不再是那个孤立的短块
      const last = withMerge[withMerge.length - 1];
      expect(await service.countTokens(last.content)).toBeGreaterThanOrEqual(50);
    });

    it('尾块足够长时不合并', async () => {
      const md = ['# A', '', Array(40).fill('内容内容内容内容内容。').join('')].join('\n');
      const withMerge = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 200,
        overlapSize: 0,
        chunkMinSize: 50,
      });
      const withoutMerge = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 200,
        overlapSize: 0,
        chunkMinSize: 0,
      });

      expect(withMerge.length).toBe(withoutMerge.length);
    });

    it('只有一块时不合并（无可合并对象）', async () => {
      const result = await service.chunkText('短文本。', {
        fileExtension: 'txt',
        chunkMinSize: 500,
      });
      expect(result).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 与类型无关的既有契约：必须保持不变
  // ===========================================================================
  describe('与类型无关的既有契约', () => {
    it('chunkIndex 从 0 连续递增', async () => {
      const pages: PageEntry[] = [
        { pageNum: 1, text: Array(20).fill('分页索引测试文本。').join('') },
        { pageNum: 2, text: Array(20).fill('第二页索引测试文本。').join('') },
      ];
      const result = await service.chunkPages(pages, {
        chunkSize: 100,
        overlapSize: 20,
        fileExtension: 'txt',
      });

      expect(result.length).toBeGreaterThan(1);
      result.forEach((c, i) => expect(c.chunkIndex).toBe(i));
    });

    it('每个块的 tokenCount / chunkSize 元信息都被填充', async () => {
      const text = Array(30).fill('元信息填充测试文本。').join('');
      const result = await service.chunkPages([{ pageNum: 1, text }], {
        chunkSize: 100,
        overlapSize: 20,
        fileExtension: 'txt',
      });

      for (const c of result) {
        expect(c.metadata.tokenCount).toBeGreaterThan(0);
        expect(c.metadata.chunkSize).toBeGreaterThan(0);
        expect(typeof c.metadata.strategy).toBe('string');
        expect(c.metadata.overlapLength).toBeGreaterThanOrEqual(0);
      }
    });

    it('块内容非空，且不出现 U+FFFD 替换字符', async () => {
      const text = Array(30).fill('替换字符清理测试，包含中文与 emoji 🎯。').join('');
      const result = await service.chunkPages([{ pageNum: 1, text }], {
        chunkSize: 80,
        overlapSize: 16,
        fileExtension: 'txt',
      });

      expect(result.length).toBeGreaterThan(1);
      for (const c of result) {
        expect(c.content.length).toBeGreaterThan(0);
        expect(c.content).not.toContain('\uFFFD');
      }
    });

    it('结构化格式的重叠逻辑同样生效', async () => {
      const md = Array.from({ length: 30 }, (_, i) => `## 段 ${i}\n\n内容 ${i}。`).join('\n\n');
      const result = await service.chunkText(md, {
        fileExtension: 'md',
        chunkSize: 60,
        overlapSize: 10,
        chunkMinSize: 0,
      });

      expect(result.length).toBeGreaterThan(1);
      // 至少有一块带重叠
      expect(result.some((c) => c.metadata.overlapLength > 0)).toBe(true);
    });

    it('空页数组返回空结果', async () => {
      expect(await service.chunkPages([])).toEqual([]);
    });

    it('全空白页被过滤后返回空结果', async () => {
      const pages: PageEntry[] = [
        { pageNum: 1, text: '   ' },
        { pageNum: 2, text: '\n\n' },
      ];
      expect(await service.chunkPages(pages)).toEqual([]);
    });
  });
});
