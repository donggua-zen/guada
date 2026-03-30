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
    const token: Ref<string | null> = useStorage('token', null)

    // 计算属性
    const isAuthenticated: ComputedRef<boolean> = computed(() => !!token.value)

    // Actions
    async function login(credentials: LoginRequest): Promise<boolean> {
        try {
            const result = await apiService.login(credentials)
            console.log('登录响应:', result)
            
            // 处理可能的响应格式
            const access_token = (result as any).access_token || (result as any).data?.access_token
            const userData = (result as any).user || (result as any).data?.user
            
            if (!access_token) {
                throw new Error('登录失败：未获取到 token')
            }

            token.value = access_token
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
            const access_token = (result as any).access_token || (result as any).data?.access_token
            const newUser = (result as any).user || (result as any).data?.user
            
            if (!access_token) {
                throw new Error('注册失败：未获取到 token')
            }

            token.value = access_token
            user.value = newUser

            return true
        } catch (error: any) {
            console.error("注册失败:", error)
            throw new Error(error.message || '注册失败')
        }
    }

    function logout(): void {
        token.value = null
        user.value = null
        // apiService.logout()
    }

    async function checkAuth(): Promise<boolean> {
        if (!token.value) return false
        try {
            const userData = await apiService.getProfile()
            user.value = userData
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
