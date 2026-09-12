import { ThinkingFormat } from '../llm-core/thinking/thinking-vocabulary';

/**
 * apiUrl → thinkingFormat 推荐（对齐 DSH detectCompat 的 URL 识别面）。
 *
 * 仅作**前端提示**用——用户在供应商/模型编辑界面输入 API 地址后给出建议值，
 * 由用户确认写入，绝不自动生效（与 DSH 的运行时隐式探测刻意不同）。
 */

const URL_FORMAT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  format: ThinkingFormat;
  vendor: string;
}> = [
  { pattern: /openrouter\.ai/i, format: 'openrouter', vendor: 'OpenRouter' },
  { pattern: /api\.deepseek\.com/i, format: 'deepseek', vendor: 'DeepSeek' },
  { pattern: /api\.z\.ai/i, format: 'zai', vendor: 'Z.ai' },
  { pattern: /bigmodel\.cn/i, format: 'zai', vendor: '智谱' },
  { pattern: /api\.moonshot\./i, format: 'deepseek', vendor: 'Moonshot（K2 系实测 thinking.type）' },
  { pattern: /api\.together\.(?:ai|xyz)/i, format: 'together', vendor: 'Together AI' },
  { pattern: /api\.ant-ling\.com/i, format: 'ant-ling', vendor: 'Ant Ling' },
];

export interface ThinkingFormatSuggestion {
  format: ThinkingFormat;
  vendor: string;
}

/** 按 apiUrl 推荐思考格式；无匹配返回 undefined */
export function suggestThinkingFormat(
  apiUrl: string | undefined | null,
): ThinkingFormatSuggestion | undefined {
  if (!apiUrl) return undefined;
  for (const { pattern, format, vendor } of URL_FORMAT_PATTERNS) {
    if (pattern.test(apiUrl)) return { format, vendor };
  }
  return undefined;
}
