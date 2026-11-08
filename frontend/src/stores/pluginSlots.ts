import { defineStore } from 'pinia'
import { markRaw, defineAsyncComponent, type Component } from 'vue'

import { apiService } from '@/services/ApiService'
import { useLayoutStore } from '@/stores/layout'
import { useTheme } from '@/composables/useTheme'
import type { GuaDaModuleLoader } from '@/types/plugin-runtime'
import type { PluginThemeManifest } from '@/services/modules/plugin.api'
import {
  replaceThemesByPlugin,
  removeThemesByPlugin,
  getThemePreset,
  isRichTheme,
  notifyThemeSetting,
} from '@/themes'
import { removeTheme, activeThemeId } from '@/services/theme-runtime'
import { toast } from '@/components/ui/toastService';

// 主应用内置组件 import map：'builtin:xxx' 从这里解析
import ConnectionSettings from '@/components/setting/ConnectionSettings.vue'
import ModelsProviderList from '@/components/setting/ModelsProviderList.vue'
import GeneralSettings from '@/components/setting/GeneralSettings.vue'

/** slot 条目（后端 /plugins/slots 下发，或 registerLocal 本地注册） */
export interface SlotItem {
  pluginId: string
  /** 组件标识：'builtin:<key>' 走内置 import map，其余按插件产物文件名解析 */
  component: string
  order: number
  /** 渲染模式（list 等，语义由 slot 消费方决定） */
  mode?: string
  /** 透传给 slot 组件的 props */
  props?: Record<string, unknown>
  /** slot 消费方读取的元数据（如设置页的 label） */
  meta?: Record<string, unknown>
  /** 插件资源版本号，拼静态资源 URL 用 */
  rev?: string
}

/** resolve() 返回项：component 已解析为可渲染组件 */
export interface ResolvedSlotItem extends Omit<SlotItem, 'component'> {
  component: Component
  /** 原始组件标识（字符串），component 被解析后用于路由/页签匹配 */
  slotKey: string
}

interface PluginSlotsState {
  /** slot 名 → 条目列表 */
  slots: Record<string, SlotItem[]>
  initialized: boolean
  version: number
}

const BUILTIN: Record<string, Component> = {
  connection: ConnectionSettings,
  models: ModelsProviderList,
  general: GeneralSettings,
}

const LoadingPlaceholder = { template: '<div class="p-4 text-sm text-gray-400">Loading plugin…</div>' }
const PluginErrorBoundary = {
  props: ['error'],
  template: '<div class="p-4 text-sm text-red-400">Plugin failed to load: {{ error }}</div>',
}

function resolveBuiltin(key: string): Component {
  const c = BUILTIN[key]
  if (!c) throw new Error(`pluginSlots: unknown builtin component "${key}"`)
  return markRaw(c)
}

/** 外部插件模块加载器由 main.js 启动时挂载，缺失属初始化异常，快速失败而非静默降级 */
function moduleLoader(): GuaDaModuleLoader {
  const loader = window.__GuaDaModuleLoader__
  if (!loader) throw new Error('pluginSlots: __GuaDaModuleLoader__ 未初始化')
  return loader
}

function asyncPluginComponent(item: SlotItem): Component {
  return defineAsyncComponent({
    loader: () =>
      moduleLoader().import(`${item.pluginId}:${item.component}`).then((mod) => mod.default),
    loadingComponent: LoadingPlaceholder,
    errorComponent: PluginErrorBoundary,
    delay: 0,
    timeout: 15000,
  })
}

// 已注册主题的插件集合：模块级而非 pinia state（Set 不适合进响应式 state）
let registeredThemePlugins: Set<string> | null = null

/**
 * 插件 Slot 注册表（Pinia store）
 *
 * - init()：从后端拉取 slot 清单，外部插件 prepare 进加载器
 * - resolve(name)：返回某 slot 的已排序组件列表（内置组件 + 外部插件）
 * - watchRefresh()：SSE 监听插件启停，增量增删 slot 条目并卸载失效模块
 */
