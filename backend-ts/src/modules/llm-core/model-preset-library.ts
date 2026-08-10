import { ModelConfig } from './types/provider.types';
import {
  ConfigFragments,
  mergeConfig,
} from './utils/model-config.helper';

/**
 * 模型预设定义
 */
export interface ModelPreset {
  id: string;
  label: string;
  patterns: RegExp[];
  modeType: 'text' | 'embedding';
  config: ModelConfig;
  thinkingEfforts?: string[];
}

// ── 内联配置片段（ConfigFragments 中缺失的值） ──────────
const C16K = { contextWindow: 16000 };
const C200K = ConfigFragments.ContextWindow._200K;
const C256K = ConfigFragments.ContextWindow._256K;
const C1M = ConfigFragments.ContextWindow._1M;
const Out4K = { maxOutputTokens: 4096 };
const Out8K = { maxOutputTokens: 8192 };
const Out16K = { maxOutputTokens: 16384 };
const Out32K = { maxOutputTokens: 32000 };
const Out64K = { maxOutputTokens: 65536 };
const Out128K = ConfigFragments.MaxOutput._128K;
const Out384K = ConfigFragments.MaxOutput._384K;
const Dim3072 = { vectorDimensions: 3072 };

/**
 * 模型预设库
 *
 * 独立于供应商的模型配置预设，按模型名正则匹配。
 * 用于自定义供应商（custom provider）添加模型时自动匹配参数，
 * 覆盖 one-api / new-api 等代理场景下常见模型名的配置需求。
 *
 * 匹配策略：按数组顺序遍历，第一个匹配即返回。
 * 因此更具体的模式应排在前面。
 *
 * thinking 标记规则：
 *   thinking feature = 混合思考，即用户可调节思考强度或开关思考。
 *   如果模型推理固定不可调节（如 DeepSeek-R1 始终推理、Kimi K3 always-on），
 *   则不标记 thinking，否则前端会错误显示思考强度选择器。
 *
 * 数据截至 2026-08，覆盖各供应商最新在售模型系列。
 */
