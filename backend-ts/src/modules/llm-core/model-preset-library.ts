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
  /**
   * 能力声明：能不能思考（缺省 = 未声明，fail-safe 不能思考）。
   * true 且未声明 thinkingEfforts 时默认菜单 [none, on]（最小诚实开关）。
   */
  supportsThinking?: boolean;
  /** 强度档位菜单（仅 supportsThinking: true 时有意义；可含 on，可不含 none=不可关） */
  thinkingEfforts?: string[];
}

// ── 内联配置片段（ConfigFragments 中缺失的值） ──────────
const C16K = { contextWindow: 16000 };
const C200K = ConfigFragments.ContextWindow._200K;
const C256K = ConfigFragments.ContextWindow._256K;
const C1M = ConfigFragments.ContextWindow._1M;
const C8K = { contextWindow: 8000 };
const Out4K = { maxOutputTokens: 4096 };
const Out8K = { maxOutputTokens: 8192 };
const Out16K = { maxOutputTokens: 16384 };
const Out32K = { maxOutputTokens: 32000 };
const Out64K = { maxOutputTokens: 65536 };
const Out128K = ConfigFragments.MaxOutput._128K;
const Out131K = ConfigFragments.MaxOutput._131K;
const Out384K = ConfigFragments.MaxOutput._384K;
const C131K = { contextWindow: 131072 };
const C204K = { contextWindow: 204800 };
const C262K = { contextWindow: 262144 };
const C300K = { contextWindow: 300000 };
const C500K = { contextWindow: 500000 };
const C128K = ConfigFragments.ContextWindow._128K;
const Out65K = { maxOutputTokens: 65536 };
const Out80K = { maxOutputTokens: 80000 };
const Out256K = { maxOutputTokens: 256000 };
const Out500K = { maxOutputTokens: 500000 };
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
 * 思考声明规则（能力与档位分离，对齐 DSH reasoning + thinkingLevelMap）：
 *   supportsThinking: true = 能思考；未声明 thinkingEfforts 时默认菜单
 *   [none, on]（最小诚实开关）；强度可调的模型显式声明档位数组；
 *   强制思考模型（不可关）声明不含 none 的菜单（如 ['on']、['low','high','max']）；
 *   supportsThinking: false = 不能思考（无需档位字段）。
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
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    patterns: [/^gpt-5\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    patterns: [/^gpt-5\.4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini/nano',
    patterns: [/^gpt-5-(mini|nano)/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._400K, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-5-general',
    label: 'GPT-5 (other)',
    patterns: [/^gpt-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'o-series',
    label: 'OpenAI o-series',
    patterns: [/^o\d/, /^o\d-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C200K, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    patterns: [/^gpt-4o/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, ConfigFragments.ContextWindow._128K, Out16K,
    ),
    supportsThinking: false,
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    patterns: [/gpt-4\.1/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out32K,
    ),
    supportsThinking: false,
  },
  {
    id: 'gpt-realtime',
    label: 'GPT Realtime',
    patterns: [/gpt-realtime/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out32K,
    ),
    // 官方档位含 minimal / xhigh，且不支持关闭；此处按本库 gpt-5 系惯例取主档
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gpt-4-turbo',
    label: 'GPT-4 Turbo',
    patterns: [/^gpt-4-turbo/, /^gpt-4-0/, /^gpt-4-1/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, ConfigFragments.ContextWindow._128K, Out4K,
    ),
    supportsThinking: false,
  },
  {
    id: 'gpt-4-general',
    label: 'GPT-4 (other)',
    patterns: [/^gpt-4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C8K, Out8K,
    ),
    supportsThinking: false,
  },
  {
    id: 'gpt-3.5',
    label: 'GPT-3.5',
    patterns: [/^gpt-3\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C16K, Out4K,
    ),
    supportsThinking: false,
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
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-mythos',
    label: 'Claude Mythos 5',
    patterns: [/claude.*mythos/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    patterns: [/claude.*opus.*5/, /claude-opus-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    patterns: [/claude.*sonnet.*5/, /claude-sonnet-5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'claude-opus-4',
    label: 'Claude Opus 4.x',
    patterns: [/claude.*opus/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-4',
    label: 'Claude Sonnet 4.x',
    patterns: [/claude.*sonnet/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku',
    patterns: [/claude.*haiku/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C200K, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'claude-3-5',
    label: 'Claude 3.5 (legacy)',
    patterns: [/claude-3/, /claude.*3\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C200K, Out8K,
    ),
    supportsThinking: false,
  },
  {
    id: 'claude-general',
    label: 'Claude (other)',
    patterns: [/^claude/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C200K, Out8K,
    ),
    supportsThinking: true,
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
      ConfigFragments.WithTools, C1M, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3.x Flash',
    patterns: [/gemini-3.*flash/, /gemini.*3\.[5-6].*flash/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['minimal', 'low', 'medium', 'high'],
  },
  {
    id: 'gemini-2.5',
    label: 'Gemini 2.5 (no thinking)',
    patterns: [/gemini.*2\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out64K,
    ),
    supportsThinking: false,
  },
  {
    id: 'gemma-4',
    label: 'Gemma 4',
    patterns: [/gemma-?4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out32K,
    ),
    // 官方档位仅 minimal / high（低档与中档显式不支持），不可关闭
    supportsThinking: true,
    thinkingEfforts: ['minimal', 'high'],
  },
  {
    id: 'gemini-deep-research',
    label: 'Gemini Deep Research',
    patterns: [/deep-research/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C131K, Out65K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'gemini-general',
    label: 'Gemini (other)',
    patterns: [/^gemini/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out8K,
    ),
    supportsThinking: false,
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
      ConfigFragments.WithTools, C1M, Out384K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'high', 'max'],
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek R1 / Reasoner',
    patterns: [/deepseek.*r1/, /deepseek-reasoner/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['on'],
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat (V3+)',
    patterns: [/deepseek-chat/, /deepseek.*v3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'high', 'max'],
  },
  {
    id: 'deepseek-general',
    label: 'DeepSeek (other)',
    patterns: [/^deepseek/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K,
    ),
    supportsThinking: false,
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
      ConfigFragments.WithTools, C256K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-plus',
    label: 'Qwen Plus',
    patterns: [/qwen.*plus/, /qwen3.*plus/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-turbo',
    label: 'Qwen Turbo',
    patterns: [/qwen.*turbo/, /qwen3.*turbo/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out8K,
    ),
    supportsThinking: false,
  },
  {
    id: 'qwen-vl',
    label: 'Qwen VL (multimodal)',
    patterns: [/qwen.*vl/, /qwen3.*vl/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'qwen-general',
    label: 'Qwen (other)',
    patterns: [/^qwen/, /^qwen3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K,
    ),
    supportsThinking: true,
  },

  // ════════════════════════════════════════════════════════
  //  Kimi (Moonshot AI)
  //  K3 (2026-07) 当前旗舰, 2.8T MoE, 1M context, 始终推理不可调节
  //  K2.7-Code (2026-06) 编码专用, 强制思考模式不可调节
  //  K2 系列已于 2026-05 退役
  // ════════════════════════════════════════════════════════
  {
    id: 'kimi-k3-256k',
    label: 'Kimi K3 (256K)',
    patterns: [/^k3-256k/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    patterns: [/kimi.*k3/, /kimi-k3/, /^k3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-for-coding',
    label: 'Kimi for Coding',
    // 已升级为 K3 级（1M 上下文）。必须排在 kimi-code 之前——否则被
    // `/kimi.*cod/` 吃掉而降级成 256K（kimi-coding 端点现售版本）。
    patterns: [/for-coding/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'high', 'max'],
  },
  {
    id: 'kimi-code',
    label: 'Kimi Code',
    // K2.7-Code 等编码专用（256K）；更长的名字（for-coding / k3）由上面条目先接住
    patterns: [/kimi.*code/, /kimi.*cod/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out256K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'kimi-general',
    label: 'Kimi (other)',
    patterns: [/kimi/, /moonshot/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    supportsThinking: true,
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
      ConfigFragments.WithTools, C200K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4.7',
    label: 'GLM-4.7',
    patterns: [/glm-?4\.7/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C200K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4.5',
    label: 'GLM-4.5',
    patterns: [/glm-?4\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'glm-4-general',
    label: 'GLM-4 (other)',
    patterns: [/glm-?4/, /glm4/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools,
      ConfigFragments.ContextWindow._128K, Out8K,
    ),
    supportsThinking: false,
  },

  // ════════════════════════════════════════════════════════
  //  xAI Grok
  //  grok-4.5 / 4.6 (2026) → grok-4.3 → grok-build
  //  grok-4.5 走 Responses 协议并声明低/中/高三档；4.3/4.6 为纯开关型
  //  （supportsReasoningEffort: false），本库统一按开关型处理
  // ════════════════════════════════════════════════════════
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    patterns: [/grok-?4\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C500K, Out500K,
    ),
    // 官方声明低/中/高三档且不可关闭（off: null）
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-general',
    label: 'Grok (other)',
    patterns: [/grok/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out32K,
    ),
    // 4.3 / 4.6 / build 系列官方未声明分档（supportsReasoningEffort: false），
    // 强度值上不了 wire → 按纯开关编码，仅决定是否回传推理内容
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },

  // ════════════════════════════════════════════════════════
  //  MiniMax
  //  M3 (1M, 多模态) → M2.7 (205K, 纯文本) → M2.5/M2.1/M2
  //  走 Anthropic 协议。思考声明沿用卡片既有约定：M 系默认始终思考、
  //  无档位可调 → supportsThinking: false（不发参数、不回传推理）。
  // ════════════════════════════════════════════════════════
  {
    id: 'minimax-m3',
    label: 'MiniMax M3',
    patterns: [/minimax.*m3/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: false,
  },
  {
    id: 'minimax-m2.7',
    label: 'MiniMax M2.7',
    patterns: [/minimax.*m2\.7/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C204K, Out131K,
    ),
    supportsThinking: false,
  },
  {
    id: 'minimax-general',
    label: 'MiniMax (other)',
    patterns: [/minimax/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C204K, Out131K,
    ),
    supportsThinking: false,
  },

  // ════════════════════════════════════════════════════════
  //  小米 MiMo
  //  v2.5 (1M, 多模态) → v2 (262K；omni 多模态)
  //  compat 走 deepseek 拼法（requiresReasoningContentOnAssistantMessages）
  // ════════════════════════════════════════════════════════
  {
    id: 'mimo-v2.5',
    label: 'MiMo v2.5',
    patterns: [/mimo.*v2\.5/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out131K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'mimo-v2',
    label: 'MiMo v2',
    patterns: [/mimo/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out131K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },

  // ════════════════════════════════════════════════════════
  //  Ant Ling（蚂蚁）
  //  Ring = 推理系（官方仅 high / xhigh，不可关闭）
  //  Ling = 非推理系
  //  拼法为 ant-ling（仅映射值才发），与本库 supportsReasoningEffort 门控一致
  // ════════════════════════════════════════════════════════
  {
    id: 'ant-ring',
    label: 'Ant Ring',
    patterns: [/^ring-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out65K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['high', 'xhigh'],
  },
  {
    id: 'ant-ling',
    label: 'Ant Ling',
    patterns: [/^ling-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out65K,
    ),
    supportsThinking: false,
  },

  // ════════════════════════════════════════════════════════
  //  Mistral AI
  //  mistral-medium/large (2026) 支持思考；devstral 为编码系（不思考）
  //  magistral 为推理系；ministral / pixtral / open-* / voxtral 不思考
  // ════════════════════════════════════════════════════════
  {
    id: 'mistral-medium',
    label: 'Mistral Medium',
    patterns: [/mistral-medium/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, ConfigFragments.MaxOutput._128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'mistral-small',
    label: 'Mistral Small',
    patterns: [/mistral-small/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out256K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'magistral',
    label: 'Magistral（推理系）',
    patterns: [/magistral/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, ConfigFragments.ContextWindow._128K, Out32K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'devstral',
    label: 'Devstral（编码系）',
    patterns: [/devstral/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out32K,
    ),
    supportsThinking: false,
  },
  {
    id: 'mistral-large',
    label: 'Mistral Large',
    patterns: [/mistral-large/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C262K, Out32K,
    ),
    supportsThinking: false,
  },
  {
    id: 'mistral-general',
    label: 'Mistral (other)',
    patterns: [/mistral/, /mixtral/, /ministral/, /pixtral/, /codestral/, /voxtral/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C131K, Out32K,
    ),
    supportsThinking: false,
  },

  // ════════════════════════════════════════════════════════
  //  开源权重模型（聚合站 / 自建推理常见）
  //  按家族取代表规格；同为网关场景，档位统一按开关型（none/on）编码，
  //  官方未声明分档时不下发强度值，避免被推理后端拒绝
  // ════════════════════════════════════════════════════════
  {
    id: 'gpt-oss',
    label: 'GPT-OSS（开源权重）',
    patterns: [/gpt-oss/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C131K, Out65K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    id: 'gemma',
    label: 'Gemma（开源权重）',
    patterns: [/gemma-?\d/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C131K, Out32K,
    ),
    supportsThinking: false,
  },
  {
    id: 'llama',
    label: 'Llama / Muse（开源权重）',
    patterns: [/llama/, /muse-(spark|glimmer)/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C128K, Out8K,
    ),
    supportsThinking: false,
  },
  {
    id: 'seed-doubao',
    label: 'Seed / Doubao（字节）',
    // 聚合站会带命名空间前缀（bytedance/seed-1.8），故允许前缀存在
    patterns: [/(^|\/)seed-?\d/, /doubao/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out32K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'hunyuan',
    label: 'Hunyuan（腾讯）',
    patterns: [/(^|\/)hy\d/, /hunyuan/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out64K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'low', 'high'],
  },
  {
    id: 'stepfun',
    label: 'Step（阶跃星辰）',
    patterns: [/^step-?\d/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out32K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'nemotron',
    label: 'Nemotron（NVIDIA）',
    patterns: [/nemotron/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'nova-amazon',
    label: 'Nova（Amazon）',
    patterns: [/nova-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C300K, Out8K,
    ),
    supportsThinking: false,
  },
  {
    id: 'longcat',
    label: 'LongCat（美团）',
    patterns: [/longcat/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'solar-upstage',
    label: 'Solar（Upstage）',
    patterns: [/solar-/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C131K, Out128K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'inkling',
    label: 'Inkling（Thinking Machines）',
    patterns: [/inkling/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.Multimodal, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C1M, Out32K,
    ),
    // 官方档位含 minimal / xhigh，此处按本库惯例取主档
    supportsThinking: true,
    thinkingEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'laguna',
    label: 'Laguna（Poolside）',
    patterns: [/laguna/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out32K,
    ),
    supportsThinking: true,
    thinkingEfforts: ['none', 'on'],
  },
  {
    id: 'kat-coder',
    label: 'KAT Coder（Kwaipilot）',
    patterns: [/kat-coder/, /kwaipilot/],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C256K, Out80K,
    ),
    supportsThinking: false,
  },
  {
    id: 'general-open-weight',
    label: '其它开源权重（兜底）',
    patterns: [
      /command/, /granite/, /jamba/, /mercury/, /trinity/, /virtuoso/,
      /lfm/, /euryale/, /unslopnemo/, /sakana/, /fugu/, /namazu/,
      /kat-coder|interfaze|arcee|aion|reka|nex-|relace|upstage|meituan/,
    ],
    modeType: 'text',
    config: mergeConfig(
      ConfigFragments.TextOnly, ConfigFragments.TextOutput,
      ConfigFragments.WithTools, C128K, Out16K,
    ),
    supportsThinking: false,
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
 *
 * 两级匹配，逐 preset 顺序进行（更具体的模式排在前面，首个命中即返回）：
 * 1. 完整名（含命名空间前缀，如 `openai/gpt-5.4`）
 * 2. 去除命名空间后的裸名（`gpt-5.4`）
 *
 * 裸名兜底是必要的：聚合站/网关会返回 `vendor/model` 形式，而带 `^` 锚定的
 * 模式（如 `/^gpt-5\.5/`）在前缀存在时永远匹配不上。逐 preset 先全名后裸名，
 * 保证不破坏既有的"具体优先"顺序。
 *
 * @param modelName 模型名（如 'gpt-4o'、'openai/gpt-5.4'）
 * @param ownedBy 远程 API 返回的 owned_by 字段（可选，当前未使用，预留）
 * @returns 匹配的预设，无匹配返回 null
 */
export function findModelPreset(
  modelName: string,
  ownedBy?: string,
): ModelPreset | null {
  const lower = modelName.toLowerCase();
  const bare = lower.split('/').pop() || lower;
  for (const preset of MODEL_PRESETS) {
    if (preset.patterns.some((p) => p.test(lower))) {
      return preset;
    }
    if (bare !== lower && preset.patterns.some((p) => p.test(bare))) {
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
    supportsThinking: p.supportsThinking,
    thinkingEfforts: p.thinkingEfforts ?? [],
  }));
}
