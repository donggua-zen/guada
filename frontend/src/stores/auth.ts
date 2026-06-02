// stores/auth.ts
import { defineStore } from 'pinia'
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { apiService } from '@/services/ApiService'
import type { User, LoginRequest } from '@/types/api'

/**
 * 认证状态 Store
 */
export const useAuthStore = defineStore('auth', () => {
    // Token 存储：优先从 localStorage 读取（记住我），否则使用 sessionStorage
    const getStoredToken = (): string | null => {
        return localStorage.getItem('token') || sessionStorage.getItem('token')
    }

    const getStoredUser = (): User | null => {
        const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user')
        if (storedUser) {
            try {
                return JSON.parse(storedUser)
            } catch {
                return null
            }
        }
        return null
    }

    // 状态：store 创建时立即从 storage 恢复，确保刷新后数据不丢失
    const user: Ref<User | null> = ref(getStoredUser())
    const token: Ref<string | null> = ref(getStoredToken())

    // 免登录状态
    const autoLoginEnabled: Ref<boolean> = ref(false)

    // 计算属性
    const isAuthenticated: ComputedRef<boolean> = computed(() => !!token.value)

    // 定时验证定时器引用
    let refreshTimer: number | null = null
    const REFRESH_INTERVAL = 30 * 60 * 1000 // 30分钟

    // Actions
    async function login(credentials: LoginRequest & { rememberMe?: boolean }): Promise<boolean> {
        try {
            const result = await apiService.login(credentials)
            console.log('登录响应:', result)

            // 处理可能的响应格式
            const accessToken = (result as any).accessToken || (result as any).data?.accessToken
            const userData = (result as any).user || (result as any).data?.user

            if (!accessToken) {
                throw new Error('登录失败：未获取到 token')
            }

            // 根据 rememberMe 决定存储位置，并清除另一位置的旧数据避免残留
            const shouldRemember = credentials.rememberMe === true
            if (shouldRemember) {
                localStorage.setItem('token', accessToken)
                localStorage.setItem('user', JSON.stringify(userData))
                sessionStorage.removeItem('token')
                sessionStorage.removeItem('user')
            } else {
                sessionStorage.setItem('token', accessToken)
                sessionStorage.setItem('user', JSON.stringify(userData))
                localStorage.removeItem('token')
                localStorage.removeItem('user')
            }

            token.value = accessToken
            user.value = userData

            // 启动定时验证
            startAuthRefreshTimer()

            return true
        } catch (error: any) {
            console.error("登录失败:", error)
            // 直接抛出原始错误，保留 statusCode 等信息
            throw error
        }
    }

    function logout(): void {
        // 清除所有存储中的认证信息
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        sessionStorage.removeItem('token')
        sessionStorage.removeItem('user')

        token.value = null
        user.value = null

        // 停止定时验证
        stopAuthRefreshTimer()
    }

    /**
     * 页面刷新时初始化认证状态
     * 优先从 storage 恢复 token，然后异步验证 token 有效性并刷新用户信息
     */
    async function initializeAuth(): Promise<boolean> {
        const storedToken = getStoredToken()
        if (!storedToken) {
            return false
        }

        // 先恢复 token，让 isAuthenticated 立即为 true，避免路由守卫拦截
        token.value = storedToken

        // 尝试从 storage 恢复用户信息（作为临时展示，后续会被验证结果覆盖）
        const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user')
        if (storedUser) {
            try {
                user.value = JSON.parse(storedUser)
            } catch {
                user.value = null
            }
        }

        // 同步验证 token 并刷新用户信息
        const isValid = await checkAuth()
        if (isValid) {
            startAuthRefreshTimer()
        }
        return isValid
    }

    async function checkAuth(): Promise<boolean> {
        const storedToken = getStoredToken()
        if (!storedToken) return false

        try {
            const userData = await apiService.getProfile()
            user.value = userData
            token.value = storedToken

            // 同步用户信息到存储，保持与 token 相同的位置
            const tokenInLocalStorage = !!localStorage.getItem('token')
            if (tokenInLocalStorage) {
                localStorage.setItem('user', JSON.stringify(userData))
            } else {
                sessionStorage.setItem('user', JSON.stringify(userData))
            }

            return true
        } catch (error: any) {
            console.error('认证检查失败:', error)

            // 如果是连接错误，不要清除token，保留登录状态
            if (error.message?.includes('无法连接到后端服务') ||
                error.message?.includes('API服务初始化中')) {
                console.warn('后端服务未就绪，保留登录状态')
                // 保留token和用户信息，等待后端就绪
                return true
            }

            // 兼容 ApiService 拦截器转换后的 401 错误
            if (error.response?.status === 401 ||
                error.statusCode === 401 ||
                error.isAuthError === true ||
                error.message?.includes('Invalid token') ||
                error.message?.includes('Authentication required')) {
                logout()
                return false
            }

            // 其他错误也保留登录状态
            return true
        }
    }

    /**
     * 启动定时验证定时器，每30分钟验证一次token有效性
     */
    function startAuthRefreshTimer(): void {
        stopAuthRefreshTimer()
        refreshTimer = window.setInterval(() => {
            console.log('[AuthStore] 执行定时认证验证')
            checkAuth().then((isValid) => {
                if (!isValid) {
                    console.warn('[AuthStore] 定时验证失败，用户已登出')
                }
            })
        }, REFRESH_INTERVAL)
    }

    /**
     * 停止定时验证定时器
     */
    function stopAuthRefreshTimer(): void {
        if (refreshTimer !== null) {
            window.clearInterval(refreshTimer)
            refreshTimer = null
        }
    }

    async function checkAutoLoginStatus(): Promise<boolean> {
        try {
            // 使用新的分组设置接口
            const result = await apiService.fetchGroupSettings('system')
            autoLoginEnabled.value = result.autoLoginEnabled || false
            return autoLoginEnabled.value
        } catch (error) {
            console.error("获取免登录状态失败:", error)
            return false
        }
    }

    async function setAutoLoginEnabled(enabled: boolean): Promise<void> {
        try {
            // 使用新的分组设置接口
            await apiService.updateGroupSettings('system', { autoLoginEnabled: enabled })
            autoLoginEnabled.value = enabled
        } catch (error) {
            console.error("设置免登录状态失败:", error)
            throw error
        }
    }

    async function tryAutoLogin(): Promise<boolean> {
        try {
            const result = await apiService.autoLogin()

            if (!result || !result.accessToken) {
                console.warn('自动登录失败：未获取到 token')
                return false
            }

            // 自动登录使用 sessionStorage，不记住
            sessionStorage.setItem('token', result.accessToken)
            sessionStorage.setItem('user', JSON.stringify(result.user))

            token.value = result.accessToken
            user.value = result.user

            // 启动定时验证
            startAuthRefreshTimer()

            console.log('自动登录成功')
            return true
        } catch (error) {
            console.error("自动登录失败:", error)
            return false
        }
    }

    return {
        // 状态
        user,
        token,
        autoLoginEnabled,
        isAuthenticated,
        // Actions
        login,
        logout,
        initializeAuth,
        checkAuth,
        checkAutoLoginStatus,
        setAutoLoginEnabled,
        tryAutoLogin
    }
})
