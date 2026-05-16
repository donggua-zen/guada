import { Test, TestingModule } from '@nestjs/testing';
import { DeepSeekProvider } from './deepseek/deepseek.provider';

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeepSeekProvider],
    }).compile();

    provider = module.get<DeepSeekProvider>(DeepSeekProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should have correct metadata', () => {
    const metadata = provider.getMetadata();
    
    expect(metadata.id).toBe('deepseek');
    expect(metadata.name).toBe('DeepSeek');
    expect(metadata.protocols).toContain('openai');
    expect(metadata.defaultApiUrl).toBe('https://api.deepseek.com');
  });

  it('should get all models', () => {
    const models = provider.getModels();
    
    expect(models).toHaveLength(2);
    expect(models[0].modelName).toBe('deepseek-v4-flash');
    expect(models[1].modelName).toBe('deepseek-v4-pro');
  });

  it('should filter models by modeType', () => {
    const textModels = provider.getModels({ modeType: 'text' });
    const embeddingModels = provider.getModels({ modeType: 'embedding' });
    
    expect(textModels).toHaveLength(2);
    expect(embeddingModels).toHaveLength(0);
  });

  it('should infer thinking efforts for DeepSeek models', () => {
    const efforts = provider.getModelThinkingEfforts('deepseek-v4-pro');
    
    // DeepSeek 仅支持 high 和 max
    expect(efforts).toEqual(['high', 'max']);
  });

  it('should return empty array for embedding models', () => {
    const efforts = provider.getModelThinkingEfforts('embedding-model');
    
    expect(efforts).toEqual([]);
  });

  it('should return default efforts for unknown models', () => {
    const efforts = provider.getModelThinkingEfforts('unknown-model');
    
    // 默认返回 DeepSeek 的标准配置
    expect(efforts).toEqual(['high', 'max']);
  });

  it('should return high/max for all models', () => {
    const efforts = provider.getModelThinkingEfforts('deepseek-v4-pro');
    expect(efforts).toEqual(['high', 'max']);
  });

  it('should return empty array for embedding models', () => {
    const efforts = provider.getModelThinkingEfforts('text-embedding-v3');
    expect(efforts).toEqual([]);
  });
});
