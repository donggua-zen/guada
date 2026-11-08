import { beforeEach, describe, expect, it } from 'vitest'
import { consumeMarkdownScrollRestore, recordMarkdownScroll } from './useMarkdownScrollState'

beforeEach(() => {
  // 单例状态：每条用例先清残留（记录一个必不匹配的 path 等效清空）
  recordMarkdownScroll('__reset__', { top: 0, scrollHeight: 0 })
  consumeMarkdownScrollRestore('__reset__')
})

describe('consumeMarkdownScrollRestore', () => {
  it('path 匹配时返回记录的滚动状态', () => {
    recordMarkdownScroll('docs/a.md', { top: 1200, scrollHeight: 4000 })
    expect(consumeMarkdownScrollRestore('docs/a.md')).toEqual({ top: 1200, scrollHeight: 4000 })
  })

  it('path 不匹配返回 null（切换文件后不回跳）', () => {
    recordMarkdownScroll('docs/a.md', { top: 1200, scrollHeight: 4000 })
    expect(consumeMarkdownScrollRestore('docs/b.md')).toBeNull()
  })

  it('无任何记录时返回 null（首次打开自然回顶）', () => {
    expect(consumeMarkdownScrollRestore('docs/a.md')).toBeNull()
  })

  it('消费即清空：同 path 第二次读取为 null（一次重载只恢复一次）', () => {
    recordMarkdownScroll('docs/a.md', { top: 800, scrollHeight: 3000 })
    expect(consumeMarkdownScrollRestore('docs/a.md')).not.toBeNull()
    expect(consumeMarkdownScrollRestore('docs/a.md')).toBeNull()
  })

  it('连续保存取最新一次', () => {
    recordMarkdownScroll('docs/a.md', { top: 100, scrollHeight: 3000 })
    recordMarkdownScroll('docs/a.md', { top: 500, scrollHeight: 3200 })
    expect(consumeMarkdownScrollRestore('docs/a.md')).toEqual({ top: 500, scrollHeight: 3200 })
  })
})
