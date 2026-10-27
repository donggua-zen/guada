import {
  AUTO_COMPACT_OUTPUT_RESERVE_CAP_TOKENS,
  resolveContextWindowBudget,
} from '../../src/modules/chat/compaction/window-budget';

describe('resolveContextWindowBudget（zcode 式窗口预算）', () => {
  it('1M 窗口 + 384K 最大输出：只扣 21K 封顶预留，不扣完整最大输出', () => {
    expect(
      resolveContextWindowBudget({
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
      }),
    ).toEqual({
      totalContextWindow: 1_000_000,
      effectiveContextWindow: 979_000,
      outputReserveTokens: AUTO_COMPACT_OUTPUT_RESERVE_CAP_TOKENS,
    });
  });

  it('128K 窗口 + 64K 最大输出：同样只扣 21K', () => {
    expect(
      resolveContextWindowBudget({
        contextWindow: 128_000,
        maxOutputTokens: 64_000,
      }),
    ).toMatchObject({
      totalContextWindow: 128_000,
      effectiveContextWindow: 107_000,
      outputReserveTokens: 21_000,
    });
  });

  it('最大输出小于 21K 时按实际值预留', () => {
    expect(
      resolveContextWindowBudget({
        contextWindow: 128_000,
        maxOutputTokens: 8_000,
      }),
    ).toMatchObject({
      effectiveContextWindow: 120_000,
      outputReserveTokens: 8_000,
    });
  });

  it('会话 maxTokensLimit 参与总窗口计算', () => {
    expect(
      resolveContextWindowBudget({
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        maxTokensLimit: 100_000,
      }),
    ).toMatchObject({
      totalContextWindow: 100_000,
      effectiveContextWindow: 79_000,
      outputReserveTokens: 21_000,
    });
  });

  it('未声明 maxOutputTokens：大窗口按 32K→21K 封顶，小窗口按 1/4 预留', () => {
    expect(
      resolveContextWindowBudget({ contextWindow: 1_000_000 }),
    ).toMatchObject({
      effectiveContextWindow: 979_000,
      outputReserveTokens: 21_000,
    });
    expect(
      resolveContextWindowBudget({ contextWindow: 8_000 }),
    ).toMatchObject({
      effectiveContextWindow: 6_000,
      outputReserveTokens: 2_000,
    });
  });

  it('非法/缺省窗口回退 128K；预留不超过总窗口', () => {
    expect(
      resolveContextWindowBudget({ contextWindow: 0 }),
    ).toMatchObject({
      totalContextWindow: 128_000,
      effectiveContextWindow: 107_000,
    });
    expect(
      resolveContextWindowBudget({
        contextWindow: 8_000,
        maxOutputTokens: 16_000,
      }),
    ).toMatchObject({
      effectiveContextWindow: 0,
      outputReserveTokens: 8_000,
    });
  });
});
