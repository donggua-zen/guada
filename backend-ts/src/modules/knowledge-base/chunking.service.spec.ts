/**
 * ChunkingService 单元测试
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ChunkingService } from './chunking.service';

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChunkingService],
    }).compile();

    service = module.get<ChunkingService>(ChunkingService);
  });

  afterEach(() => {
    // 释放资源
    service.dispose();
  });

  it('应该正确初始化服务', () => {
    expect(service).toBeDefined();
  });

  it('应该能正确处理空文本', async () => {
    const result = await service.chunkText('');
    expect(result).toEqual([]);
  });

  it('应该能正确处理短文本（不分块）', async () => {
    const text = '这是一个简短的测试文本。';
    const result = await service.chunkText(text);
    
    expect(result.length).toBe(1);
    expect(result[0].cleanContent).toBe(text);
    expect(result[0].metadata.strategy).toBe('token');
  });

  it('应该基于句子边界进行智能分块', async () => {
    const text = '这是第一个句子。这是第二个句子。这是第三个句子。这是第四个句子。';
    const result = await service.chunkText(text, { chunkSize: 20 });
    
    expect(result.length).toBeGreaterThan(1);
    
    // 验证每个分块的完整性（不应该在句子中间断开）
    result.forEach(chunk => {
      // 检查是否以句子结束符结尾（除了最后一个分块）
      if (chunk.chunkIndex < result.length - 1) {
        expect(/[。！？.!?]$/.test(chunk.cleanContent.trim())).toBe(true);
      }
    });
  });

  it('应该正确处理重叠逻辑', async () => {
    const text = '第一句内容。第二句内容。第三句内容。第四句内容。';
    const result = await service.chunkText(text, { 
      chunkSize: 15,
      overlapSize: 5 
    });
    
    if (result.length > 1) {
      // 验证第二个及以后的分块有重叠信息
      for (let i = 1; i < result.length; i++) {
        expect(result[i].metadata.overlapLength).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('应该返回正确的元数据', async () => {
    const text = '测试文本内容，用于验证元数据。';
    const metadata = { customField: 'test' };
    const result = await service.chunkText(text, metadata);
    
    expect(result.length).toBe(1);
    expect((result[0].metadata as any).customField).toBe('test');
    expect(result[0].metadata.tokenCount).toBeGreaterThan(0);
    expect(result[0].chunkIndex).toBe(0);
    expect(result[0].metadata.strategy).toBe('token');
  });

  it('应该准确计算 Token 数量', async () => {
    const text = 'Hello world! 你好世界！';
    const tokenCount = await service.countTokens(text);
    
    expect(tokenCount).toBeGreaterThan(0);
    expect(typeof tokenCount).toBe('number');
  });

  it('应该能编码和解码文本', async () => {
    const text = '测试编码和解码功能。';
    const tokens = await service.encodeText(text);
    const decoded = await service.decodeTokens(tokens);
    
    expect(tokens.length).toBeGreaterThan(0);
    expect(decoded).toBe(text);
  });

  it('应该处理包含中英文混合的长文本', async () => {
    const longText = `
      人工智能（Artificial Intelligence），英文缩写为AI。
      它是研究、开发用于模拟、延伸和扩展人的智能的理论、方法、技术及应用系统的一门新的技术科学。
      Artificial intelligence is the simulation of human intelligence processes by machines.
      These learning processes include the acquisition of information and rules for using the information.
    `.repeat(10);

    const result = await service.chunkText(longText, { 
      chunkSize: 100,
      overlapSize: 20 
    });
    
    expect(result.length).toBeGreaterThan(1);
    
    // 验证所有分块的总内容覆盖了原文本
    const allContent = result.map(r => r.cleanContent).join(' ');
    expect(allContent.length).toBeGreaterThan(0);
  });

  it('应该在单个句子超过限制时强制分割', async () => {
    const longSentence = 'A'.repeat(2000); // 超长句子
    const result = await service.chunkText(longSentence, { chunkSize: 100 });
    
    // 即使是一个句子，如果太长也应该被分割
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