export const MODEL_PRESETS: ModelPreset[] = [
  // ════════════════════════════════════════════════════════
  //  OpenAI
  //  GPT-5.6 (2026-07) 当前旗舰 → GPT-5.5 (2026-04) → GPT-5.4 (2026-03)
  //  GPT-4o 仍在 API 中可用（ChatGPT 端 2026-02 退役）
  //  o3/o4-mini API 仍可用
  // ════════════════════════════════════════════════════════
  {
    id: 'gpt-5.6',
    label: 'GPT-5.6',
    patterns: [/^gpt-5\.6/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    patterns: [/^gpt-5\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    patterns: [/^gpt-5\.4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini/nano',
    patterns: [/^gpt-5-(mini|nano)/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking,
      ConfigFragments.ContextWindow._400K, Out64K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5-general',
    label: 'GPT-5 (other)',
    patterns: [/^gpt-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'o-series',
    label: 'OpenAI o-series',
    patterns: [/^o\d/, /^o\d-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C200K, Out128K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    patterns: [/^gpt-4o/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, ConfigFragments.ContextWindow._128K, Out16K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'gpt-4-turbo',
    label: 'GPT-4 Turbo',
    patterns: [/^gpt-4-turbo/, /^gpt-4-0/, /^gpt-4-1/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, ConfigFragments.ContextWindow._128K, Out4K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'gpt-3.5',
    label: 'GPT-3.5',
    patterns: [/^gpt-3\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C16K, Out4K,
    ),
    thinkingEfforts: [],
  },

  // ════════════════════════════════════════════════════════
  //  Anthropic Claude
  //  Fable 5 / Mythos 5 (2026-06) → Opus 4.8 (2026-05) → Opus 4.6 (2026-02)
  //  Sonnet 4.6 (2026-02) → Haiku 4.5 (2025-10)
  //  Opus/Sonnet 5 已发布。3.5 系列已退役。
  //  自适应思考无法完全关闭，但 openai 协议代理可能支持。
  // ════════════════════════════════════════════════════════
  {
    id: 'claude-fable',
    label: 'Claude Fable 5',
    patterns: [/claude.*fable/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-mythos',
    label: 'Claude Mythos 5',
    patterns: [/claude.*mythos/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    patterns: [/claude.*opus.*5/, /claude-opus-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    patterns: [/claude.*sonnet.*5/, /claude-sonnet-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out64K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'claude-opus-4',
    label: 'Claude Opus 4.x',
    patterns: [/claude.*opus/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out128K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-4',
    label: 'Claude Sonnet 4.x',
    patterns: [/claude.*sonnet/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out64K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku',
    patterns: [/claude.*haiku/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C200K, Out64K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'claude-3-5',
    label: 'Claude 3.5 (legacy)',
    patterns: [/claude-3/, /claude.*3\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C200K, Out8K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'claude-general',
    label: 'Claude (other)',
    patterns: [/^claude/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C200K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },

  // ════════════════════════════════════════════════════════
  //  Google Gemini
  //  3.6 Flash (2026-07) → 3.5 Flash (2026-05) → 3.1 Pro (2026-02)
  //  3.1+ 支持 thinkingLevel；2.5 及以下不支持
  // ════════════════════════════════════════════════════════
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3.x Pro',
    patterns: [/gemini-3.*pro/, /gemini.*3\.1.*pro/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out64K,
    ),
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3.x Flash',
    patterns: [/gemini-3.*flash/, /gemini.*3\.[5-6].*flash/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out64K,
    ),
    thinkingEfforts: ['minimal', 'low', 'medium', 'high'],
  },
  {
    id: 'gemini-2.5',
    label: 'Gemini 2.5 (no thinking)',
    patterns: [/gemini.*2\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C1M, Out64K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'gemini-general',
    label: 'Gemini (other)',
    patterns: [/^gemini/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C1M, Out8K,
    ),
    thinkingEfforts: [],
  },

  // ════════════════════════════════════════════════════════
  //  DeepSeek
  //  V4 Pro/Flash (2026-04) 当前旗舰，1M 上下文，支持思考开关
  //  deepseek-chat / deepseek-reasoner 已指向 V4-Flash
  //  R1 (2025-01) 推理固定不可调节，不标记 thinking
  // ════════════════════════════════════════════════════════
  {
    id: 'deepseek-v4',
    label: 'DeepSeek V4',
    patterns: [/deepseek.*v4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out384K,
    ),
    thinkingEfforts: ['none', 'high', 'max'],
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek R1 / Reasoner',
    patterns: [/deepseek.*r1/, /deepseek-reasoner/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking,
      ConfigFragments.ContextWindow._128K, Out128K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat (V3+)',
    patterns: [/deepseek-chat/, /deepseek.*v3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    thinkingEfforts: ['none', 'high', 'max'],
  },
  {
    id: 'deepseek-general',
    label: 'DeepSeek (other)',
    patterns: [/^deepseek/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking,
      ConfigFragments.ContextWindow._128K,
    ),
    thinkingEfforts: [],
  },

  // ════════════════════════════════════════════════════════
  //  Qwen (Alibaba)
  //  Qwen3.7-Max (2026-05) → Qwen3.7-Plus (2026-06) → Qwen3.6-Plus (2026-04)
  //  Qwen3.8-Max preview (2026-07)
  //  稳定别名: qwen-plus / qwen-turbo (1M context)
  // ════════════════════════════════════════════════════════
  {
    id: 'qwen-max',
    label: 'Qwen Max',
    patterns: [/qwen.*max/, /qwen3.*max/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C256K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-plus',
    label: 'Qwen Plus',
    patterns: [/qwen.*plus/, /qwen3.*plus/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C1M, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-turbo',
    label: 'Qwen Turbo',
    patterns: [/qwen.*turbo/, /qwen3.*turbo/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C1M, Out8K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'qwen-vl',
    label: 'Qwen VL (multimodal)',
    patterns: [/qwen.*vl/, /qwen3.*vl/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C256K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-general',
    label: 'Qwen (other)',
    patterns: [/^qwen/, /^qwen3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking,
      ConfigFragments.ContextWindow._128K,
    ),
    thinkingEfforts: [],
  },

  // ════════════════════════════════════════════════════════
  //  Kimi (Moonshot AI)
  //  K3 (2026-07) 当前旗舰, 2.8T MoE, 1M context, 始终推理不可调节
  //  K2.7-Code (2026-06) 编码专用, 强制思考模式不可调节
  //  K2 系列已于 2026-05 退役
  // ════════════════════════════════════════════════════════
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    patterns: [/kimi.*k3/, /kimi-k3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C1M, Out8K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'kimi-code',
    label: 'Kimi Code',
    patterns: [/kimi.*code/, /kimi.*cod/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking, C256K, Out8K,
    ),
    thinkingEfforts: [],
  },
  {
    id: 'kimi-general',
    label: 'Kimi (other)',
    patterns: [/kimi/, /moonshot/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },

  // ════════════════════════════════════════════════════════
  //  GLM (Zhipu AI / Z.ai)
  //  GLM-5.2 (2026-06) 当前旗舰
  //  GLM-4.7 (200K) → GLM-4.6 (200K) → GLM-4.5 (128K)
  // ════════════════════════════════════════════════════════
  {
    id: 'glm-5',
    label: 'GLM-5',
    patterns: [/glm-?5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C200K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4.7',
    label: 'GLM-4.7',
    patterns: [/glm-?4\.7/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking, C200K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4.5',
    label: 'GLM-4.5',
    patterns: [/glm-?4\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithToolsAndThinking,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4-general',
    label: 'GLM-4 (other)',
    patterns: [/glm-?4/, /glm4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithoutThinking,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    thinkingEfforts: [],
  },

  // ════════════════════════════════════════════════════════
  //  Embedding 模型
  // ════════════════════════════════════════════════════════
  {
    id: 'embedding-openai-large',
    label: 'OpenAI Embedding 3-Large',
    patterns: [/^text-embedding-3-large/, /^text-embedding-3-l/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._8K, Dim3072,
    ),
  },
  {
    id: 'embedding-openai-small',
    label: 'OpenAI Embedding 3-Small',
    patterns: [/^text-embedding-3-small/, /^text-embedding-3-s/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._1536,
    ),
  },
  {
    id: 'embedding-openai-general',
    label: 'OpenAI Embedding (other)',
    patterns: [/^text-embedding/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._1536,
    ),
  },
  {
    id: 'embedding-bge',
    label: 'BGE Embedding',
    patterns: [/bge-/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._1024,
    ),
  },
  {
    id: 'embedding-qwen',
    label: 'Qwen Embedding',
    patterns: [/qwen.*embedding/, /qwen.*embed/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._32K, ConfigFragments.VectorDim._1024,
    ),
  },
  {
    id: 'embedding-jina',
    label: 'Jina Embedding',
    patterns: [/jina.*embed/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._8K, ConfigFragments.VectorDim._1024,
    ),
  },
  {
    id: 'embedding-voyage',
    label: 'Voyage Embedding',
    patterns: [/voyage-/],
    modeType: 'embedding',
    config: mergeConfig(
      ConfigFragments.ContextWindow._32K, ConfigFragments.VectorDim._1024,
    ),
  },
];

/**
 * 根据模型名查找预设配置
 * @param modelName 模型名（如 'gpt-4o', 'deepseek-chat'）
 * @param ownedBy 远程 API 返回的 owned_by 字段（可选，当前未使用，预留）
 * @returns 匹配的预设，无匹配返回 null
 */
export function findModelPreset(
  modelName: string,
  ownedBy?: string,
): ModelPreset | null {
  const lower = modelName.toLowerCase();
  for (const preset of MODEL_PRESETS) {
    if (preset.patterns.some((p) => p.test(lower))) {
      return preset;
    }
  }
  return null;
}

/**
 * 获取所有预设的精简格式（供前端 API 返回）
 * 正则序列化为 source 字符串，前端通过 new RegExp(source) 重建
 */
export function getAllPresets() {
  return MODEL_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    patterns: p.patterns.map((r) => r.source),
    modeType: p.modeType,
    config: p.config,
    thinkingEfforts: p.thinkingEfforts ?? [],
  }));
}
