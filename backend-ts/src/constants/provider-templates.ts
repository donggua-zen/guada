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
      {
        modelName: "deepseek-ai/DeepSeek-V3.2",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 160000,
        },
      },
      {
        modelName: "deepseek-ai/DeepSeek-V3.1-Terminus",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 160000,
        },
      },
      {
        modelName: "deepseek-ai/DeepSeek-R1",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 160000,
        },
      },
      {
        modelName: "Qwen/Qwen3.5-397B-A17B",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      {
        modelName: "Qwen/Qwen3.5-122B-A10B",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      {
        modelName: "Qwen/Qwen3-VL-32B-Instruct",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 128000,
        },
      },
      {
        modelName: "Qwen/Qwen3-VL-235B-A22B-Thinking",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      {
        modelName: "moonshotai/Kimi-K2-Thinking",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 200000,
        },
      },
      {
        modelName: "Qwen/Qwen3-Embedding-8B",
        modeType: "embedding",
        config: {
          contextWindow: 32000,
          vectorDimensions: 4096,
        },
      },
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
      {
        modelName: "qwen3.6-plus",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
        },
      },
      {
        modelName: "qwen3.6-plus-2026-04-02",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
        },
      },
      //qwen3.5-397b-a17b
      {
        modelName: "qwen3.5-397b-a17b",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //qwen3.5-122b-a10b
      {
        modelName: "qwen3.5-122b-a10b",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //qwen3.5-27b
      {
        modelName: "qwen3.5-27b",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //qwen3.5-35b-a3b
      {
        modelName: "qwen3.5-35b-a3b",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //deepseek-v3.2 128K
      {
        modelName: "deepseek-v3.2",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 128000,
        },
      },
      //deepseek-v3.1 128K
      {
        modelName: "deepseek-v3.1",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 128000,
        },
      },
      //deepseek-r1-0528
      {
        modelName: "deepseek-r1-0528",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 128000,
        },
      },
      //deepseek-v3 64K
      {
        modelName: "deepseek-v3",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 64000,
        },
      },
      //kimi-k2.5 256K
      {
        modelName: "kimi-k2.5",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //glm-5 198K
      {
        modelName: "glm-5",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 198000,
        },
      },
      //MiniMax-M2.5 200K
      {
        modelName: "minimax-m2.5",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 200000,
        },
      },
      //text-embedding-v4
      {
        modelName: "text-embedding-v4",
        modeType: "embedding",
        config: {
          contextWindow: 32000,
          vectorDimensions: 1024,
        },
      },
    ],
  },
  {
    id: "volcengine",
    name: "火山引擎",
    protocol: "openai",
    defaultApiUrl: "https://ark.cn-beijing.volces.com/api/v3/",
    avatarUrl: "static/images/providers/volcengine.svg",
    description: "字节跳动旗下云平台，提供豆包大模型及企业级 AI 解决方案。",
    attributes: {
      openai: {
        ...THINKING_TYPE_CONFIG,
        thinkingEffort: ["low", "medium", "high", "minimal"],
      },
    },
    models: [
      {
        modelName: "doubao-seed-2-0-pro-260215",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      {
        modelName: "doubao-seed-2-0-lite-260215",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      {
        modelName: "doubao-seed-2-0-mini-260215",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //doubao-seed-2-0-code-preview-260215
      {
        modelName: "doubao-seed-2-0-code-preview-260215",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
      //deepseek-v3-2-251201 128K (注意不支持thinkingEffort)
      {
        modelName: "deepseek-v3-2-251201",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 128000,
        },
      },
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
      {
        modelName: "GLM-5",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-5-Turbo",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-4-Plus",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-4.7",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-4.7-FlashX",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-4.6",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
          maxOutputTokens: 128000,
        },
      },
      {
        modelName: "GLM-4.5",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 128000,
          maxOutputTokens: 96000,
        },
      },
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
      {
        modelName: "kimi-k2.5",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 256000,
        },
      },
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
      {
        modelName: "MiniMax-M2.5",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 205000,
          maxOutputTokens: 131000,
        },
      },
      {
        modelName: "MiniMax-M2.5-highspeed",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 205000,
          maxOutputTokens: 131000,
        },
      },
      {
        modelName: "MiniMax-M2.1",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 205000,
          maxOutputTokens: 131000,
        },
      },
      {
        modelName: "MiniMax-M2",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 197000,
          maxOutputTokens: 128000,
        },
      },
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
      //DeepSeek-V4-Flash
      {
        modelName: "deepseek-v4-flash",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 384000,//384K
        },
      },
      //DeepSeek-V4-Pro
      {
        modelName: "deepseek-v4-pro",
        modeType: "text",
        config: {
          inputCapabilities: ["text"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 384000,//384K
        },
      }
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
      openai: {
        ...OPENAI_REASONING_CONFIG,
      },
    },
    models: [
      {
        modelName: "gpt-5.4",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1100000,
        },
      },
      {
        modelName: "gpt-5-mini",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 400000,
        },
      },
      {
        modelName: "gpt-4o",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 128000,
        },
      },
      {
        modelName: "gpt-4o-mini",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools"],
          contextWindow: 128000,
        },
      },
      {
        modelName: "o4-mini",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
        },
      },
      {
        modelName: "o3-pro",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
        },
      },
      {
        modelName: "o3-mini",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 200000,
        },
      },
      {
        modelName: "text-embedding-3-small",
        modeType: "embedding",
        config: {
          contextWindow: 8000,
          vectorDimensions: 2000,
        },
      },
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
      {
        modelName: "gemini-3.1-pro-preview",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 66000,
        },
      },
      {
        modelName: "gemini-3-flash-preview",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 66000,
        },
      },
      {
        modelName: "gemini-2.5-flash",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 66000,
        },
      },
      {
        modelName: "gemini-2.5-pro",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text"],
          features: ["tools", "thinking"],
          contextWindow: 1000000,
          maxOutputTokens: 66000,
        },
      },
      {
        modelName: "gemini-2.5-flash-image",
        modeType: "text",
        config: {
          inputCapabilities: ["text", "image"],
          outputCapabilities: ["text", "image"],
          features: ["tools", "thinking"],
          contextWindow: 33000,
          maxOutputTokens: 33000,
        },
      },
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
