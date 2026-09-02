import { defineStore } from 'pinia'
import { markRaw, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import {
  replaceThemesByPlugin,
  removeThemesByPlugin,
} from '@/themes'
import { useTheme } from '@/composables/useTheme'

// 主应用内置组件 import map：'builtin:xxx' 从这里解析
import ConnectionSettings from '@/components/setting/ConnectionSettings.vue'
import ModelsProviderList from '@/components/setting/ModelsProviderList.vue'
import GeneralSettings from '@/components/setting/GeneralSettings.vue'

const BUILTIN = {
  connection: ConnectionSettings,
  models: ModelsProviderList,
  general: GeneralSettings,
}

const LoadingPlaceholder = { template: '<div class="p-4 text-sm text-gray-400">Loading plugin…</div>' }
const PluginErrorBoundary = {
  props: ['error'],
  template: '<div class="p-4 text-sm text-red-400">Plugin failed to load: {{ error }}</div>',
}

function resolveBuiltin(key) {
  const c = BUILTIN[key]
  if (!c) throw new Error(`pluginSlots: unknown builtin component "${key}"`)
  return markRaw(c)
}

function asyncPluginComponent(item) {
  return defineAsyncComponent({
    loader: () =>
      window.__GuaDaModuleLoader__.import(`${item.pluginId}:${item.component}`).then((mod) => mod.default),
    loadingComponent: LoadingPlaceholder,
    errorComponent: PluginErrorBoundary,
    delay: 0,
    timeout: 15000,
  })
}

/**
 * 插件 Slot 注册表（Pinia store）
 *
 * - init()：从后端拉取 slot 清单，外部插件 prepare 进加载器
 * - resolve(name)：返回某 slot 的已排序组件列表（内置组件 + 外部插件）
 * - watchRefresh()：SSE 监听插件启停，增量增删 slot 条目并卸载失效模块
 */
export const usePluginSlots = defineStore('pluginSlots', {
  state: () => ({
    slots: {},          // slot 名 → SlotItem[]（含 pluginId/component/order/props/meta/loadMode/rev）
    initialized: false,
    version: 0,
  }),

  getters: {
    resolve: (state) => (name) => {
      const items = (state.slots[name] || []).slice().sort((a, b) => a.order - b.order)
      return items.map((item) => ({
        ...item,
        component: item.component.startsWith('builtin:')
          ? resolveBuiltin(item.component.slice(8))
          : asyncPluginComponent(item),
      }))
    },

    metaOf: (state) => (name) =>
      (state.slots[name] || []).map((i) => i.meta).filter(Boolean),

    hasSlot: (state) => (name) => (state.slots[name] || []).length > 0,
  },

  actions: {
    async init() {
      if (this.initialized) return
      const data = await apiService.getPluginSlots()
      this.applySlots(data.slots || {}, data.themes || [])
      this.initialized = true
      this.watchRefresh()
    },

    applySlots(slots, themes = []) {
      for (const [slot, items] of Object.entries(slots)) {
        for (const item of items) {
          this.prepareExternal(item)
        }
        this.slots[slot] = items.map(markRaw)
      }
      this.syncThemes(themes)
      this.version++
    },

    /**
     * 同步插件主题注册表（后端清单为准，全量 diff）
     * - 清单内插件：replaceThemesByPlugin 全量替换（rev 变化自然更新 URL）
     * - 清单外插件（禁用/卸载）：removeThemesByPlugin，若当前生效主题被移除则回退 default
     */
    syncThemes(themes) {
      if (!this._registeredThemePlugins) this._registeredThemePlugins = new Set()
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
            },
            cssUrl: this.themeCssUrl(t),
          }))
        replaceThemesByPlugin(pluginId, list)
      }

      const removed = [...this._registeredThemePlugins].filter((p) => !next.has(p))
      for (const pluginId of removed) {
        const removedIds = removeThemesByPlugin(pluginId)
        if (removedIds.length) this.fallbackIfActiveThemeRemoved(removedIds)
      }
      this._registeredThemePlugins = next
    },

    /** 拼插件主题 CSS 完整 URL（与 prepareExternal 同一 base 规则） */
    themeCssUrl(theme) {
      const base = String(apiService.baseURL || '/api/v1').replace(/\/$/, '')
      return `${base}/plugins/${theme.pluginId}/assets/${theme.cssFile}?rev=${theme.rev || ''}`
    },

    /** 当前生效主题被插件移除时回退 default */
    fallbackIfActiveThemeRemoved(removedIds) {
      const { activeThemePreset, setActiveThemePreset } = useTheme()
      if (removedIds.includes(activeThemePreset.value)) {
        setActiveThemePreset('default')
        ElMessage.warning('当前主题已被插件移除，已回退到默认主题')
      }
    },

    prepareExternal(item) {
      if (!item.component || item.component.startsWith('builtin:')) return
      // apiService.baseURL：web dev = "/api/v1"，Electron = "http://localhost:PORT/api/v1"
      const base = String(apiService.baseURL || '/api/v1').replace(/\/$/, '')
      window.__GuaDaModuleLoader__.prepare({
        id: `${item.pluginId}:${item.component}`,
        url: `${base}/plugins/${item.pluginId}/assets/${item.component}.js?rev=${item.rev || ''}`,
        cssUrl: `${base}/plugins/${item.pluginId}/assets/${item.component}.css?rev=${item.rev || ''}`,
      })
    },

    // 从所有 slot 移除某插件的条目（插件禁用时）
    removePlugin(pluginId) {
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
      if (this._registeredThemePlugins) this._registeredThemePlugins.delete(pluginId)
      this.version++
    },

    // 复用全局 Session SSE（MainLayout 里 apiService.connectSessionEvents() 建立），
    // 插件注册/卸载/启停时后端广播 plugins_changed，这里全量刷新（简单可靠）
    watchRefresh() {
      try {
        this._unsub = apiService.onSessionEvent('plugins_changed', async () => {
          try {
            const data = await apiService.getPluginSlots()
            this.slots = {}
            this.applySlots(data.slots || {}, data.themes || [])
          } catch (e) {
            console.error('[pluginSlots] refresh failed', e)
          }
        })
      } catch (e) {
        console.warn('[pluginSlots] SSE 订阅不可用（无全局连接时降级为仅首屏加载）', e)
      }
    },

    registerLocal(name, item) {
      const entry = { pluginId: '__local__', order: 100, mode: 'list', ...item }
      if (!this.slots[name]) this.slots[name] = []
      this.slots[name].push(markRaw(entry))
      this.version++
    },

    invalidate(name) {
      delete this.slots[name]
    },
  },
})
