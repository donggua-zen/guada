import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_ICON,
  GROUP_ICON_OPTIONS,
  isGroupIconKey,
  resolveGroupIcon,
} from './groupIcon'

describe('groupIcon', () => {
  it('null / 未提供 / 未知 key 都回退默认文件夹', () => {
    expect(resolveGroupIcon(null)).toBe(DEFAULT_GROUP_ICON)
    expect(resolveGroupIcon(undefined)).toBe(DEFAULT_GROUP_ICON)
    expect(resolveGroupIcon('')).toBe(DEFAULT_GROUP_ICON)
    expect(resolveGroupIcon('not-a-real-icon')).toBe(DEFAULT_GROUP_ICON)
  })

  it('已知 key 解析到对应组件，且不复用默认组件', () => {
    const code = resolveGroupIcon('code')
    expect(code).not.toBe(DEFAULT_GROUP_ICON)
    expect(resolveGroupIcon('code')).toBe(code)
  })

  it('选项表首项是默认图标，其余 key 唯一且合法', () => {
    expect(GROUP_ICON_OPTIONS[0]).toMatchObject({ key: null })
    const keys = GROUP_ICON_OPTIONS.slice(1).map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(isGroupIconKey(String(key))).toBe(true)
    }
  })

  it('本轮补充的图标 key 都能解析到独立组件', () => {
    for (const key of [
      'board',
      'desktop',
      'trending',
      'comment',
      'wand',
      'puzzle',
      'print',
      'play',
    ]) {
      expect(isGroupIconKey(key)).toBe(true)
      expect(resolveGroupIcon(key)).not.toBe(DEFAULT_GROUP_ICON)
    }
  })
})
