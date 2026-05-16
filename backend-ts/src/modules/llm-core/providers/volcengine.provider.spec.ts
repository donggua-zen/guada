import { Test, TestingModule } from '@nestjs/testing';
import { VolcEngineProvider } from './volcengine/volcengine.provider';

describe('VolcEngineProvider', () => {
  let provider: VolcEngineProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VolcEngineProvider],
    }).compile();

    provider = module.get<VolcEngineProvider>(VolcEngineProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should have correct metadata', () => {
    const metadata = provider.getMetadata();
    
    expect(metadata.id).toBe('volcengine');
    expect(metadata.name).toBe('火山引擎');
    expect(metadata.protocols).toContain('openai');
    expect(metadata.protocols).toContain('openai-response');
    expect(metadata.defaultApiUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/');
  });

  it('should get all models', () => {
    const models = provider.getModels();
    
    expect(models).toBeInstanceOf(Array);
    expect(models.length).toBe(5); // 4个豆包模型 + 1个DeepSeek模型
    
    // 验证豆包模型
    const doubaoModel = models.find(m => m.modelName === 'doubao-seed-2-0-pro-260215');
    expect(doubaoModel).toBeDefined();
    expect(doubaoModel?.modeType).toBe('text');
    expect(doubaoModel?.config.contextWindow).toBe(256000);
  });

  it('should filter models by modeType', () => {
    const textModels = provider.getModels({ modeType: 'text' });
    const embeddingModels = provider.getModels({ modeType: 'embedding' });
    
    expect(textModels.length).toBeGreaterThan(0);
    expect(embeddingModels.length).toBe(0); // 火山引擎目前没有 embedding 模型
  });

  it('should infer thinking efforts for Doubao models', () => {
    const efforts = provider.getModelThinkingEfforts('doubao-seed-2-0-pro-260215');
    
    expect(efforts).toContain('off');
    expect(efforts).toContain('minimal');
    expect(efforts).toContain('low');
    expect(efforts).toContain('medium');
    expect(efforts).toContain('high');
  });

  it('should infer thinking efforts for DeepSeek models', () => {
    const efforts = provider.getModelThinkingEfforts('deepseek-v3-2-251201');
    
    // DeepSeek 在火山引擎上仅支持开关模式
    expect(efforts).toEqual(['off', 'on']);
  });

  it('should return empty array for embedding models', () => {
    const efforts = provider.getModelThinkingEfforts('some-embedding-model');
    
    expect(efforts).toEqual([]);
  });

  it('should return default efforts for unknown models', () => {
    const efforts = provider.getModelThinkingEfforts('unknown-model');
    
    // 未知模型默认返回开关模式
    expect(efforts).toEqual(['off', 'on']);
  });

  it('should return correct thinking efforts for doubao models', () => {
    const efforts = provider.getModelThinkingEfforts('doubao-seed-2-0-pro-260215');
    expect(efforts).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
  });

  it('should return simple on/off for non-doubao models', () => {
    const efforts = provider.getModelThinkingEfforts('deepseek-v3-2-251201');
    expect(efforts).toEqual(['off', 'on']);
  });

  it('should return empty array for embedding models', () => {
    const efforts = provider.getModelThinkingEfforts('text-embedding-v3');
    expect(efforts).toEqual([]);
  });
});
