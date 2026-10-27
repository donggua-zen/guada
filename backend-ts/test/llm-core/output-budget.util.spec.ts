import {
  REQUEST_OUTPUT_SAFETY_TOKENS,
  resolvePreflightMaxTokens,
} from '../../src/modules/llm-core/utils/output-budget.util';

describe('resolvePreflightMaxTokens（主请求输出预算收缩）', () => {
  it('输入 669,530 / 总窗口 1M / 配置 384K：收缩到 328,470（含 2K 安全余量）', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 669_530,
      }),
    ).toBe(1_000_000 - 669_530 - REQUEST_OUTPUT_SAFETY_TOKENS);
  });

  it('输入 900K：收缩到 98K', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 900_000,
      }),
    ).toBe(98_000);
  });

  it('输入 979K：收缩到 19K', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 979_000,
      }),
    ).toBe(19_000);
  });

  it('剩余窗口 ≤ 0：保留配置值，交给超窗错误/压缩恢复（不发 0）', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 999_500,
      }),
    ).toBe(384_000);
  });

  it('未配置 maxOutputTokens / 非法值：不额外限制', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: undefined,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 900_000,
      }),
    ).toBeUndefined();
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 0,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 900_000,
      }),
    ).toBeUndefined();
  });

  it('自定义安全余量', () => {
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 600_000,
        safetyTokens: 10_000,
      }),
    ).toBe(384_000);
    expect(
      resolvePreflightMaxTokens({
        configuredMaxOutputTokens: 384_000,
        totalContextWindow: 1_000_000,
        estimatedInputTokens: 620_000,
        safetyTokens: 10_000,
      }),
    ).toBe(370_000);
  });
});
