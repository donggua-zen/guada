import { Test, TestingModule } from '@nestjs/testing';
import { ProviderHub } from './provider-hub.service';
import { SiliconFlowProvider } from './providers/siliconflow/siliconflow.provider';

describe('ProviderHub', () => {
  let providerHub: ProviderHub;
  let siliconFlowProvider: SiliconFlowProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderHub,
        SiliconFlowProvider,
      ],
    }).compile();

    providerHub = module.get<ProviderHub>(ProviderHub);
    siliconFlowProvider = module.get<SiliconFlowProvider>(SiliconFlowProvider);
  });

  it('should be defined', () => {
    expect(providerHub).toBeDefined();
  });

  it('should register a provider', () => {
    providerHub.register(siliconFlowProvider);
    expect(providerHub.hasProvider('siliconflow')).toBe(true);
  });

  it('should get provider metadata', () => {
    providerHub.register(siliconFlowProvider);
    const metadata = siliconFlowProvider.getMetadata();
    
    expect(metadata.id).toBe('siliconflow');
    expect(metadata.name).toBe('硅基流动');
    expect(metadata.protocols).toContain('openai');
    expect(metadata.defaultApiUrl).toBe('https://api.siliconflow.cn/v1/');
  });

  it('should get models list', () => {
    providerHub.register(siliconFlowProvider);
    const models = providerHub.getModels('siliconflow');
    
    expect(models).toBeInstanceOf(Array);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('modelName');
    expect(models[0]).toHaveProperty('modeType');
    expect(models[0]).toHaveProperty('config');
  });

  it('should throw error when provider not found', () => {
    expect(() => providerHub.getProvider('nonexistent')).toThrow();
  });

  it('should get providers by protocol', () => {
    providerHub.register(siliconFlowProvider);
    const providers = providerHub.getProvidersByProtocol('openai');
    
    expect(providers).toBeInstanceOf(Array);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0].id).toBe('siliconflow');
  });

  it('should get model thinking efforts for supported model', () => {
    providerHub.register(siliconFlowProvider);
    
    // DeepSeek V3.2 - 根据名称模式推断为开关模式
    const efforts = providerHub.getModelThinkingEfforts(
      'siliconflow',
      'deepseek-ai/DeepSeek-V3.2'
    );
    
    expect(efforts).toContain('off');
    expect(efforts).toContain('on');
  });

  it('should return empty array for embedding model by heuristic', () => {
    providerHub.register(siliconFlowProvider);
    
    // Embedding 模型 - 通过名称匹配规则返回空数组
    const efforts = providerHub.getModelThinkingEfforts(
      'siliconflow',
      'Qwen/Qwen3-Embedding-8B'
    );
    
    expect(efforts).toEqual([]);
  });

  it('should infer thinking efforts for Qwen models', () => {
    providerHub.register(siliconFlowProvider);
    
    // Qwen 模型 - 根据名称模式推断为开关模式
    const efforts = providerHub.getModelThinkingEfforts(
      'siliconflow',
      'Qwen/Qwen3.5-397B-A17B'
    );
    
    expect(efforts).toEqual(['off', 'on']);
  });

  it('should infer thinking efforts for Kimi models', () => {
    providerHub.register(siliconFlowProvider);
    
    // Kimi 模型 - 根据名称模式推断为开关模式
    const efforts = providerHub.getModelThinkingEfforts(
      'siliconflow',
      'moonshotai/Kimi-K2-Thinking'
    );
    
    expect(efforts).toEqual(['off', 'on']);
  });

  it('should handle unknown model gracefully', () => {
    providerHub.register(siliconFlowProvider);
    
    // 未知模型 - 如果没有匹配到任何规则，返回供应商默认配置
    const efforts = providerHub.getModelThinkingEfforts(
      'siliconflow',
      'unknown/new-model-123'
    );
    
    // 硅基流动的默认配置是 ['off', 'on']
    expect(efforts).toEqual(['off', 'on']);
  });
});
