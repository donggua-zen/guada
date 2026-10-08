import { ref, watch } from 'vue'
import { setLocale, getLocale, STORAGE_KEY, type AppLocale } from '@/locales'
import { apiService } from '@/services/ApiService'

/**
 * 语言管理 Composable（单例模式，同 useTheme）
 *
 * 持久化策略：localStorage 即时生效 + 后端 appearance 设置同步
 *
 * 启动期不自己发请求：语言随 appearance 分组一起下发，由 layout store 的
 * loadAppearanceSettings() 拿到响应后调 applyLanguageFromAppearance() 应用
 * （该分组因此只有一个消费点，见 stores/layout.ts）。
 */

const locale = ref<AppLocale>(getLocale())

// 初始化 lang 属性（node 测试环境无 document）
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', locale.value)
}

/** 是否为受支持的语言 */
function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US'
}

/**
 * 语言解析规则：localStorage 优先，后端为 fallback。
 *
 * 返回 null = 两边都没有可用值，调用方保持现状；
 * persist = true 表示这个值来自后端、需要落盘 localStorage。
 */
export function resolveLanguage(
  saved: string | null,
  backendValue: unknown,
): { locale: AppLocale; persist: boolean } | null {
  if (isAppLocale(saved)) return { locale: saved, persist: false }
  if (isAppLocale(backendValue)) return { locale: backendValue, persist: true }
  return null
}

// 监听语言变化，同步到后端
let backendSyncTimer: ReturnType<typeof setTimeout> | null = null
watch(locale, (val) => {
  setLocale(val)
  // 防抖同步到后端（避免快速切换时频繁请求）
  if (backendSyncTimer) clearTimeout(backendSyncTimer)
  backendSyncTimer = setTimeout(() => {
    apiService.updateGroupSettings('appearance', { language: val }).catch(() => {
      // 后端同步失败不影响前端使用
    })
  }, 500)
})

/**
 * 用 appearance 分组里的 language 初始化语言（由 layout store 在拿到响应后调用）。
 *
 * localStorage 已有合法值时以它为准，此时不产生任何请求；只有 localStorage 缺失、
 * 由后端补上时才写回 localStorage（经 setLocale）。值来自后端时同样会经上面那次
 * 500ms 防抖回写一次后端——幂等，与旧实现一致。
 */
export function applyLanguageFromAppearance(backendValue: unknown): void {
  // 防御：node 测试环境可能只有 localStorage 桩对象（同 locales/index.ts 的判据）
  const saved =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
      ? localStorage.getItem(STORAGE_KEY)
      : null
  const resolved = resolveLanguage(saved, backendValue)
  if (!resolved) return

  if (resolved.locale === locale.value) {
    // 值没变不会触发 watch，落盘需要显式补一次
    if (resolved.persist) setLocale(resolved.locale)
    return
  }
  locale.value = resolved.locale
}

export interface UseLanguageReturn {
  locale: typeof locale
  setLanguage: (lang: AppLocale) => void
}

export function useLanguage(): UseLanguageReturn {
  function setLanguage(lang: AppLocale): void {
    locale.value = lang
  }

  return { locale, setLanguage }
}