export const usePluginSlots = defineStore('pluginSlots', {
  state: (): PluginSlotsState => ({
    slots: {},          // slot 名 → SlotItem[]（含 pluginId/component/order/props/meta/loadMode/rev）
    initialized: false,
    version: 0,
  }),

  getters: {
    resolve: (state) => (name: string): ResolvedSlotItem[] => {
      const items = (state.slots[name] || []).slice().sort((a, b) => a.order - b.order)
      return items.map((item) => ({
        ...item,
        // 保留原始组件标识（component 会被替换成已解析组件，路由/页签仍需字符串 key）
        slotKey: item.component,
        component: item.component.startsWith('builtin:')
          ? resolveBuiltin(item.component.slice(8))
          : asyncPluginComponent(item),
      }))
    },

    /** 原始 slot 条目（component 仍是字符串），供路由/导航等需要稳定 key 的场景 */
    rawOf: (state) => (name: string): SlotItem[] =>
      (state.slots[name] || []).slice().sort((a, b) => a.order - b.order),

    metaOf: (state) => (name: string): NonNullable<SlotItem['meta']>[] =>
      (state.slots[name] || []).map((i) => i.meta).filter((m): m is NonNullable<SlotItem['meta']> => Boolean(m)),

    hasSlot: (state) => (name: string): boolean => (state.slots[name] || []).length > 0,
  },

  actions: {
    async init() {
      if (this.initialized) return
      const data = await apiService.getPluginSlots()
      // applySlots 内部会 await 前的同步调用 syncSkins，这里不再重复
      this.applySlots(data.slots || {}, data.themes || [], data.skins || [])
      this.initialized = true
      this.watchRefresh()
    },

    applySlots(
      slots: Record<string, SlotItem[]>,
      themes: PluginThemeManifest[] = [],
      skins: unknown[] = [],
    ) {
      for (const [slot, items] of Object.entries(slots)) {
        for (const item of items) {
          this.prepareExternal(item)
        }
        this.slots[slot] = items.map(markRaw)
      }
      this.syncThemes(themes)
      void this.syncSkins(skins)
      this.version++
    },

    /**
     * 同步富主题（v3：原「皮肤」已并入主题）
     *
     * 富主题由主题选择（`gd:theme-preset-light/dark`）驱动，不走独立的皮肤开关；
     * 这里只处理「当前生效的富主题被移除」的回退。
     */
    async syncSkins(skins: unknown[]) {
      const rich = (skins || []) as Array<Record<string, any>>
      if (rich.length === 0 && activeThemeId() && isRichTheme(getThemePreset(activeThemeId()!))) {
        // 插件被禁用/卸载：富主题清单清空，但主题 id 还指向它
        removeTheme()
        toast.warning('当前主题已被移除，已还原默认外观')
      }
    },

    /** 皮肤设置变更后通知运行时（v3 起统一走主题运行时） */
    notifySkinSetting(key: string, value: unknown) {
      notifyThemeSetting(key, value)
    },

    /**
     * 同步插件主题注册表（后端清单为准，全量 diff）
     * - 清单内插件：replaceThemesByPlugin 全量替换（rev 变化自然更新 URL）
     * - 清单外插件（禁用/卸载）：removeThemesByPlugin，若当前生效主题被移除则回退 default
     */
    syncThemes(themes: PluginThemeManifest[]) {
      if (!registeredThemePlugins) registeredThemePlugins = new Set()
      const next = new Set(themes.map((t) => t.pluginId).filter(Boolean))

      for (const pluginId of next) {
        const list = themes
          .filter((t) => t.pluginId === pluginId)
          .map((t) => ({
            info: {
              id: t.id,
              name: t.name,
              primaryColor: t.primaryColor,
              secondaryColor: t.secondaryColor,
              mode: t.mode,
              pluginId: t.pluginId,
              cssFile: t.cssFile,
              // v3：富主题字段（原「皮肤」）
              cssFiles: (t as any).cssFiles,
              runtimeScript: (t as any).runtimeScript,
              assetBase: (t as any).assetBase,
              bodyAttribute: (t as any).bodyAttribute,
              settings: (t as any).settings,
              preview: (t as any).preview,
              ownsBackground: (t as any).ownsBackground,
              recommendedThemes: (t as any).recommendedThemes,
              rev: t.rev,
            },
            cssUrl: this.themeCssUrl(t),
          }))
        replaceThemesByPlugin(pluginId, list)
      }

      const removed = [...registeredThemePlugins].filter((p) => !next.has(p))
      for (const pluginId of removed) {
        const removedIds = removeThemesByPlugin(pluginId)
        if (removedIds.length) this.fallbackIfActiveThemeRemoved(removedIds)
      }
      registeredThemePlugins = next
    },

    /** 拼插件主题 CSS 完整 URL（与 prepareExternal 同一 base 规则） */
    themeCssUrl(theme: PluginThemeManifest): string {
      const base = String(apiService.baseURL || '/api/v1').replace(/\/$/, '')
      return `${base}/plugins/${theme.pluginId}/assets/${theme.cssFile}?rev=${theme.rev || ''}`
    },

    /** 当前生效主题被插件移除时回退 default */
    fallbackIfActiveThemeRemoved(removedIds: string[]) {
      const { activeThemePreset, lightThemePreset, darkThemePreset, setActiveThemePreset } = useTheme()
      if (removedIds.includes(activeThemePreset.value)) {
        setActiveThemePreset('default')
        toast.warning('当前主题已被插件移除，已回退到默认主题')
        // 同步回退结果到后端与缓存，否则启动期“后端优先”恢复会把已移除的主题 id 再次拉起
        apiService
          .updateGroupSettings('appearance', {
            lightThemePreset: lightThemePreset.value,
            darkThemePreset: darkThemePreset.value,
          })
          .then((saved) =>
            useLayoutStore().updateAppearanceSettingsCache(saved as Record<string, unknown>),
          )
          .catch(() => {})
      }
    },

    prepareExternal(item: SlotItem) {
      if (!item.component || item.component.startsWith('builtin:')) return
      // apiService.baseURL：web dev = "/api/v1"，Electron = "http://localhost:PORT/api/v1"
      const base = String(apiService.baseURL || '/api/v1').replace(/\/$/, '')
      // slot 组件产物约定位于插件 frontend/dist/（相对插件根），显式带上前缀；
      // 插件主题 CSS 由 syncThemes → themeCssUrl 按 cssFile 相对插件根拼接
      moduleLoader().prepare({
        id: `${item.pluginId}:${item.component}`,
        url: `${base}/plugins/${item.pluginId}/assets/frontend/dist/${item.component}.js?rev=${item.rev || ''}`,
        cssUrl: `${base}/plugins/${item.pluginId}/assets/frontend/dist/${item.component}.css?rev=${item.rev || ''}`,
      })
    },

    // 从所有 slot 移除某插件的条目（插件禁用时）
    removePlugin(pluginId: string) {
      for (const name of Object.keys(this.slots)) {
        const before = this.slots[name].length
        this.slots[name] = this.slots[name].filter((x) => x.pluginId !== pluginId)
        if (this.slots[name].length !== before) {
          for (const item of this.slots[name]) this.prepareExternal(item)
        }
      }
      // 同步移除该插件的主题注册；当前生效主题被移除时回退 default
      const removedIds = removeThemesByPlugin(pluginId)
      if (removedIds.length) this.fallbackIfActiveThemeRemoved(removedIds)
      if (registeredThemePlugins) registeredThemePlugins.delete(pluginId)
      this.version++
    },

    // 复用全局 Session SSE（MainLayout 里 apiService.connectSessionEvents() 建立），
    // 插件注册/卸载/启停时后端广播 plugins_changed，这里全量刷新（简单可靠）
    watchRefresh() {
      try {
        apiService.onSessionEvent('plugins_changed', async () => {
          try {
            const data = await apiService.getPluginSlots()
            this.slots = {}
            this.applySlots(data.slots || {}, data.themes || [], data.skins || [])
          } catch (e) {
            console.error('[pluginSlots] refresh failed', e)
          }
        })
      } catch (e) {
        console.warn('[pluginSlots] SSE 订阅不可用（无全局连接时降级为仅首屏加载）', e)
      }
    },

    registerLocal(name: string, item: Partial<SlotItem> & { component: string }) {
      const entry = { pluginId: '__local__', order: 100, mode: 'list', ...item }
      if (!this.slots[name]) this.slots[name] = []
      this.slots[name].push(markRaw(entry))
      this.version++
    },

    invalidate(name: string) {
      delete this.slots[name]
    },
  },
})
