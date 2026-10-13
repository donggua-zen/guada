import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * useFullscreen 测试
 *
 * 覆盖主进程全屏状态 → 渲染进程的同步契约：
 * - 初始值来自 isFullScreen() 查询（异步，先回落 false）
 * - enter/leave-full-screen 经 onFullscreenChange 推送后更新
 * - 非 Electron 环境（无 electronAPI）恒为 false 且不抛错
 */

let fullscreenCallback: ((v: boolean) => void) | undefined

function stubElectron(initial: boolean) {
  fullscreenCallback = undefined
  vi.stubGlobal('window', {
    electronAPI: {
      isFullScreen: () => Promise.resolve(initial),
      onFullscreenChange: (cb: (v: boolean) => void) => {
        fullscreenCallback = cb
      },
    },
  })
}

// composable 内部是模块级单例（initialized 守卫），每个用例重置模块避免串状态
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('useFullscreen', () => {
  it('初始值来自 isFullScreen() 查询', async () => {
    stubElectron(true)
    const { useFullscreen } = await import('./useFullscreen')
    const { isFullscreen } = useFullscreen()
    // 查询是异步的，同步阶段先回落默认值
    expect(isFullscreen.value).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(isFullscreen.value).toBe(true)
  })

  it('全屏状态变化经 onFullscreenChange 更新', async () => {
    stubElectron(false)
    const { useFullscreen } = await import('./useFullscreen')
    const { isFullscreen } = useFullscreen()
    await Promise.resolve()

    fullscreenCallback?.(true)
    expect(isFullscreen.value).toBe(true)

    fullscreenCallback?.(false)
    expect(isFullscreen.value).toBe(false)
  })

  it('非 Electron 环境恒为 false 且不抛错', async () => {
    vi.stubGlobal('window', {})
    const { useFullscreen } = await import('./useFullscreen')
    const { isFullscreen } = useFullscreen()
    await Promise.resolve()
    expect(isFullscreen.value).toBe(false)
  })
})
