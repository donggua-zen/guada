// stores/layout.ts
import { defineStore } from 'pinia'
import { useStorage, useWindowSize } from '@vueuse/core'
import { watch, ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import { NEW_SESSION_ID, SIDEBAR_AUTO_COLLAPSE_WIDTH } from '@/constants'
import { useTheme } from '@/composables/useTheme'
import { applyLanguageFromAppearance } from '@/composables/useLanguage'
import type { AppearanceGroupSettings } from '@/types/service'
import { useSessionStore } from '@/stores/session'

/**
 * 全局布局状态 Store
 * 管理侧边栏、工作目录等跨页面共享的布局状态
 */

/**
 * 工作区显示完全由激活标签驱动（tabStore.activeTabKey），不再有独立的面板模式。
 */
export const useLayoutStore = defineStore('layout', () => {
  // 侧边栏可见性（持久化到 localStorage）：存的是**用户偏好**。
  // 小窗自动收起绝不改写它——否则在小窗里收起一次，之后在大窗启动也会跟着少一次展开。
  const sidebarVisible = useStorage('sidebarVisible', true)

  // 小窗自动收起（运行时状态，不持久化）：窗口过窄时临时收起侧栏
  const sidebarAutoCollapsed = ref(false)

  /** 侧栏最终是否显示 = 用户偏好 && 未被小窗自动收起。渲染方一律读这个，不要读 sidebarVisible */
  const sidebarEffectiveVisible = computed(() => sidebarVisible.value && !sidebarAutoCollapsed.value)

  // 窗口宽度跨过阈值时切换；immediate 保证在小窗里启动也直接是收起态
  const { width: windowWidth } = useWindowSize()
  const isNarrowWindow = computed(() => windowWidth.value > 0 && windowWidth.value < SIDEBAR_AUTO_COLLAPSE_WIDTH)
  watch(isNarrowWindow, (narrow) => {
    sidebarAutoCollapsed.value = narrow
  }, { immediate: true })

  // 侧边栏宽度（持久化；SidebarLayout 拖拽把手调整，emit 前已按其钳制范围取整）
  const sidebarWidth = useStorage('sidebarWidth', 285)

  // 工作目录可见性（会话级，持久化，按 sessionId 记录各会话自己的开关）
  const workspaceVisibleBySession = useStorage<Record<string, boolean>>('workspaceVisibleBySession', {})

  // 当前归属会话（运行时，跟随 sessionStore.activeSessionId，不持久化）
  const workspaceVisibleSessionId = ref<string | null>(null)

  // 清理旧版全局开关键（默认开启 → 已改为会话级存储，默认关闭）
  try {
    localStorage.removeItem('workspaceVisible')
  } catch {
    /* localStorage 不可用时忽略 */
  }

  // 对外统一访问器：读写「当前会话」的可见性；无会话或未记录时默认关闭。
  // 既有调用方（ChatPage / 快捷键 / 预览入口等）经此读写即自动获得会话级行为
  const workspaceVisible = computed<boolean>({
    get: () => {
      const sid = workspaceVisibleSessionId.value
      if (!sid) return false
      return workspaceVisibleBySession.value[sid] ?? false
    },
    set: (visible) => {
      const sid = workspaceVisibleSessionId.value
      if (sid) workspaceVisibleBySession.value[sid] = visible
    },
  })

  // 会话切换时自动绑定归属会话（NEW_SESSION_ID / null → 无会话，面板关闭）
  const sessionStore = useSessionStore()
  watch(
    () => sessionStore.activeSessionId,
    (id) => {
      workspaceVisibleSessionId.value = id && id !== NEW_SESSION_ID ? id : null
    },
    { immediate: true },
  )

  // 工作目录分割比例（持久化，默认 pane1=75%, pane2=25%）
  // 目录树 / 预览 / Git 三种模式统一使用该宽度
  const workspaceSplitSize = useStorage('workspaceSplitSize', 75)

  // 目录树显隐已改为「每个文件标签独立记忆」（tab.treeVisible，随标签缓存持久化），
  // 清理早期全局开关的遗留存储键
  try {
    localStorage.removeItem('workspaceTreeVisible')
  } catch {
    /* localStorage 不可用时忽略 */
  }

  // 工作目录全屏模式（非持久化，会话级运行时状态）：全屏 = pane1 收起、工作目录占满窗口
  const workspaceFullscreen = ref(false)

  // 全屏悬浮对话面板已摘除，清理遗留的位置持久化键
  try {
    localStorage.removeItem('floatingChatPosition')
  } catch {
    /* localStorage 不可用时忽略 */
  }

  // 壁纸与透明度设置（持久化到 localStorage）
  const wallpaperUrl = useStorage<string | null>('wallpaperUrl', null)
  const sidebarOpacity = useStorage<number>('sidebarOpacity', 100)
  const contentOpacity = useStorage<number>('contentOpacity', 100)

  // 悬浮任务窗设置（持久化到 localStorage）
  const floatWidgetEnabled = useStorage<boolean>('floatWidgetEnabled', false)
  const floatWidgetOpacity = useStorage<number>('floatWidgetOpacity', 95)

  // 防止重复加载壁纸的标志
  let isLoadingWallpaper = false

  /**
   * 切换侧边栏显示/隐藏
   *
   * 以「实际是否显示」为准：小窗自动收起时按一次应当展开——若翻的是用户偏好，
   * 第一下只会把偏好改成 false，界面上看起来毫无反应，得点两次才展开。
   */
  const toggleSidebar = (): void => {
    const next = !sidebarEffectiveVisible.value
    sidebarAutoCollapsed.value = false
    sidebarVisible.value = next
  }

  /**
   * 设置侧边栏显隐状态
   * （用户显式操作：折叠按钮 / 小窗遮罩 / Ctrl+B，优先于「小窗自动收起」）
   */
  const setSidebarVisible = (visible: boolean): void => {
    sidebarAutoCollapsed.value = false
    sidebarVisible.value = visible
  }

  /**
   * 设置侧边栏宽度（像素；由 SidebarLayout 拖拽把手调用，值已钳制取整）
   */
  const setSidebarWidth = (width: number): void => {
    sidebarWidth.value = width
  }

  /**
   * 切换工作目录显示/隐藏
   */
  const toggleWorkspace = (): void => {
    workspaceVisible.value = !workspaceVisible.value
  }

  const setWorkspaceVisible = (visible: boolean): void => {
    workspaceVisible.value = visible
  }

  /**
   * 设置工作目录分割比例
   */
  const setWorkspaceSplitSize = (size: number): void => {
    workspaceSplitSize.value = size
  }

  /**
   * 切换工作目录全屏模式
   */
  const toggleWorkspaceFullscreen = (): void => {
    workspaceFullscreen.value = !workspaceFullscreen.value
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
   * 设置悬浮任务窗显隐
   */
  const setFloatWidgetEnabled = (enabled: boolean): void => {
    floatWidgetEnabled.value = enabled
  }

  /**
   * 设置悬浮任务窗透明度
   */
  const setFloatWidgetOpacity = (opacity: number): void => {
    floatWidgetOpacity.value = opacity
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
   * 无壁纸时不应用透明度
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
      // 有壁纸时才应用透明度
      root.style.setProperty('--sidebar-opacity', String(sidebarOpacity.value / 100))
      root.style.setProperty('--content-opacity', String(contentOpacity.value / 100))
    } else {
      // 无壁纸时清除所有效果
      isLoadingWallpaper = false
      root.classList.remove('wallpaper-loaded')
      root.style.removeProperty('--wallpaper-image')
      root.style.removeProperty('--sidebar-opacity')
      root.style.removeProperty('--content-opacity')
    }
  }

  /**
   * 最近一次成功拉取的 appearance 分组。
   * 设置页表单直接复用这份 payload，不再自己发第二次请求（同一启动内只有一次读取）。
   */
  const appearanceSettings = ref<AppearanceGroupSettings | null>(null)

  /** 在途请求：并发调用（启动加载 + 设置页挂载）复用同一个 Promise */
  let appearancePending: Promise<void> | null = null

  /**
   * 从后端加载外观配置并应用（幂等：同一启动内只真正请求一次）
   */
  const loadAppearanceSettings = (): Promise<void> => {
    if (!appearancePending) {
      appearancePending = fetchAndApplyAppearance().then((ok) => {
        // 失败不留缓存：下次调用（如稍后打开设置页）重新尝试
        if (!ok) appearancePending = null
      })
    }
    return appearancePending
  }

  const fetchAndApplyAppearance = async (): Promise<boolean> => {
    try {
      const response = await apiService.fetchGroupSettings<AppearanceGroupSettings>('appearance')
      appearanceSettings.value = response

      if (response.wallpaperUrl !== undefined) {
        wallpaperUrl.value = response.wallpaperUrl || null
      }
      if (response.sidebarOpacity !== undefined) {
        sidebarOpacity.value = response.sidebarOpacity
      }
      if (response.contentOpacity !== undefined) {
        contentOpacity.value = response.contentOpacity
      }
      if (response.floatWidgetEnabled !== undefined) {
        floatWidgetEnabled.value = response.floatWidgetEnabled === true
      }
      if (response.floatWidgetOpacity !== undefined) {
        floatWidgetOpacity.value = response.floatWidgetOpacity
      }

      // 语言与外观同组下发：只在这里消费（App.vue 不再单独拉一次 appearance）
      applyLanguageFromAppearance(response.language)

      // 同步主题预设（后端优先，覆盖本地 localStorage）
      const { setLightThemePreset, setDarkThemePreset } = useTheme()
      if (response.lightThemePreset) {
        setLightThemePreset(response.lightThemePreset)
      }
      if (response.darkThemePreset) {
        setDarkThemePreset(response.darkThemePreset)
      }

      applyWallpaperSettings()

      // 同步悬浮窗设置到 Electron 主进程
      if (window.electronAPI) {
        window.electronAPI.updateTraySettings({
          enabled: floatWidgetEnabled.value,
          opacity: floatWidgetOpacity.value,
        })
      }
      return true
    } catch (error) {
      console.error('加载外观设置失败:', error)
      // 使用本地存储的值作为回退
      applyWallpaperSettings()
      return false
    }
  }

  // 监听壁纸/透明度变化，自动同步到 CSS 变量
  watch(
    [wallpaperUrl, sidebarOpacity, contentOpacity],
    () => {
      applyWallpaperSettings()
    },
  )

  return {
    sidebarVisible,
    sidebarEffectiveVisible,
    sidebarWidth,
    workspaceVisible,
    workspaceSplitSize,
    workspaceFullscreen,
    wallpaperUrl,
    sidebarOpacity,
    contentOpacity,
    floatWidgetEnabled,
    floatWidgetOpacity,
    toggleSidebar,
    setSidebarVisible,
    setSidebarWidth,
    toggleWorkspace,
    setWorkspaceVisible,
    setWorkspaceSplitSize,
    toggleWorkspaceFullscreen,
    setWallpaperUrl,
    setSidebarOpacity,
    setContentOpacity,
    setFloatWidgetEnabled,
    setFloatWidgetOpacity,
    applyWallpaperSettings,
    appearanceSettings,
    loadAppearanceSettings,
  }
})
