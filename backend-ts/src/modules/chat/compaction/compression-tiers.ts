/**
 * 压缩策略档位（内置预设，替代自由比例配置）
 *
 * 档位一次性决定：是否压缩（enabled）、触发阈值（triggerRatio）、
 * 保留尾预算（retainRatio）、摘要模式（summaryMode，含是否跑记忆同步影子轮）。
 * 会话侧（jsonl-session-context.buildCompactionConfig）把档位折算为
 * CompactionConfig{enabled, compressionTriggerRatio, compressionRetainRatio, summaryMode}，
 * 引擎/协调器只消费折算结果，不感知档位概念——调整档位数值只改本表。
 *
 * 存量兼容（读时映射，不写库）：旧配置无 compressionTier 时，
 * summaryMode==='disabled' → OFF；其余（fast/memory_sync/缺省）→ 默认档。
 */
import { SummaryMode } from './compression-engine';

export enum CompressionTier {
  /** 关闭压缩：不裁剪、不摘要（enabled=false 门控；手动 force 压缩仍可用） */
  OFF = 'off',
  /** 保守：晚触发、多保留 */
  CONSERVATIVE = 'conservative',
  /** 激进：晚触发、少保留（压得深） */
  AGGRESSIVE = 'aggressive',
}

/** 缺省档位（旧配置映射与非法值回退目标） */
export const DEFAULT_COMPRESSION_TIER = CompressionTier.CONSERVATIVE;

/** 档位预设 */
export interface TierPreset {
  /** 是否启用压缩（OFF=false：自动/溢出路径旁路） */
  enabled: boolean;
  /** 触发阈值（占用/窗口 ≥ 此比例触发） */
  triggerRatio: number;
  /** 压缩保留尾预算 */
  retainRatio: number;
  /** 摘要模式（memory_sync 含压缩前记忆同步影子轮） */
  summaryMode: SummaryMode;
}

export const COMPRESSION_TIER_PRESETS: Record<CompressionTier, TierPreset> = {
  [CompressionTier.OFF]: {
    enabled: false,
    triggerRatio: 0.9,
    retainRatio: 0.4,
    summaryMode: SummaryMode.DISABLED,
  },
  [CompressionTier.CONSERVATIVE]: {
    enabled: true,
    triggerRatio: 0.9,
    retainRatio: 0.4,
    summaryMode: SummaryMode.MEMORY_SYNC,
  },
  [CompressionTier.AGGRESSIVE]: {
    enabled: true,
    triggerRatio: 0.9,
    retainRatio: 0.2,
    summaryMode: SummaryMode.MEMORY_SYNC,
  },
};

export function isCompressionTier(value: unknown): value is CompressionTier {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(COMPRESSION_TIER_PRESETS, value)
  );
}

/**
 * 解析角色 settings.memory 的压缩档位：
 * ① compressionTier 合法 → 用之；② 旧 summaryMode==='disabled' → OFF；③ 否则默认档。
 */
export function resolveCompressionTier(memory: any): CompressionTier {
  if (isCompressionTier(memory?.compressionTier)) {
    return memory.compressionTier;
  }
  if (memory?.summaryMode === 'disabled') {
    return CompressionTier.OFF;
  }
  return DEFAULT_COMPRESSION_TIER;
}
