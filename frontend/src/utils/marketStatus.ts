import type { Skill } from '@/types/skills'
import { isVersionNewer } from '@/utils/version'

/**
 * 市场条目的本地安装状态。
 *
 * 匹配顺序：
 * 1. origin.source + origin.itemId —— 安装时写入的稳定身份，跨市场/中文显示名都可靠；
 * 2. manifest.name —— 兼容没有 origin 的历史安装（官网市场旧版本装的）。
 *
 * 只按名字匹配会在 SkillHub 的 slug 与 SKILL.md displayName 不一致时误判为未安装，
 * 因此 origin 优先。
 */

export type MarketLocalStatus = 'not_installed' | 'installed' | 'updatable'

export interface MarketStatus {
  localStatus: MarketLocalStatus
  localVersion?: string
}

/** 在已安装技能里找市场条目对应的本地技能 */
export function findInstalledSkill(
  localSkills: Skill[],
  source: string,
  itemId: string,
): Skill | undefined {
  const normalizedId = itemId.toLowerCase()

  return (
    localSkills.find(
      (skill) =>
        skill.origin?.source === source && skill.origin.itemId === itemId,
    ) ??
    localSkills.find(
      (skill) => skill.manifest.name?.toLowerCase() === normalizedId,
    )
  )
}

/**
 * 按 id 去重（保留首次出现）。
 *
 * 上游市场偶尔会重复返回同一个条目（SkillHub 实测 50 条里只有 37 个唯一 slug）；
 * 不去重会让 v-for 出现重复 key，表现为同名行重复出现。
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []

  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }

  return out
}

/**
 * 追加去重：保留已有顺序，只追加本次没出现过的 id。
 *
 * 滚动加载下一页时用；上游跨页仍可能重复返回同一 slug，不能直接 concat。
 */
export function mergeUniqueById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((item) => item.id))
  const out = existing.slice()

  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }

  return out
}

/** 比较本地版本与市场版本，得到安装状态 */
export function resolveMarketStatus(
  localSkill: Skill | undefined,
  marketVersion: string | undefined,
): MarketStatus {
  if (!localSkill) return { localStatus: 'not_installed' }

  const localVersion = localSkill.manifest.version
  if (marketVersion && localVersion && isVersionNewer(marketVersion, localVersion)) {
    return { localStatus: 'updatable', localVersion }
  }
  return { localStatus: 'installed', localVersion }
}

/** 给一整批市场条目套上本地状态（返回新数组，不修改入参） */
export function applyMarketStatus<T extends { id: string; version?: string }>(
  items: T[],
  localSkills: Skill[],
  source: string,
): Array<T & MarketStatus> {
  return items.map((item) => ({
    ...item,
    ...resolveMarketStatus(
      findInstalledSkill(localSkills, source, item.id),
      item.version,
    ),
  }))
}
