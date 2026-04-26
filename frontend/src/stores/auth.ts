// stores/auth.ts
import { defineStore } from 'pinia'
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { apiService } from '@/services/ApiService'
import type { User, LoginRequest, RegisterRequest } from '@/types/api'

/**
 * 认证状态 Store
 */
export const useAuthStore = defineStore('auth', () => {
    // 状态
    const user: Ref<User | null> = ref(null)
    
    // Token 存储：优先从 localStorage 读取（记住我），否则使用 sessionStorage
    const getStoredToken = (): string | null => {
        return localStorage.getItem('token') || sessionStorage.getItem('token')
    }
    
    const token: Ref<string | null> = ref(getStoredToken())

    // 免登录状态
    const autoLoginEnabled: Ref<boolean> = ref(false)

    // 计算属性
    const isAuthenticated: ComputedRef<boolean> = computed(() => !!token.value)

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

            // 根据 rememberMe 决定存储位置
            const shouldRemember = credentials.rememberMe === true
            if (shouldRemember) {
                localStorage.setItem('token', accessToken)
                localStorage.setItem('user', JSON.stringify(userData))
            } else {
                sessionStorage.setItem('token', accessToken)
                sessionStorage.setItem('user', JSON.stringify(userData))
            }

            token.value = accessToken
            user.value = userData

            return true
        } catch (error: any) {
            console.error("登录失败:", error)
            throw new Error(error.message || '登录失败')
        }
    }

    async function register(userData: RegisterRequest): Promise<boolean> {
        try {
            const result = await apiService.register(userData)
            console.log('注册响应:', result)
            
            // 处理可能的响应格式
            const accessToken = (result as any).accessToken || (result as any).data?.accessToken
            const newUser = (result as any).user || (result as any).data?.user
            
            if (!accessToken) {
                throw new Error('注册失败：未获取到 token')
            }

            // 注册后默认不记住，使用 sessionStorage
            sessionStorage.setItem('token', accessToken)
            sessionStorage.setItem('user', JSON.stringify(newUser))

            token.value = accessToken
            user.value = newUser

            return true
        } catch (error: any) {
            console.error("注册失败:", error)
            throw new Error(error.message || '注册失败')
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
    }

    async function checkAuth(): Promise<boolean> {
        const storedToken = getStoredToken()
        if (!storedToken) return false
        
        try {
            const userData = await apiService.getProfile()
            user.value = userData
            token.value = storedToken
            
            // 同步用户信息到存储
            const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user')
            if (storedUser) {
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
            
            // 只有真正的认证失败才清除登录状态
            if (error.response?.status === 401 || error.message?.includes('Invalid token')) {
                logout()
                return false
            }
            
            // 其他错误也保留登录状态
            return true
        }
    }

    async function checkAutoLoginStatus(): Promise<boolean> {
        try {
            const result = await apiService.getAutoLoginStatus()
            autoLoginEnabled.value = result.enabled
            return result.enabled
        } catch (error) {
            console.error("获取免登录状态失败:", error)
            return false
        }
    }

    async function setAutoLoginEnabled(enabled: boolean): Promise<void> {
        try {
            await apiService.setAutoLoginStatus(enabled)
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
        register,
        logout,
        checkAuth,
        checkAutoLoginStatus,
        setAutoLoginEnabled,
        tryAutoLogin
    }
})
