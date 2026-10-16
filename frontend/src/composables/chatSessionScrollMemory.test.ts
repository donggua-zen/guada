import { afterEach, describe, expect, it } from 'vitest'
import {
  buildChatSessionScrollMemoryKey,
  CHAT_SCROLL_MEMORY_MAX_ENTRIES,
  clampScrollTop,
  clearChatSessionScrollMemory,
  loadChatSessionScrollMemory,
  resetChatSessionScrollMemory,
  saveChatSessionScrollMemory,
  shouldRetryScrollMemoryRestore,
  type ChatSessionScrollMemoryState,
} from './chatSessionScrollMemory'

function state(patch: Partial<ChatSessionScrollMemoryState> = {}): ChatSessionScrollMemoryState {
  return {
    scrollTop: 1200,
    scrollHeight: 4000,
    clientHeight: 600,
    wasPinnedToBottom: false,
    updatedAt: 1,
    ...patch,
  }
}

afterEach(() => {
  resetChatSessionScrollMemory()
})

describe('buildChatSessionScrollMemoryKey', () => {
  it('直接按会话 ID 隔离（会话 ID 全局唯一）', () => {
    expect(buildChatSessionScrollMemoryKey('s1')).toBe('s1')
  })

  it('不同会话互不串味', () => {
    expect(buildChatSessionScrollMemoryKey('s1')).not.toBe(buildChatSessionScrollMemoryKey('s2'))
  })
})

describe('save / load', () => {
  it('写入后可读回同一状态', () => {
    const key = 'k1'
    saveChatSessionScrollMemory(key, state())
    expect(loadChatSessionScrollMemory(key)).toEqual(state())
  })

  it('未写入的键返回 null', () => {
    expect(loadChatSessionScrollMemory('missing')).toBeNull()
  })

  it('clear 只删指定键', () => {
    saveChatSessionScrollMemory('a', state())
    saveChatSessionScrollMemory('b', state())
    clearChatSessionScrollMemory('a')
    expect(loadChatSessionScrollMemory('a')).toBeNull()
    expect(loadChatSessionScrollMemory('b')).not.toBeNull()
  })
})

describe('容量与 LRU 淘汰', () => {
  it('超过上限时淘汰最早写入的条目', () => {
    for (let i = 0; i < CHAT_SCROLL_MEMORY_MAX_ENTRIES; i++) {
      saveChatSessionScrollMemory(`k${i}`, state({ scrollTop: i }))
    }
    saveChatSessionScrollMemory('overflow', state())
    expect(loadChatSessionScrollMemory('k0')).toBeNull()
    expect(loadChatSessionScrollMemory('k1')).not.toBeNull()
    expect(loadChatSessionScrollMemory('overflow')).not.toBeNull()
  })

  it('读取会触碰条目：LRU 淘汰最久未访问的', () => {
    for (let i = 0; i < CHAT_SCROLL_MEMORY_MAX_ENTRIES; i++) {
      saveChatSessionScrollMemory(`k${i}`, state({ scrollTop: i }))
    }
    // 触碰 k0，使它不再是「最久未访问」
    loadChatSessionScrollMemory('k0')
    saveChatSessionScrollMemory('overflow', state())
    expect(loadChatSessionScrollMemory('k0')).not.toBeNull()
    expect(loadChatSessionScrollMemory('k1')).toBeNull()
  })
})

describe('clampScrollTop', () => {
  it('内容更长时保持原位置', () => {
    const metrics = { scrollTop: 0, viewportHeight: 600, contentHeight: 5000 }
    expect(clampScrollTop(state({ scrollTop: 1200 }), metrics)).toBe(1200)
  })

  it('内容变短时收到可滚动上限', () => {
    const metrics = { scrollTop: 0, viewportHeight: 600, contentHeight: 900 }
    expect(clampScrollTop(state({ scrollTop: 1200 }), metrics)).toBe(300)
  })

  it('内容不足一屏时收到 0', () => {
    const metrics = { scrollTop: 0, viewportHeight: 900, contentHeight: 500 }
    expect(clampScrollTop(state({ scrollTop: 200 }), metrics)).toBe(0)
  })

  it('负值收成 0', () => {
    const metrics = { scrollTop: 0, viewportHeight: 600, contentHeight: 5000 }
    expect(clampScrollTop(state({ scrollTop: -5 }), metrics)).toBe(0)
  })
})

describe('shouldRetryScrollMemoryRestore', () => {
  it('贴底记忆不需要重试（后续撑高由贴底路径跟随）', () => {
    expect(shouldRetryScrollMemoryRestore(state({ wasPinnedToBottom: true }), 0)).toBe(false)
  })

  it('非贴底且当前被钳到目标之下 → 需要重试', () => {
    expect(shouldRetryScrollMemoryRestore(state({ scrollTop: 1200 }), 300)).toBe(true)
  })

  it('到达目标（容差内）→ 不再重试', () => {
    expect(shouldRetryScrollMemoryRestore(state({ scrollTop: 1200 }), 1200)).toBe(false)
    expect(shouldRetryScrollMemoryRestore(state({ scrollTop: 1200 }), 1197)).toBe(false)
  })

  it('目标是顶部（scrollTop <= 0）无需重试', () => {
    expect(shouldRetryScrollMemoryRestore(state({ scrollTop: 0 }), 0)).toBe(false)
  })
})
