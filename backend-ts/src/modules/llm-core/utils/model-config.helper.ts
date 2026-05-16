/**
 * 模型配置片段类型
 */
type ModelConfigFragment = Partial<{
  inputCapabilities: string[];
  outputCapabilities: string[];
  features: string[];
  contextWindow: number;
  maxOutputTokens: number;
  vectorDimensions: number;
}>;

/**
 * 预定义的配置片段 - 可组合使用
 */
export const ConfigFragments = {
  // 输入能力
  TextOnly: { inputCapabilities: ['text'] },
  Multimodal: { inputCapabilities: ['text', 'image'] },

  // 输出能力
  TextOutput: { outputCapabilities: ['text'] },
  ImageOutput: { outputCapabilities: ['text', 'image'] },

  // 功能特性
  WithTools: { features: ['tools'] },
  WithThinking: { features: ['thinking'] },
  WithToolsAndThinking: { features: ['tools', 'thinking'] },
  WithoutThinking: { features: ['tools'] }, // 仅支持工具，不支持 thinking（用于覆盖默认值）

  // 上下文窗口预设（单位：K）
  ContextWindow: {
    _8K: { contextWindow: 8000 },
    _32K: { contextWindow: 32000 },
    _33K: { contextWindow: 33000 },
    _64K: { contextWindow: 64000 },
    _128K: { contextWindow: 128000 },
    _160K: { contextWindow: 160000 },
    _197K: { contextWindow: 197000 },
    _198K: { contextWindow: 198000 },
    _200K: { contextWindow: 200000 },
    _205K: { contextWindow: 205000 },
    _256K: { contextWindow: 256000 },
    _400K: { contextWindow: 400000 },
    _1M: { contextWindow: 1000000 },
    _1_1M: { contextWindow: 1100000 },
  },

  // 最大输出token预设
  MaxOutput: {
    _33K: { maxOutputTokens: 33000 },
    _66K: { maxOutputTokens: 66000 },
    _96K: { maxOutputTokens: 96000 },
    _128K: { maxOutputTokens: 128000 },
    _131K: { maxOutputTokens: 131000 },
    _384K: { maxOutputTokens: 384000 },
  },

  // Embedding 向量维度
  VectorDim: {
    _1024: { vectorDimensions: 1024 },
    _1536: { vectorDimensions: 1536 },
    _2000: { vectorDimensions: 2000 },
    _4096: { vectorDimensions: 4096 },
  },
};

/**
 * 合并多个配置片段，后面的覆盖前面的
 */
export function mergeConfig(...fragments: ModelConfigFragment[]): any {
  return Object.assign({}, ...fragments);
}

/**
 * 创建文本模型配置的辅助函数
 * 支持多个配置片段的自动合并
 */
export function createTextModel(
  modelName: string,
  ...fragments: ModelConfigFragment[]
) {
  const config = mergeConfig(
    // 默认配置
    ConfigFragments.TextOnly,
    ConfigFragments.TextOutput,
    ConfigFragments.WithToolsAndThinking,
    ConfigFragments.ContextWindow._128K,
    // 用户提供的配置片段（覆盖默认值）
    ...fragments
  );

  return {
    modelName,
    modeType: 'text' as const,
    config: config as any,
  };
}

/**
 * 创建多模态模型配置的辅助函数
 */
export function createMultimodalModel(
  modelName: string,
  ...fragments: ModelConfigFragment[]
) {
  const config = mergeConfig(
    // 默认配置
    ConfigFragments.Multimodal,
    ConfigFragments.TextOutput,
    ConfigFragments.WithToolsAndThinking,
    ConfigFragments.ContextWindow._128K,
    // 用户提供的配置片段
    ...fragments
  );

  return {
    modelName,
    modeType: 'text' as const,
    config: config as any,
  };
}

/**
 * 创建 Embedding 模型配置的辅助函数
 */
export function createEmbeddingModel(
  modelName: string,
  ...fragments: ModelConfigFragment[]
) {
  const config = mergeConfig(
    // 默认配置
    ConfigFragments.ContextWindow._8K,
    ConfigFragments.VectorDim._1536,
    // 用户提供的配置片段
    ...fragments
  );

  return {
    modelName,
    modeType: 'embedding' as const,
    config: config as any,
  };
}
