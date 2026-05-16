/**
 * Thinking 配置生成器接口
 * 统一规范：所有配置生成器只接受 effort 级别字符串
 * - 'off' 表示禁用思考
 * - 其他值表示开启思考并指定强度
 */
export interface ThinkingConfigGenerator {
  thinking: {
    get: (effort: string) => Record<string, any>;
  };
}

/**
 * enable_thinking 模式（硅基流动、阿里云、百度等）
 * 只支持开关，不支持强度级别
 */
export const ENABLE_THINKING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      // 'off' 表示禁用，其他任何值都表示开启
      return { enable_thinking: effort !== 'off' };
    },
  },
};

/**
 * thinking.type + reasoning_effort 混合模式（DeepSeek、火山引擎等）
 * - 'off' → { thinking: { type: 'disabled' } }
 * - 其他值 → { reasoning_effort: "强度值" }
 */
export const THINKING_WITH_EFFORT_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      if (effort === 'off') {
        return { thinking: { type: 'disabled' } };
      }
      
      // 其他任何值都作为 reasoning_effort 参数
      return { reasoning_effort: effort };
    },
  },
};

/**
 * MiniMax 风格配置
 */
export const MINIMAX_THINKING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      return {
        thinking: {
          enabled: effort !== 'off',
        },
      };
    },
  },
};

/**
 * OpenAI Responses API reasoning 配置
 * 格式: { "reasoning": { "effort": "low" } }
 * 适用于：OpenAI Responses API、火山引擎等使用相同格式的供应商
 */
export const OPENAI_RESPONSE_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      if (effort === 'off') {
        return { thinking: { type: 'disabled' } };
      }
      
      return { reasoning: { effort: effort } };
    },
  },
};

/**
 * Azure OpenAI reasoning_effort 配置
 */
export const AZURE_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      if (effort === 'off') {
        return { thinking: { type: 'disabled' } };
      }
      
      return { reasoning_effort: effort };
    },
  },
};

/**
 * Groq reasoning_format 配置
 */
export const GROQ_REASONING_CONFIG: ThinkingConfigGenerator = {
  thinking: {
    get: (effort: string) => {
      if (effort === 'off') {
        return { thinking: { type: 'disabled' } };
      }
      
      return { reasoning_format: "parsed" };
    },
  },
};
