
export interface ProviderTemplate {
  id: string;
  name: string;
  protocol: string;
  defaultApiUrl: string;
  avatarUrl?: string;
  description?: string;
  attributes?: Record<string, any>;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ==================== 国内平台 ====================
  {
    id: 'siliconflow',
    name: '硅基流动',
    protocol: 'openai',
    defaultApiUrl: 'https://api.siliconflow.cn/v1/',
    avatarUrl: '/static/images/providers/siliconflow.svg',
    description: '提供高性价比的开源模型 API 服务，支持多种主流大语言模型。',
    attributes: {
      openai: {
        // 硅基流动开启思考需要传递 thinking_enabled: true
        thinkingEnabled: {
          thinking_enabled: true,
        },
      },
    },
  },
  {
    id: 'aliyun-bailian',
    name: '阿里云百炼',
    protocol: 'openai',
    defaultApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    avatarUrl: '/static/images/providers/aliyun-bailian.svg',
    description: '阿里云推出的大模型服务平台，提供通义千问等自研模型及第三方模型接入。',
    attributes: {
      openai: {
        // 阿里云百炼开启思考需要传递 thinking_enabled: true
        thinkingEnabled: {
          thinking_enabled: true,
        },
      },
    },
  },
  {
    id: 'volcengine',
    name: '火山引擎',
    protocol: 'openai',
    defaultApiUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
    avatarUrl: '/static/images/providers/volcengine.svg',
    description: '字节跳动旗下云平台，提供豆包大模型及企业级 AI 解决方案。',
    attributes: {
      openai: {
        // 火山引擎开启思考需要传递 thinking: { type: "enabled" }
        thinkingEnabled: {
          thinking: {
            type: "enabled"
          }
        },
        // 火山引擎关闭思考需要传递 thinking: { type: "disabled" }
        thinkingDisabled: {
          thinking: {
            type: "disabled"
          }
        },
      },
    },
  },
  {
    id: 'baidu-qianfan',
    name: '百度智能云',
    protocol: 'openai',
    defaultApiUrl: 'https://qianfan.baidubce.com/v2/',
    avatarUrl: '/static/images/providers/baidu-qianfan.svg',
    description: '百度千帆大模型平台，提供文心一言系列模型及完整的 AI 开发生态。',
    attributes: {
      openai: {
        // 百度部分模型支持 enable_thinking 参数
        thinkingEnabled: {
          enable_thinking: true,
        },
      },
    },
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    protocol: 'openai',
    defaultApiUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    avatarUrl: '/static/images/providers/zhipu.svg',
    description: '源自清华技术背景，提供 GLM 系列大语言模型，支持强大的推理与代码能力。',
    attributes: {
      openai: {
        // 智谱 GLM-4-Plus 等模型支持 thinking 对象
        thinkingEnabled: {
          thinking: {
            type: "enabled"
          }
        },
        thinkingDisabled: {
          thinking: {
            type: "disabled"
          }
        },
      },
    },
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    protocol: 'openai',
    defaultApiUrl: 'https://api.moonshot.cn/v1/',
    avatarUrl: '/static/images/providers/moonshot.svg',
    description: '月之暗面科技，Kimi 智能助手背后的技术提供方，擅长长文本处理。',
    attributes: {
      openai: {
        // Kimi K2 等模型支持 thinking 参数
        thinkingEnabled: {
          thinking: {
            enabled: true
          }
        },
      },
    },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai',
    defaultApiUrl: 'https://api.minimax.chat/v1/',
    avatarUrl: '/static/images/providers/minimax.svg',
    description: '专注于通用人工智能，提供高质量的语言模型和语音合成服务。',
    attributes: {
      openai: {
        // MiniMax 模型支持 thinking 参数
        thinkingEnabled: {
          thinking: {
            enabled: true
          }
        },
      },
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    defaultApiUrl: 'https://api.deepseek.com/v1/',
    avatarUrl: '/static/images/providers/deepseek.svg',
    description: '深度求索，以高性价比和强大的代码生成能力著称，支持深度思考模式。',
    attributes: {
      openai: {
        // DeepSeek R1 系列支持 enable_thinking
        thinkingEnabled: {
          enable_thinking: true,
        },
      },
    },
  },

  // ==================== 国际平台 ====================
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    defaultApiUrl: 'https://api.openai.com/v1/',
    avatarUrl: '/static/images/providers/openai.svg',
    description: '全球领先的 AI 研究机构，ChatGPT 和 GPT 系列模型的创造者。',
    attributes: {
      openai: {
        // OpenAI o1/o3 系列模型通过 reasoning_effort 控制思考强度
        thinkingEnabled: {
          reasoning_effort: "high",
        },
      },
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com/',
    avatarUrl: '/static/images/providers/anthropic.svg',
    description: '由前 OpenAI 研究人员创立，专注于构建安全、可靠的 Claude 系列模型。',
    attributes: {},
  },
  {
    id: 'google',
    name: 'Google',
    protocol: 'gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/',
    avatarUrl: '/static/images/providers/google.svg',
    description: '谷歌提供的 Gemini 大模型服务，具备强大的多模态理解与生成能力。',
    attributes: {},
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    protocol: 'openai',
    defaultApiUrl: 'https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}/',
    avatarUrl: '/static/images/providers/azure-openai.svg',
    description: '微软 Azure 云平台提供的企业级 OpenAI 服务，具备更高的安全性和合规性。',
    attributes: {
      openai: {
        // Azure OpenAI o1/o3 系列模型支持 reasoning_effort
        thinkingEnabled: {
          reasoning_effort: "medium",
        },
      },
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    defaultApiUrl: 'https://api.groq.com/openai/v1/',
    avatarUrl: '/static/images/providers/groq.svg',
    description: '以极致的推理速度著称，提供低延迟的大语言模型 API 服务。',
    attributes: {
      openai: {
        // Groq 部分模型支持 reasoning_format
        thinkingEnabled: {
          reasoning_format: "parsed",
        },
      },
    },
  },
];
