// stores/layout.ts
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'
import { apiService } from '@/services/ApiService'

/**
 * 全局布局状态 Store
 * 管理侧边栏、工作目录等跨页面共享的布局状态
 */
export const useLayoutStore = defineStore('layout', () => {
  // 侧边栏可见性（持久化到 localStorage）
  const sidebarVisible = useStorage('sidebarVisible', true)

  // 工作目录可见性（持久化）
  const workspaceVisible = useStorage('workspaceVisible', false)

  // 工作目录分割比例（持久化，默认 pane1=75%, pane2=25%）
  const workspaceSplitSize = useStorage('workspaceSplitSize', 75)

  // 壁纸与透明度设置（持久化到 localStorage）
  const wallpaperUrl = useStorage<string | null>('wallpaperUrl', null)
  const sidebarOpacity = useStorage<number>('sidebarOpacity', 100)
  const contentOpacity = useStorage<number>('contentOpacity', 100)
  const acrylicEnabled = useStorage<boolean>('acrylicEnabled', true)
  const blurRadius = useStorage<number>('blurRadius', 20)

  // 防止重复加载壁纸的标志
  let isLoadingWallpaper = false

  /**
   * 切换侧边栏显示/隐藏
   */
  const toggleSidebar = (): void => {
    sidebarVisible.value = !sidebarVisible.value
  }

  /**
   * 设置侧边栏显隐状态
   */
  const setSidebarVisible = (visible: boolean): void => {
    sidebarVisible.value = visible
  }

  /**
   * 切换工作目录显示/隐藏
   */
  const toggleWorkspace = (): void => {
    workspaceVisible.value = !workspaceVisible.value
  }

  /**
   * 设置工作目录分割比例
   */
  const setWorkspaceSplitSize = (size: number): void => {
    workspaceSplitSize.value = size
  }

  /**
   * 设置壁纸 URL
   */
  const setWallpaperUrl = (url: string | null): void => {
    wallpaperUrl.value = url
  }

  /**
   * 设置侧边栏透明度
   */
  const setSidebarOpacity = (opacity: number): void => {
    sidebarOpacity.value = opacity
  }

  /**
   * 设置内容区透明度
   */
  const setContentOpacity = (opacity: number): void => {
    contentOpacity.value = opacity
  }

  /**
   * 设置毛玻璃效果开关
   */
  const setAcrylicEnabled = (enabled: boolean): void => {
    acrylicEnabled.value = enabled
  }

  /**
   * 设置毛玻璃模糊半径
   */
  const setBlurRadius = (radius: number): void => {
    blurRadius.value = radius
  }

  /**
   * 将存储的壁纸路径解析为完整 URL
   * 根据当前 apiService.baseURL 动态拼接，适配 Electron 随机端口
   */
  const resolveWallpaperUrl = (storedUrl: string | null): string | null => {
    if (!storedUrl) return null
    if (storedUrl.startsWith('http://') || storedUrl.startsWith('https://')) {
      return storedUrl
    }
    const baseUrl = apiService.baseURL.replace(/\/api\/v1$/, '')
    return `${baseUrl}${storedUrl.startsWith('/') ? '' : '/'}${storedUrl}`
  }

  /**
   * 应用壁纸设置到 CSS 变量
   * 无壁纸时不应用透明度和毛玻璃效果
   */
  const applyWallpaperSettings = (): void => {
    const root = document.documentElement

    // 设置壁纸
    if (wallpaperUrl.value) {
      // 如果正在加载中，避免重复触发
      if (isLoadingWallpaper) {
        return
      }

      // 先移除 loaded 类，隐藏壁纸
      root.classList.remove('wallpaper-loaded')
      isLoadingWallpaper = true

      // 解析为完整 URL 用于加载（适配动态端口）
      const fullUrl = resolveWallpaperUrl(wallpaperUrl.value)

      // 预加载壁纸图片
      const img = new Image()
      img.onload = () => {
        // 图片加载完成后，添加 loaded 类显示壁纸
        console.log('[壁纸加载] 完成，添加 wallpaper-loaded 类')
        root.classList.add('wallpaper-loaded')
        isLoadingWallpaper = false
      }
      img.onerror = () => {
        // 加载失败也显示，避免一直隐藏
        console.log('[壁纸加载] 失败，添加 wallpaper-loaded 类')
        root.classList.add('wallpaper-loaded')
        isLoadingWallpaper = false
      }
      img.src = fullUrl || ''
      console.log('[壁纸加载] 开始加载:', fullUrl)

      root.style.setProperty('--wallpaper-image', `url(${fullUrl})`)
      // 有壁纸时才应用透明度和毛玻璃
      root.style.setProperty('--sidebar-opacity', String(sidebarOpacity.value / 100))
      root.style.setProperty('--content-opacity', String(contentOpacity.value / 100))
      root.style.setProperty('--wallpaper-blur', `${blurRadius.value}px`)
      if (acrylicEnabled.value) {
        root.classList.add('acrylic-enabled')
      } else {
        root.classList.remove('acrylic-enabled')
      }
    } else {
      // 无壁纸时清除所有效果
      isLoadingWallpaper = false
      root.classList.remove('wallpaper-loaded')
      root.style.removeProperty('--wallpaper-image')
      root.style.removeProperty('--sidebar-opacity')
      root.style.removeProperty('--content-opacity')
      root.style.removeProperty('--wallpaper-blur')
      root.classList.remove('acrylic-enabled')
    }
  }

  /**
   * 从后端加载外观配置并应用
   */
  const loadAppearanceSettings = async (): Promise<void> => {
    try {
      const response = await apiService.fetchGroupSettings('appearance')

      if (response.wallpaperUrl !== undefined) {
        wallpaperUrl.value = response.wallpaperUrl || null
      }
      if (response.sidebarOpacity !== undefined) {
        sidebarOpacity.value = response.sidebarOpacity
      }
      if (response.contentOpacity !== undefined) {
        contentOpacity.value = response.contentOpacity
      }
      if (response.acrylicEnabled !== undefined) {
        acrylicEnabled.value = response.acrylicEnabled !== false
      }
      if (response.blurRadius !== undefined) {
        blurRadius.value = response.blurRadius
      }

      applyWallpaperSettings()
    } catch (error) {
      console.error('加载外观设置失败:', error)
      // 使用本地存储的值作为回退
      applyWallpaperSettings()
    }
  }

  // 监听壁纸/透明度变化，自动同步到 CSS 变量
  watch(
    [wallpaperUrl, sidebarOpacity, contentOpacity, acrylicEnabled, blurRadius],
    () => {
      applyWallpaperSettings()
    },
  )

  return {
    sidebarVisible,
    workspaceVisible,
    workspaceSplitSize,
    wallpaperUrl,
    sidebarOpacity,
    contentOpacity,
    acrylicEnabled,
    blurRadius,
    toggleSidebar,
    setSidebarVisible,
    toggleWorkspace,
    setWorkspaceSplitSize,
    setWallpaperUrl,
    setSidebarOpacity,
    setContentOpacity,
    setAcrylicEnabled,
    setBlurRadius,
    applyWallpaperSettings,
    loadAppearanceSettings,
  }
})
