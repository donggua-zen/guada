/**
 * 轻量语义化版本比较。
 *
 * 支持：
 * - `v` 前缀（v1.2.0）
 * - 任意段数的数字版本（1.2.0 / 1.2 / 2024.10）
 * - 预发布标识（1.0.0-beta.2；无预发布 > 有预发布）
 * - build metadata（+sha）忽略
 *
 * 非数字段回退到带数字感知的 localeCompare，保证 `1.0.0-alpha` / `1.0.0-beta`
 * 这类版本也有稳定顺序。
 */
function normalize(version: string): { core: string; prerelease: string | null } {
  const withoutBuild = version.trim().replace(/^v/i, '').split('+')[0]
  const dash = withoutBuild.indexOf('-')
  if (dash === -1) return { core: withoutBuild, prerelease: null }
  return {
    core: withoutBuild.slice(0, dash),
    prerelease: withoutBuild.slice(dash + 1) || null,
  }
}

/** 返回 1（a > b）/ 0（相等）/ -1（a < b） */
export function compareVersions(a: string, b: string): number {
  const pa = normalize(a)
  const pb = normalize(b)
  const segmentsA = pa.core.split('.')
  const segmentsB = pb.core.split('.')
  const length = Math.max(segmentsA.length, segmentsB.length)

  for (let i = 0; i < length; i += 1) {
    const segmentA = segmentsA[i] ?? '0'
    const segmentB = segmentsB[i] ?? '0'
    const numberA = Number(segmentA)
    const numberB = Number(segmentB)

    if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
      if (numberA !== numberB) return numberA > numberB ? 1 : -1
      continue
    }

    const compared = segmentA.localeCompare(segmentB, undefined, { numeric: true })
    if (compared !== 0) return compared > 0 ? 1 : -1
  }

  // 无预发布标识的正式版高于同版本号的预发布版
  if (!pa.prerelease && pb.prerelease) return 1
  if (pa.prerelease && !pb.prerelease) return -1
  if (pa.prerelease && pb.prerelease) {
    const compared = pa.prerelease.localeCompare(pb.prerelease, undefined, { numeric: true })
    if (compared !== 0) return compared > 0 ? 1 : -1
  }

  return 0
}

/** candidate 是否比 current 新 */
export function isVersionNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
