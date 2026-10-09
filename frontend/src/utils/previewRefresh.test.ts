import { describe, it, expect } from 'vitest'
import { decidePreviewRefresh, type PreviewRefreshInput } from './previewRefresh'

const base: PreviewRefreshInput = {
  hasLoaded: true,
  newVersion: 1,
  oldVersion: 0,
  saveStatus: 'saved',
  isActive: true,
}

describe('decidePreviewRefresh', () => {
  it('首次变更（0 → 1）必须刷新：回归用例，此前 oldVer === 0 被当作噪声丢弃', () => {
    expect(decidePreviewRefresh(base)).toBe('refresh')
  })

  it('面板尚未加载内容：忽略（激活时会读到最新内容）', () => {
    expect(decidePreviewRefresh({ ...base, hasLoaded: false })).toBe('ignore')
    expect(decidePreviewRefresh({ ...base, hasLoaded: false, newVersion: 5, oldVersion: 3 })).toBe('ignore')
  })

  it('版本号未增长（含会话重置回退）：忽略', () => {
    expect(decidePreviewRefresh({ ...base, newVersion: 2, oldVersion: 2 })).toBe('ignore')
    expect(decidePreviewRefresh({ ...base, newVersion: 0, oldVersion: 3 })).toBe('ignore')
  })

  it('有未保存编辑：只标冲突，不覆盖编辑内容', () => {
    expect(decidePreviewRefresh({ ...base, saveStatus: 'unsaved' })).toBe('conflict')
  })

  it('保存中：仍按刷新处理（保存写盘触发的回环事件）', () => {
    expect(decidePreviewRefresh({ ...base, saveStatus: 'saving' })).toBe('refresh')
  })

  it('非激活标签：延迟到重新激活时刷新', () => {
    expect(decidePreviewRefresh({ ...base, isActive: false })).toBe('stale')
  })

  it('未保存编辑优先于激活状态判断：非激活标签同样只标冲突', () => {
    expect(decidePreviewRefresh({ ...base, isActive: false, saveStatus: 'unsaved' })).toBe('conflict')
  })
})
