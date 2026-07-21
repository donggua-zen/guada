// composables/useTheme.ts
import { ref, computed, watch } from 'vue'

/**
 * 主题管理 Composable
 * 支持三态切换：浅色 / 深色 / 跟随系统
 */

export type ThemeMode = 'light' | 'dark' | 'system'

// 模块级响应式状态（单例）
const themeMode = ref<ThemeMode>('system')
const systemPrefersDark = ref<boolean>(
    window.matchMedia('(prefers-color-scheme: dark)').matches
)

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemPrefersDark.value = e.matches
})

// 初始化：优先读取 theme-mode，兼容旧 key color-scheme
const savedMode = localStorage.getItem('theme-mode') as ThemeMode | null
if (savedMode) {
    themeMode.value = savedMode
} else {
    const legacy = localStorage.getItem('color-scheme')
    if (legacy === 'dark' || legacy === 'light') {
        themeMode.value = legacy
    }
}

// isDark 作为计算属性，跟随 themeMode 和系统偏好
const isDark = computed<boolean>(() => {
    if (themeMode.value === 'system') return systemPrefersDark.value
    return themeMode.value === 'dark'
})

// 设置主题模式
const setTheme = (mode: ThemeMode): void => {
    themeMode.value = mode
}

// 切换主题（向后兼容：在亮/暗之间切换）
const toggleDark = (): void => {
    themeMode.value = isDark.value ? 'light' : 'dark'
}

// 监听 isDark 变化，同步到 DOM
watch(isDark, (newVal: boolean) => {
    if (newVal) {
        document.documentElement.classList.add('dark')
    } else {
        document.documentElement.classList.remove('dark')
    }
})

// 监听 themeMode 变化，持久化到 localStorage
watch(themeMode, (newVal: ThemeMode) => {
    localStorage.setItem('theme-mode', newVal)
    // 迁移完成后清理旧 key
    localStorage.removeItem('color-scheme')
})

// 初始应用 DOM 状态
document.documentElement.classList.toggle('dark', isDark.value)

/**
 * 主题 Composable 返回值类型
 */
export interface UseThemeReturn {
    isDark: typeof isDark
    themeMode: typeof themeMode
    toggleDark: typeof toggleDark
    setTheme: typeof setTheme
}

export function useTheme(): UseThemeReturn {
    return {
        isDark,
        themeMode,
        toggleDark,
        setTheme
    }
}
