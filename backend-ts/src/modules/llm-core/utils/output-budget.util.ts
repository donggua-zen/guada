/**
 * 主请求输出预算 preflight（对齐 zcode model-token-limits.ts）
 *
 * provider 的 contextWindow 是输入 + 输出共享窗口。请求里的 max_tokens 是**预留输出**，
 * 上游会把它计入总长（实测：输入 669,530 + max_tokens 384,000 = 1,053,530 > 1,048,576）。
 * 因此不能在压缩决策里长期扣掉完整 maxOutputTokens（浪费输入预算），但发请求前必须把
 * max_tokens 收缩到"总窗口 − 估算输入 − 安全余量"，否则会直接 400。
 *
 * 注意：这里只收缩请求参数，不改变模型配置本身；输入还有空间时仍可请求大输出。
 */

/** 安全余量：覆盖 transient reminders、估算漂移与协议开销 */
export const REQUEST_OUTPUT_SAFETY_TOKENS = 2_000;

/**
 * 计算本次主请求实际可用的 max_tokens。
 *
 * - 未配置 maxOutputTokens → 返回 undefined（保持 provider 默认，不做额外限制）
 * - 剩余窗口 ≤ 0 → 返回配置值（与 zcode 一致：交给 overflow 压缩/错误恢复，不发 0）
 * - 否则返回 `min(配置值, 总窗口 − 估算输入 − 安全余量)`
 */
export function resolvePreflightMaxTokens(input: {
  configuredMaxOutputTokens?: number;
  totalContextWindow: number;
  estimatedInputTokens: number;
  safetyTokens?: number;
}): number | undefined {
  if (input.configuredMaxOutputTokens === undefined) return undefined;
  const configured = Math.floor(input.configuredMaxOutputTokens);
  if (!Number.isFinite(configured) || configured <= 0) return undefined;

  const total = Math.floor(input.totalContextWindow);
  const estimated = Math.floor(input.estimatedInputTokens);
  if (!Number.isFinite(total) || !Number.isFinite(estimated)) {
    return configured;
  }

  const safety = Math.max(
    0,
    Math.floor(input.safetyTokens ?? REQUEST_OUTPUT_SAFETY_TOKENS),
  );
  const available = total - estimated - safety;
  if (available <= 0) return configured; // 交给既有超窗错误恢复/压缩路径
  return Math.min(configured, available);
}
