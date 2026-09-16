import { afterEach, describe, expect, it, vi } from 'vitest'

import { toResourceUrl } from './url'

/**
 * toResourceUrl：附件引用 → 展示 URL。
 *
 * 2026-09 新增 session 形态（sessions/<id>/images|previews/...，自包含引用）：
 * 不再经 /uploads 静态服务，改走鉴权取图端点 `api/v1/sessions/<id>/attachments/raw-file?path=..&token=..`。
 * <img> 带不上 Authorization 头，token 走 query（workspace raw-file 同款）。
 */

function mockElectron(port: number) {
  const storage = new Map<string, string>()
  ;(globalThis as any).window = {
    electronAPI: {
      getBackendStatusSync: () => ({ port }),
    },
  }
  ;(globalThis as any).sessionStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
  }
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
  }
  return {
    setToken: (t: string) => storage.set('token', t),
  }
}

function mockWeb() {
  delete (globalThis as any).window
  delete (globalThis as any).sessionStorage
  delete (globalThis as any).localStorage
}

afterEach(() => {
  mockWeb()
  vi.restoreAllMocks()
})

describe('session 形态（sessions/<id>/...）', () => {
  it('Web：拼成同源鉴权取图端点，token 进 query', () => {
    mockWeb()
    const url = toResourceUrl('sessions/s1/images/20260915/a.jpg')
    expect(url).toBe('/api/v1/sessions/s1/attachments/raw-file?path=images%2F20260915%2Fa.jpg&token=')
  })

  it('Electron：拼成带动态端口的完整 URL', () => {
    const env = mockElectron(4321)
    env.setToken('tok-123')
    const url = toResourceUrl('sessions/s1/previews/20260915/a.jpg')
    expect(url).toBe(
      'http://localhost:4321/api/v1/sessions/s1/attachments/raw-file?path=previews%2F20260915%2Fa.jpg&token=tok-123',
    )
  })

  it('sessionId 与路径各自编码（不把分隔符吃进别的段）', () => {
    mockWeb()
    const url = toResourceUrl('sessions/s-1/images/20260915/报告 1.jpg')
    expect(url).toContain('/sessions/s-1/attachments/raw-file')
    expect(url).toContain('path=images%2F20260915%2F%E6%8A%A5%E5%91%8A%201.jpg')
  })

  it('空引用 / 非 session 形态不受影响', () => {
    mockWeb()
    expect(toResourceUrl('')).toBe('')
    expect(toResourceUrl(undefined)).toBe('')
  })
})

describe('旧形态（uploads/...）回归', () => {
  it('Web：原样同源相对路径', () => {
    mockWeb()
    expect(toResourceUrl('uploads/images/20260915/a.jpg')).toBe('/uploads/images/20260915/a.jpg')
  })

  it('Electron：拼动态端口（端口进程内缓存，与首个 Electron 用例一致）', () => {
    // cachedBackendOrigin 是模块级缓存（端口在进程生命周期内固定，这正是设计意图）
    mockElectron(9999)
    expect(toResourceUrl('uploads/previews/x.jpg')).toBe(
      'http://localhost:4321/uploads/previews/x.jpg',
    )
  })

  it('已带 / 前缀与绝对 URL 原样透传', () => {
    mockWeb()
    expect(toResourceUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg')
    expect(toResourceUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg')
    expect(toResourceUrl('data:image/png;base64,QUJD')).toBe('data:image/png;base64,QUJD')
    expect(toResourceUrl('blob:http://x/abc')).toBe('blob:http://x/abc')
  })
})
