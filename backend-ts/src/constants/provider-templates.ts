import { ModelHintSchema } from "@modelcontextprotocol/sdk/types";

export interface ProviderTemplate {
  id: string;
  name: string;
  protocol: string;
  defaultApiUrl: string;
  avatarUrl?: string;
  description?: string;
  attributes?: Record<string, any>;
  models?: any[];
}

// ==================== Thinking 配置接口 ====================

/**
 * Thinking 配置生成器接口
 * 统一规范：所有配置生成器必须接受布尔值参数
 */
export interface ThinkingConfigGenerator {
  thinking: {
    get: (enabled: boolean) => Record<string, any>;
  };
}

// ==================== Thinking 配置生成器 ====================

/**
 * enable_thinking 模式（硅基流动、阿里云、百度等）
 */
const ENABLE_THINKING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => ({ enable_thinking: enabled }),
  },
};

/**
 * thinking.type 模式（火山引擎、智谱、Moonshot、DeepSeek等）
 */
const THINKING_TYPE_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => ({
      thinking: {
        type: enabled ? "enabled" : "disabled",
      },
    }),
  },
};

/**
 * MiniMax 风格配置
 */
const MINIMAX_THINKING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => ({
      thinking: {
        enabled: enabled,
      },
    }),
  },
};

/**
 * OpenAI reasoning_effort 配置
 * 开启时使用 high，关闭时返回空对象
 */
const OPENAI_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => (enabled ? { reasoning_effort: "high" } : {}),
  },
};

/**
 * Azure OpenAI reasoning_effort 配置
 * 开启时使用 medium，关闭时返回空对象
 */
const AZURE_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => (enabled ? { reasoning_effort: "medium" } : {}),
  },
};

/**
 * Groq reasoning_format 配置
 * 开启时使用 parsed，关闭时返回空对象
 */
const GROQ_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (enabled: boolean) => (enabled ? { reasoning_format: "parsed" } : {}),
  },
};

// ==================== 模型配置片段类型 ====================

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
const ConfigFragments = {
  // 输入能力
  TextOnly: { inputCapabilities: ["text"] },
  Multimodal: { inputCapabilities: ["text", "image"] },

  // 输出能力
  TextOutput: { outputCapabilities: ["text"] },
  ImageOutput: { outputCapabilities: ["text", "image"] },

  // 功能特性
  WithTools: { features: ["tools"] },
  WithThinking: { features: ["thinking"] },
  WithToolsAndThinking: { features: ["tools", "thinking"] },
  WithoutThinking: { features: ["tools"] }, // 仅支持工具，不支持 thinking（用于覆盖默认值）

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
function mergeConfig(...fragments: ModelConfigFragment[]): ModelConfigFragment {
  return Object.assign({}, ...fragments);
}

/**
 * 创建文本模型配置的辅助函数
 * 支持多个配置片段的自动合并
 */
function createTextModel(
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
    modeType: "text" as const,
    config,
  };
}

/**
 * 创建多模态模型配置的辅助函数
 */
function createMultimodalModel(
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
    modeType: "text" as const,
    config,
  };
}

/**
 * 创建 Embedding 模型配置的辅助函数
 */
