import { describe, it, expect } from 'vitest'

import {
  isFsRoot,
  canGoUp,
  joinPath,
  parentPath,
  createBrowseRequestGuard,
} from './directoryBrowser'

/**
 * 目录浏览器纯逻辑（路径处理 + 请求守卫）的契约测试。
 * 组件（DirectoryBrowserDialog.vue）只做渲染与状态编排，交互规则都在这里。
 */
describe('isFsRoot / canGoUp', () => {
  it('识别 Windows 盘符根（带或不带反斜杠）', () => {
    expect(isFsRoot('D:\\')).toBe(true)
    expect(isFsRoot('D:')).toBe(true)
    expect(isFsRoot('C:/')).toBe(true)
  })

  it('识别 POSIX 根', () => {
    expect(isFsRoot('/')).toBe(true)
  })

  it('非根路径与空路径不是根', () => {
    expect(isFsRoot('D:\\AI')).toBe(false)
    expect(isFsRoot('/home')).toBe(false)
    expect(isFsRoot('')).toBe(false)
  })

  it('canGoUp：根与空路径不可上取，普通路径可以', () => {
    expect(canGoUp('D:\\')).toBe(false)
    expect(canGoUp('/')).toBe(false)
    expect(canGoUp('')).toBe(false)
    expect(canGoUp('D:\\AI')).toBe(true)
    expect(canGoUp('/home/user')).toBe(true)
  })
})

describe('joinPath', () => {
  it('Windows 路径用反斜杠拼接', () => {
    expect(joinPath('D:\\AI', 'ai_chat')).toBe('D:\\AI\\ai_chat')
  })

  it('POSIX 路径用斜杠拼接', () => {
    expect(joinPath('/home', 'user')).toBe('/home/user')
  })

  it('剥离 base 末尾分隔符后拼接（避免出现双斜杠）', () => {
    expect(joinPath('D:\\AI\\', 'chat')).toBe('D:\\AI\\chat')
    expect(joinPath('/home/', 'user')).toBe('/home/user')
  })

  it('空 base 时直接返回目录名（后端回退主目录场景不会走到）', () => {
    expect(joinPath('', 'x')).toBe('x')
  })
})

describe('parentPath', () => {
  it('Windows 深层路径逐级上取，盘符上一级直接落盘符根（补回反斜杠）', () => {
    expect(parentPath('D:\\AI\\ai_chat')).toBe('D:\\AI')
    expect(parentPath('D:\\AI')).toBe('D:\\')
    // 无分隔符的盘符原样返回：canGoUp 已把根挡住，这里只是防御性恒等
    expect(parentPath('D:')).toBe('D:')
  })

  it('POSIX 路径上取，根的上取仍是根', () => {
    expect(parentPath('/home/user')).toBe('/home')
    expect(parentPath('/home')).toBe('/')
  })

  it('无分隔符的孤立段返回原路径（不可上取的场景由 canGoUp 挡住）', () => {
    expect(parentPath('somewhere')).toBe('somewhere')
  })

  it('末尾分隔符先剥离再上取', () => {
    expect(parentPath('D:\\AI\\')).toBe('D:\\')
    expect(parentPath('/home/')).toBe('/')
  })
})

describe('createBrowseRequestGuard', () => {
  it('新请求使旧请求的快照过期', () => {
    const guard = createBrowseRequestGuard()
    const first = guard.begin()
    expect(guard.isCurrent(first)).toBe(true)

    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('同一代次重复比对始终为真（finally 清理场景）', () => {
    const guard = createBrowseRequestGuard()
    const gen = guard.begin()
    expect(guard.isCurrent(gen)).toBe(true)
    expect(guard.isCurrent(gen)).toBe(true)
  })

  it('代次单调递增（快速连点目录时每个请求拿到独立快照）', () => {
    const guard = createBrowseRequestGuard()
    const generations = [guard.begin(), guard.begin(), guard.begin()]
    expect(new Set(generations).size).toBe(3)
    for (const gen of generations) {
      if (gen !== generations[generations.length - 1]) {
        expect(guard.isCurrent(gen)).toBe(false)
      }
    }
  })
})
