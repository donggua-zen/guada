import { SIDEBAR_SESSION_PAGE_TIERS } from '@/constants'

/**
 * 解析侧栏每组首屏展示条数（按可见分组/项目数收敛）。
 *
 * 分组越多，每组展示越少，避免「N 个项目 × 10 条」把侧栏撑爆。档位定义见
 * `SIDEBAR_SESSION_PAGE_TIERS`：≤3 → 10，4~6 → 7，≥7 → 5。
 *
 * 非法输入（NaN / 负数 / 0 / 小数）一律按「最少分组」兜底为最大值档位，
 * 宁可多显示也不要因为上游算错而把侧栏显示成 0 条。
 */
export const resolveSidebarPageSize = (groupCount: number): number => {
  const count = Math.floor(groupCount)
  const normalized = Number.isFinite(count) && count > 0 ? count : 1
  const tier = SIDEBAR_SESSION_PAGE_TIERS.find((t) => normalized <= t.maxGroups)
  return tier
    ? tier.size
    : SIDEBAR_SESSION_PAGE_TIERS[SIDEBAR_SESSION_PAGE_TIERS.length - 1].size
}
