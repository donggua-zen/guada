import { beforeEach, describe, expect, it, vi } from 'vitest'

// vitest 跑在 node 环境：模块调用时才读取 sessionStorage，先在 import 前把桩就位
vi.hoisted(() => {
  const makeStorage = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        m.set(k, String(v))
      },
      removeItem: (k: string) => {
        m.delete(k)
      },
      clear: () => {
        m.clear()
      },
    }
  }
  ;(globalThis as any).sessionStorage = makeStorage()
})

import { getSettingsReturnPath, rememberSettingsReturnPath } from './settingsReturn'

describe('settingsReturn 返回目标记忆', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('记录并读回完整路径（含 query）', () => {
    rememberSettingsReturnPath('/chat/abc?workspacePath=%2Ftmp')
    expect(getSettingsReturnPath()).toBe('/chat/abc?workspacePath=%2Ftmp')
  })

  it('空路径不覆盖已有记录', () => {
    rememberSettingsReturnPath('/chat/abc')
    rememberSettingsReturnPath('')
    expect(getSettingsReturnPath()).toBe('/chat/abc')
  })

  it('无记录返回 null', () => {
    expect(getSettingsReturnPath()).toBeNull()
  })

  it('拒绝设置页自身路径，避免返回循环', () => {
    rememberSettingsReturnPath('/setting/general')
    expect(getSettingsReturnPath()).toBeNull()
  })

  it('sessionStorage 不可用时不抛错并返回 null', () => {
    const original = (globalThis as any).sessionStorage
    delete (globalThis as any).sessionStorage
    try {
      expect(() => rememberSettingsReturnPath('/chat/abc')).not.toThrow()
      expect(getSettingsReturnPath()).toBeNull()
    } finally {
      ;(globalThis as any).sessionStorage = original
    }
  })
})
