/**
 * 上下文窗口预算（对齐 zcode compact/policy.ts）
 *
 * provider 的 contextWindow 是 **输入 + 输出共享窗口**。自动压缩只需要让出输入侧，
 * 但把模型声明的最大输出（可能高达 384K）全部预留会严重浪费输入预算、导致过早压缩。
 * zcode 的做法：
 * - 压缩决策只扣 `min(maxOutputTokens, 21_000)`（PREFLIGHT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS）
 * - 真正发请求时，再把 max_tokens 收缩到"总窗口 − 估算输入 − 安全余量"（见 output-budget.util.ts）
 *
 * 本文件只负责前者：返回总窗口、压缩有效窗口与输出预留。
 */

/** 自动压缩决策时，输出预留的硬上限（zcode 同款 21K） */
export const AUTO_COMPACT_OUTPUT_RESERVE_CAP_TOKENS = 21_000;
/** 模型未声明 maxOutputTokens 时的输出预留（zcode 默认 32K，再被 21K 封顶） */
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 32_000;

export interface ContextWindowBudget {
  /** 输入 + 输出共享总窗口（min(模型窗口, 会话 maxTokensLimit)） */
  totalContextWindow: number;
  /** 压缩决策/环形使用的有效输入窗口（总窗口 − 封顶输出预留） */
  effectiveContextWindow: number;
  /** 实际扣掉的输出预留（0..21K） */
  outputReserveTokens: number;
}

/**
 * 计算窗口预算。
 *
 * @param contextWindow   模型配置的 contextWindow（缺省 128000 与旧行为一致）
 * @param maxOutputTokens 模型配置的最大输出；缺省按 zcode 的 32K 处理，再被 21K 封顶
 * @param maxTokensLimit  会话级上限（与模型窗口取 min）
 */
export function resolveContextWindowBudget(input: {
  contextWindow?: number;
  maxOutputTokens?: number;
  maxTokensLimit?: number | null;
}): ContextWindowBudget {
  const rawWindow =
    typeof input.contextWindow === 'number' &&
    Number.isFinite(input.contextWindow) &&
    input.contextWindow > 0
      ? Math.floor(input.contextWindow)
      : 128_000;
  const totalContextWindow =
    input.maxTokensLimit && input.maxTokensLimit > 0
      ? Math.min(rawWindow, Math.floor(input.maxTokensLimit))
      : rawWindow;

  const hasDeclaredMaxOutput =
    typeof input.maxOutputTokens === 'number' &&
    Number.isFinite(input.maxOutputTokens) &&
    input.maxOutputTokens > 0;
  // 未声明 maxOutputTokens 时按 zcode 的 32K 默认，再被 21K 封顶；小窗口额外限制为 1/4，
  // 避免 8K 窗口被默认预留直接扣成 0（老模型/未配置输出的场景）。
  const rawMaxOutput = hasDeclaredMaxOutput
    ? Math.floor(input.maxOutputTokens as number)
    : Math.min(
        DEFAULT_OUTPUT_RESERVE_TOKENS,
        Math.max(1, Math.floor(totalContextWindow / 4)),
      );
  const outputReserveTokens = Math.min(
    rawMaxOutput,
    AUTO_COMPACT_OUTPUT_RESERVE_CAP_TOKENS,
    totalContextWindow,
  );

  return {
    totalContextWindow,
    effectiveContextWindow: Math.max(
      0,
      totalContextWindow - outputReserveTokens,
    ),
    outputReserveTokens,
  };
}
