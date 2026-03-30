// composables/useTheme.ts
import { ref, watch } from 'vue'

/**
 * 主题管理 Composable
 * 控制深色/浅色模式切换
 */

// 模块级响应式状态（单例）
const isDark = ref<boolean>(false)

// 从 localStorage 读取用户偏好
const savedTheme = localStorage.getItem('color-scheme')
if (savedTheme === 'dark') {
    isDark.value = true
    document.documentElement.classList.add('dark')
} else if (savedTheme === 'light') {
    isDark.value = false
    document.documentElement.classList.remove('dark')
} else {
    // 默认跟随系统
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    isDark.value = prefersDark
    document.documentElement.classList.toggle('dark', prefersDark)
}

// 切换主题
const toggleDark = (): void => {
    isDark.value = !isDark.value
}

// 监听变化并同步到 DOM 和 localStorage
watch(isDark, (newVal: boolean) => {
    if (newVal) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('color-scheme', 'dark')
    } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('color-scheme', 'light')
    }
})

/**
 * 主题 Composable 返回值类型
 */
export interface UseThemeReturn {
    isDark: typeof isDark
    toggleDark: typeof toggleDark
}

export function useTheme(): UseThemeReturn {
    return {
        isDark,
        toggleDark
    }
}
