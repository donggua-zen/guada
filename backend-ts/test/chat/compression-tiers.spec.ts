/**
 * 压缩策略档位注册表单元测试
 *
 * 覆盖：
 * - 档位预设折算值（enabled/trigger/retain/summaryMode）
 * - resolveCompressionTier：合法档位直用 / 旧 summaryMode=disabled 映射 OFF / 缺省与非法值回退默认
 */
import {
  CompressionTier,
  DEFAULT_COMPRESSION_TIER,
  COMPRESSION_TIER_PRESETS,
  isCompressionTier,
  resolveCompressionTier,
} from '../../src/modules/chat/compaction/compression-tiers';
import { SummaryMode } from '../../src/modules/chat/compaction/compression-engine';

/// <reference types="jest" />

describe('COMPRESSION_TIER_PRESETS', () => {
  it('关闭档：enabled=false，不触发压缩', () => {
    expect(COMPRESSION_TIER_PRESETS[CompressionTier.OFF]).toEqual({
      enabled: false,
      triggerRatio: 0.9,
      retainRatio: 0.4,
      summaryMode: SummaryMode.DISABLED,
    });
  });

  it('保守档：触发 0.9 / 保留 0.4 / FAST（当前不跑压缩前影子轮次）', () => {
    expect(COMPRESSION_TIER_PRESETS[CompressionTier.CONSERVATIVE]).toEqual({
      enabled: true,
      triggerRatio: 0.9,
      retainRatio: 0.4,
      summaryMode: SummaryMode.FAST,
    });
  });

  it('激进档：触发 0.9 / 保留 0.2 / FAST（当前不跑压缩前影子轮次）', () => {
    expect(COMPRESSION_TIER_PRESETS[CompressionTier.AGGRESSIVE]).toEqual({
      enabled: true,
      triggerRatio: 0.9,
      retainRatio: 0.2,
      summaryMode: SummaryMode.FAST,
    });
  });

  it('两档预设都不再触发压缩前影子轮次（禁用意图契约）', () => {
    // 重新启用影子轮次 = 把预设改回 MEMORY_SYNC；这条断言失败说明有人改了开关点，
    // 需同步更新 docs/memory.md 的"当前禁用"说明与用户可见文案。
    expect(COMPRESSION_TIER_PRESETS[CompressionTier.CONSERVATIVE].summaryMode).not.toBe(
      SummaryMode.MEMORY_SYNC,
    );
    expect(COMPRESSION_TIER_PRESETS[CompressionTier.AGGRESSIVE].summaryMode).not.toBe(
      SummaryMode.MEMORY_SYNC,
    );
  });

  it('默认档位为保守', () => {
    expect(DEFAULT_COMPRESSION_TIER).toBe(CompressionTier.CONSERVATIVE);
  });
});

describe('isCompressionTier', () => {
  it('合法档位字符串返回 true', () => {
    expect(isCompressionTier('off')).toBe(true);
    expect(isCompressionTier('conservative')).toBe(true);
    expect(isCompressionTier('aggressive')).toBe(true);
  });

  it('非法值返回 false（含非字符串与原型链键名）', () => {
    expect(isCompressionTier('balanced')).toBe(false);
    expect(isCompressionTier(undefined)).toBe(false);
    expect(isCompressionTier(42)).toBe(false);
    expect(isCompressionTier('constructor')).toBe(false);
    expect(isCompressionTier('toString')).toBe(false);
  });
});

describe('resolveCompressionTier', () => {
  it('memory.compressionTier 合法 → 直接使用', () => {
    expect(resolveCompressionTier({ compressionTier: 'aggressive' })).toBe(
      CompressionTier.AGGRESSIVE,
    );
    expect(resolveCompressionTier({ compressionTier: 'off' })).toBe(
      CompressionTier.OFF,
    );
  });

  it('旧配置 summaryMode=disabled（无 compressionTier）→ OFF', () => {
    expect(
      resolveCompressionTier({ summaryMode: 'disabled', compressionTriggerRatio: 0.7 }),
    ).toBe(CompressionTier.OFF);
  });

  it('旧配置 summaryMode=fast/memory_sync（无 compressionTier）→ 默认档', () => {
    expect(resolveCompressionTier({ summaryMode: 'fast' })).toBe(
      DEFAULT_COMPRESSION_TIER,
    );
    expect(resolveCompressionTier({ summaryMode: 'memory_sync' })).toBe(
      DEFAULT_COMPRESSION_TIER,
    );
  });

  it('无配置 / 非法档位值 → 默认档', () => {
    expect(resolveCompressionTier(undefined)).toBe(DEFAULT_COMPRESSION_TIER);
    expect(resolveCompressionTier({})).toBe(DEFAULT_COMPRESSION_TIER);
    expect(resolveCompressionTier({ compressionTier: 'bogus' })).toBe(
      DEFAULT_COMPRESSION_TIER,
    );
  });

  it('合法 compressionTier 优先于旧 summaryMode（新字段权威）', () => {
    expect(
      resolveCompressionTier({ compressionTier: 'off', summaryMode: 'memory_sync' }),
    ).toBe(CompressionTier.OFF);
    expect(
      resolveCompressionTier({ compressionTier: 'conservative', summaryMode: 'disabled' }),
    ).toBe(CompressionTier.CONSERVATIVE);
  });
});
