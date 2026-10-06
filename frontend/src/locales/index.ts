import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'

export type AppLocale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'app-language'

function detectInitialLocale(): AppLocale {
  // 防御：node 测试环境无 localStorage（vitest node 环境模块加载即触发）
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
    return 'zh-CN'
  }
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'zh-CN' || saved === 'en-US') return saved
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
  missingWarn: false,
  fallbackWarn: false,
})

export { i18n, STORAGE_KEY }

/**
 * 在非组件上下文中使用翻译（stores / composables / utils）
 */
export function t(key: string, named?: Record<string, unknown>): string {
  return named === undefined ? i18n.global.t(key) : i18n.global.t(key, named)
}

/**
 * 切换语言
 */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale)
  }
}

/**
 * 获取当前语言
 */
export function getLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}