function createEmbeddingModel(
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
    modeType: "embedding" as const,
    config,
  };
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ==================== 国内平台 ====================
  {
    id: "siliconflow",
    name: "硅基流动",
    protocol: "openai",
    defaultApiUrl: "https://api.siliconflow.cn/v1/",
    avatarUrl: "static/images/providers/siliconflow.svg",
    description: "提供高性价比的开源模型 API 服务，支持多种主流大语言模型。",
    attributes: {
      openai: {
        ...ENABLE_THINKING_CONFIG,
      },
    },
    models: [
      createTextModel(
        "deepseek-ai/DeepSeek-V3.2",
        ConfigFragments.ContextWindow._160K
      ),
      createTextModel(
        "deepseek-ai/DeepSeek-V3.1-Terminus",
        ConfigFragments.ContextWindow._160K
      ),
      createTextModel(
        "deepseek-ai/DeepSeek-R1",
        ConfigFragments.ContextWindow._160K,
        ConfigFragments.WithTools
      ),
      createMultimodalModel(
        "Qwen/Qwen3.5-397B-A17B",
        ConfigFragments.ContextWindow._256K
      ),
      createMultimodalModel(
        "Qwen/Qwen3.5-122B-A10B",
        ConfigFragments.ContextWindow._256K
      ),
      createMultimodalModel(
        "Qwen/Qwen3-VL-32B-Instruct",
        ConfigFragments.ContextWindow._128K,
        ConfigFragments.WithTools
      ),
      createMultimodalModel(
        "Qwen/Qwen3-VL-235B-A22B-Thinking",
        ConfigFragments.ContextWindow._256K
      ),
      createTextModel(
        "moonshotai/Kimi-K2-Thinking",
        ConfigFragments.ContextWindow._200K,
        ConfigFragments.WithTools
      ),
      createEmbeddingModel(
        "Qwen/Qwen3-Embedding-8B",
        ConfigFragments.ContextWindow._32K,
        ConfigFragments.VectorDim._4096
      ),
    ],
  },
  {
    id: "aliyun-bailian",
    name: "阿里云百炼",
    protocol: "openai",
    defaultApiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
    avatarUrl: "static/images/providers/aliyun-bailian.svg",
    description:
      "阿里云推出的大模型服务平台，提供通义千问等自研模型及第三方模型接入。",
    attributes: {
      openai: {
        ...ENABLE_THINKING_CONFIG,
      },
    },
    models: [
      createMultimodalModel("qwen3.6-plus", ConfigFragments.ContextWindow._1M),
      createMultimodalModel("qwen3.6-plus-2026-04-02", ConfigFragments.ContextWindow._1M),
      createMultimodalModel("qwen3.5-397b-a17b", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("qwen3.5-122b-a10b", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("qwen3.5-27b", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("qwen3.5-35b-a3b", ConfigFragments.ContextWindow._256K),
      createTextModel("deepseek-v3.2", ConfigFragments.ContextWindow._128K),
      createTextModel("deepseek-v3.1", ConfigFragments.ContextWindow._128K),
      createTextModel("deepseek-r1-0528", ConfigFragments.ContextWindow._128K),
      createTextModel("deepseek-v3", ConfigFragments.ContextWindow._64K),
      createMultimodalModel("kimi-k2.5", ConfigFragments.ContextWindow._256K),
      createTextModel("glm-5", ConfigFragments.ContextWindow._198K),
      createTextModel(
        "minimax-m2.5",
        ConfigFragments.ContextWindow._200K,
        ConfigFragments.WithTools
      ),
      createEmbeddingModel(
        "text-embedding-v4",
        ConfigFragments.ContextWindow._32K,
        ConfigFragments.VectorDim._1024
      ),
    ],
  },
  {
    id: "volcengine",
    name: "火山引擎",
    protocol: "openai-response", // 使用 Responses API 协议进行测试
    defaultApiUrl: "https://ark.cn-beijing.volces.com/api/v3/",
    avatarUrl: "static/images/providers/volcengine.svg",
    description: "字节跳动旗下云平台，提供豆包大模型及企业级 AI 解决方案。",
    attributes: {
      openai: {
        ...THINKING_TYPE_CONFIG,
        thinkingEffort: ["low", "medium", "high", "minimal"],
      },
      "openai-response": {
        ...THINKING_TYPE_CONFIG,
        thinkingEffort: ["low", "medium", "high", "minimal"],
      },
    },
    models: [
      createMultimodalModel("doubao-seed-2-0-pro-260215", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("doubao-seed-2-0-lite-260215", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("doubao-seed-2-0-mini-260215", ConfigFragments.ContextWindow._256K),
      createMultimodalModel("doubao-seed-2-0-code-preview-260215", ConfigFragments.ContextWindow._256K),
      createTextModel("deepseek-v3-2-251201", ConfigFragments.ContextWindow._128K),
    ],
  },
  {
    id: "baidu-qianfan",
    name: "百度智能云",
    protocol: "openai",
    defaultApiUrl: "https://qianfan.baidubce.com/v2/",
    avatarUrl: "static/images/providers/baidu-qianfan.svg",
    description:
      "百度千帆大模型平台，提供文心一言系列模型及完整的 AI 开发生态。",
    attributes: {
      openai: {
        ...ENABLE_THINKING_CONFIG,
      },
    },
  },
  {
    id: "zhipu",
    name: "智谱 AI",
    protocol: "openai",
    defaultApiUrl: "https://open.bigmodel.cn/api/paas/v4/",
    avatarUrl: "static/images/providers/zhipu.svg",
    description:
      "源自清华技术背景，提供 GLM 系列大语言模型，支持强大的推理与代码能力。",
    attributes: {
      openai: {
        ...THINKING_TYPE_CONFIG,
      },
    },
    models: [
      createTextModel("GLM-5", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-5-Turbo", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-4-Plus", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-4.7", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-4.7-FlashX", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-4.6", ConfigFragments.ContextWindow._200K, ConfigFragments.MaxOutput._128K),
      createTextModel("GLM-4.5", ConfigFragments.ContextWindow._128K, ConfigFragments.MaxOutput._96K),
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    protocol: "openai",
    defaultApiUrl: "https://api.moonshot.cn/v1/",
    avatarUrl: "static/images/providers/moonshotai_new.png",
    description:
      "月之暗面科技，Kimi 智能助手背后的技术提供方，擅长长文本处理。",
    attributes: {
      openai: {
        ...THINKING_TYPE_CONFIG,
      },
    },
    models: [
      createMultimodalModel("kimi-k2.5", ConfigFragments.ContextWindow._256K),
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai",
    defaultApiUrl: "https://api.minimax.chat/v1/",
    avatarUrl: "static/images/providers/minimax.svg",
    description: "专注于通用人工智能，提供高质量的语言模型和语音合成服务。",
    attributes: {
      openai: {
        ...MINIMAX_THINKING_CONFIG,
      },
    },
    models: [
      createTextModel("MiniMax-M2.5", ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
      createTextModel("MiniMax-M2.5-highspeed", ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
      createTextModel("MiniMax-M2.1", ConfigFragments.ContextWindow._205K, ConfigFragments.MaxOutput._131K),
      createTextModel("MiniMax-M2", ConfigFragments.ContextWindow._197K, ConfigFragments.MaxOutput._128K),
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    defaultApiUrl: "https://api.deepseek.com",
    avatarUrl: "static/images/providers/deepseek.svg",
    description:
      "深度求索，以高性价比和强大的代码生成能力著称，支持深度思考模式。",
    attributes: {
      openai: {
        ...THINKING_TYPE_CONFIG,
      },
    },
    models: [
      createTextModel("deepseek-v4-flash", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._384K),
      createTextModel("deepseek-v4-pro", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._384K),
    ],
  },

  // ==================== 国际平台 ====================
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    defaultApiUrl: "https://api.openai.com/v1/",
    avatarUrl: "static/images/providers/openai.svg",
    description: "全球领先的 AI 研究机构，ChatGPT 和 GPT 系列模型的创造者。",
    attributes: {
      openai: {}, // GPT-4o 不支持 reasoning_effort，只有 o 系列和 GPT-5 支持
    },
    models: [
      // GPT-4o 系列（稳定支持，但不支持 reasoning_effort）
      createMultimodalModel("gpt-4o", ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
      createMultimodalModel("gpt-4o-mini", ConfigFragments.ContextWindow._128K, ConfigFragments.WithoutThinking),
      // GPT-5 系列（同时支持两个协议，支持 reasoning_effort）
      createMultimodalModel("gpt-5.4", ConfigFragments.ContextWindow._1_1M),
      createMultimodalModel("gpt-5-mini", ConfigFragments.ContextWindow._400K),
      createMultimodalModel("gpt-5", ConfigFragments.ContextWindow._1_1M),
      // o 系列推理模型（同时支持两个协议，支持 reasoning_effort）
      createMultimodalModel("o4-mini", ConfigFragments.ContextWindow._200K),
      createMultimodalModel("o3-mini", ConfigFragments.ContextWindow._200K),
      createMultimodalModel("o1", ConfigFragments.ContextWindow._200K),
      // Embedding 模型
      createEmbeddingModel("text-embedding-3-small", ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._2000),
    ],
  },
  {
    id: "openai-response",
    name: "OpenAI (Responses API)",
    protocol: "openai-response",
    defaultApiUrl: "https://api.openai.com/v1/",
    avatarUrl: "static/images/providers/openai.svg",
    description: "使用 OpenAI 最新 Responses API（beta），专为 o 系列推理模型和高级智能体场景设计。",
    attributes: {
      "openai-response": {
        ...OPENAI_REASONING_CONFIG,
      },
    },
    models: [
      // Responses API 独占模型
      createMultimodalModel("gpt-5-codex", ConfigFragments.ContextWindow._1_1M),
      createMultimodalModel("computer-use-preview", ConfigFragments.ContextWindow._128K),

      // o 系列推理模型（Responses API 提供更佳体验）
      createMultimodalModel("o4-mini", ConfigFragments.ContextWindow._200K),
      createMultimodalModel("o3-pro", ConfigFragments.ContextWindow._200K),
      createMultimodalModel("o3-mini", ConfigFragments.ContextWindow._200K),
      createMultimodalModel("o1", ConfigFragments.ContextWindow._200K),

      // GPT-5 系列（原生支持，功能更完整）
      createMultimodalModel("gpt-5.4", ConfigFragments.ContextWindow._1_1M),
      createMultimodalModel("gpt-5-mini", ConfigFragments.ContextWindow._400K),
      createMultimodalModel("gpt-5-pro", ConfigFragments.ContextWindow._1_1M),
      createMultimodalModel("gpt-5", ConfigFragments.ContextWindow._1_1M),

      // GPT-4o 系列（兼容支持）
      createMultimodalModel("gpt-4o", ConfigFragments.ContextWindow._128K, ConfigFragments.WithTools),
      createMultimodalModel("gpt-4o-mini", ConfigFragments.ContextWindow._128K, ConfigFragments.WithTools),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    defaultApiUrl: "https://api.anthropic.com/",
    avatarUrl: "static/images/providers/anthropic.svg",
    description:
      "由前 OpenAI 研究人员创立，专注于构建安全、可靠的 Claude 系列模型。",
    attributes: {},
  },
  {
    id: "google",
    name: "Google",
    protocol: "gemini",
    defaultApiUrl: "https://generativelanguage.googleapis.com/",
    avatarUrl: "static/images/providers/google.svg",
    description:
      "谷歌提供的 Gemini 大模型服务，具备强大的多模态理解与生成能力。",
    attributes: {},
    models: [
      createMultimodalModel("gemini-3.1-pro-preview", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),
      createMultimodalModel("gemini-3-flash-preview", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),
      createMultimodalModel("gemini-2.5-flash", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),
      createMultimodalModel("gemini-2.5-pro", ConfigFragments.ContextWindow._1M, ConfigFragments.MaxOutput._66K),
      createMultimodalModel(
        "gemini-2.5-flash-image",
        ConfigFragments.ContextWindow._33K,
        ConfigFragments.MaxOutput._33K,
        ConfigFragments.ImageOutput
      ),
    ],
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    protocol: "openai",
    defaultApiUrl:
      "https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}/",
    avatarUrl: "static/images/providers/azure-openai.svg",
    description:
      "微软 Azure 云平台提供的企业级 OpenAI 服务，具备更高的安全性和合规性。",
    attributes: {
      openai: {
        ...AZURE_REASONING_CONFIG,
      },
    },
  },
  {
    id: "groq",
    name: "Groq",
    protocol: "openai",
    defaultApiUrl: "https://api.groq.com/openai/v1/",
    avatarUrl: "static/images/providers/groq.svg",
    description: "以极致的推理速度著称，提供低延迟的大语言模型 API 服务。",
    attributes: {
      openai: {
        ...GROQ_REASONING_CONFIG,
      },
    },
  },
];

/**
 * 转换 Provider Templates 的 URL 为完整 URL
 * @param baseUrl 基础 URL（如 http://localhost:3000）
 * @returns 转换后的 templates 数组
 */
export function transformProviderTemplateUrls(
  baseUrl?: string
): ProviderTemplate[] {
  if (!baseUrl) {
    return PROVIDER_TEMPLATES;
  }

  return PROVIDER_TEMPLATES.map((template) => ({
    ...template,
    avatarUrl: template.avatarUrl
      ? `${baseUrl}${template.avatarUrl}`
      : undefined,
  }));
}
