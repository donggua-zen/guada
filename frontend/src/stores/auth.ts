// stores/auth.ts
import { defineStore } from 'pinia'
import { ref, computed, type Ref, type ComputedRef } from 'vue'
// @ts-ignore - ApiService 尚未迁移到 TypeScript
import { apiService } from '@/services/ApiService'
import { useStorage } from '@vueuse/core'
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
        } catch (error) {
            console.error(error)
            logout()
            return false
        }
    }

    return {
        // 状态
        user,
        token,
        isAuthenticated,
        // Actions
        login,
        register,
        logout,
        checkAuth
    }
})
