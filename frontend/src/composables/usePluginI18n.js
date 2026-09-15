import { computed } from 'vue'

/**
 * 插件 UI 国际化 composable
 *
 * 插件在产物入口注册语言包：
 *   window.__GuaDaShared__.i18n.register('my-plugin', { zh: {...}, en: {...} })
 *
 * 使用：
 *   const { t, locale } = usePluginI18n('my-plugin')
 *   {{ t('save') }}、{{ t('greet', { name: 'xx' }) }}
 *
 * 回退链：当前语言 → en → key
 * 语言切换：runtime.locale 是 reactive，computed 自动重渲染
 */
export function usePluginI18n(pluginId) {
  const runtime = window.__GuaDaShared__?.runtime

  return {
    t: (key, params) => {
      const i18n = window.__GuaDaShared__?.i18n
      if (!i18n) return key
      return i18n.t(pluginId, key, params)
    },
    locale: computed(() => runtime?.locale ?? 'zh-CN'),
  }
}

/**
 * 插件运行时上下文读取（用户信息等共享数据，响应式）
 *
 * 使用：
 *   const { user, session, locale } = usePluginRuntime()
 *   computed(() => user.value?.nickname)
 */
export function usePluginRuntime() {
  const runtime = window.__GuaDaShared__?.runtime ?? {}
  return {
    user: computed(() => runtime.user),
    session: computed(() => runtime.session),
    locale: computed(() => runtime.locale),
    theme: computed(() => runtime.theme),
  }
}
