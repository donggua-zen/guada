import { describe, it, expect } from 'vitest'
import type { Skill } from '@/types/skills'
import {
  applyMarketStatus,
  dedupeById,
  findInstalledSkill,
  mergeUniqueById,
  resolveMarketStatus,
} from './marketStatus'

function makeSkill(partial: {
  name: string
  version?: string
  originSource?: string
  originItemId?: string
}): Skill {
  return {
    id: partial.name.toLowerCase(),
    manifest: {
      name: partial.name,
      description: 'test skill',
      ...(partial.version ? { version: partial.version } : {}),
    },
    source: 'global',
    enabled: true,
    ...(partial.originSource && partial.originItemId
      ? {
          origin: {
            source: partial.originSource,
            itemId: partial.originItemId,
            ...(partial.version ? { version: partial.version } : {}),
          },
        }
      : {}),
  }
}

describe('findInstalledSkill', () => {
  it('优先按 origin 精确匹配，即使本地 manifest.name 与条目 id 不同', () => {
    const local = makeSkill({
      name: 'pdf-image-text-extractor',
      originSource: 'skillhub',
      originItemId: 'pdf-image-text-extractor',
    })
    // 模拟 SKILL.md 里是中文显示名、但 origin 记录的是 slug
    local.manifest.name = 'pdf-ocr-cn'

    expect(findInstalledSkill([local], 'skillhub', 'pdf-image-text-extractor')).toBe(local)
  })

  it('origin.source 不匹配时不认领', () => {
    const local = makeSkill({
      name: 'same-skill',
      originSource: 'official',
      originItemId: 'same-skill',
    })

    // origin 不匹配，但名字相同 → 回退到名称匹配
    expect(findInstalledSkill([local], 'skillhub', 'same-skill')).toBe(local)
  })

  it('没有 origin 的历史安装按 manifest.name 匹配（大小写不敏感）', () => {
    const local = makeSkill({ name: 'Legacy-Skill' })
    expect(findInstalledSkill([local], 'skillhub', 'legacy-skill')).toBe(local)
  })

  it('找不到时返回 undefined', () => {
    expect(findInstalledSkill([makeSkill({ name: 'other' })], 'skillhub', 'missing')).toBeUndefined()
  })
})

describe('resolveMarketStatus', () => {
  it('未安装', () => {
    expect(resolveMarketStatus(undefined, '1.0.0')).toEqual({ localStatus: 'not_installed' })
  })

  it('市场版本更高 → updatable', () => {
    const local = makeSkill({ name: 'a', version: '1.0.0' })
    expect(resolveMarketStatus(local, '1.1.0')).toEqual({
      localStatus: 'updatable',
      localVersion: '1.0.0',
    })
  })

  it('版本相同或本地更高 → installed', () => {
    const local = makeSkill({ name: 'a', version: '1.1.0' })
    expect(resolveMarketStatus(local, '1.0.0')).toEqual({
      localStatus: 'installed',
      localVersion: '1.1.0',
    })
    expect(resolveMarketStatus(local, '1.1.0').localStatus).toBe('installed')
  })

  it('任一侧缺版本时不误判为可更新', () => {
    const local = makeSkill({ name: 'a' })
    expect(resolveMarketStatus(local, '1.0.0')).toEqual({ localStatus: 'installed', localVersion: undefined })
    expect(resolveMarketStatus(makeSkill({ name: 'b', version: '1.0.0' }), undefined).localStatus).toBe('installed')
  })
})

describe('applyMarketStatus', () => {
  it('批量套状态且不修改入参', () => {
    const local = makeSkill({
      name: 'installed-one',
      version: '1.0.0',
      originSource: 'skillhub',
      originItemId: 'installed-one',
    })
    const items = [
      { id: 'installed-one', version: '1.0.0' },
      { id: 'new-one', version: '2.0.0' },
    ]

    const result = applyMarketStatus(items, [local], 'skillhub')

    expect(result[0]).toMatchObject({ localStatus: 'installed', localVersion: '1.0.0' })
    expect(result[1]).toMatchObject({ localStatus: 'not_installed' })
    expect(items[0]).not.toHaveProperty('localStatus')
  })
})

describe('dedupeById', () => {
  it('按 id 去重并保留首次出现的顺序', () => {
    const items = [
      { id: 'wps', name: 'WPS' },
      { id: 'other', name: 'Other' },
      { id: 'wps', name: 'WPS duplicate' },
    ]

    expect(dedupeById(items)).toEqual([
      { id: 'wps', name: 'WPS' },
      { id: 'other', name: 'Other' },
    ])
  })

  it('空数组保持为空', () => {
    expect(dedupeById([])).toEqual([])
  })
})

describe('mergeUniqueById', () => {
  it('追加新条目并跳过已有 id', () => {
    const existing = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]
    const incoming = [
      { id: 'b', value: 99 },
      { id: 'c', value: 3 },
      { id: 'c', value: 4 },
    ]

    expect(mergeUniqueById(existing, incoming)).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'c', value: 3 },
    ])
    expect(existing).toHaveLength(2)
  })

  it('没有新条目时保持原列表', () => {
    const existing = [{ id: 'a' }]
    expect(mergeUniqueById(existing, [{ id: 'a' }])).toEqual(existing)
  })
})
