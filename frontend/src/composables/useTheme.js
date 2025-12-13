// composables/useTheme.js
import { ref, watch } from 'vue'

const isDark = ref(false)

// 从 localStorage 读取用户偏好
const savedTheme = localStorage.getItem('color-scheme')
if (savedTheme === 'dark') {
    isDark.value = true
    document.documentElement.classList.add('dark')
} else if (savedTheme === 'light') {
    isDark.value = false
    document.documentElement.classList.remove('dark')
} else {
    // 默认跟随系统（可选）
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    isDark.value = prefersDark
    document.documentElement.classList.toggle('dark', prefersDark)
}

// 切换主题
const toggleDark = () => {
    isDark.value = !isDark.value
}

// 监听变化并同步到 DOM 和 localStorage
watch(isDark, (newVal) => {
    if (newVal) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('color-scheme', 'dark')
    } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('color-scheme', 'light')
    }
})

export function useTheme() {
    return {
        isDark,
        toggleDark
    }
}