// stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService' // 根据实际路径调整
import { useStorage } from '@vueuse/core'

export const useAuthStore = defineStore('auth', () => {
    const user = ref(null)
    const token = useStorage('token', null)

    const isAuthenticated = computed(() => !!token.value)

    async function login(credentials) {
        try {
            const { access_token, user: userData } = await apiService.login(credentials)

            token.value = access_token
            user.value = userData

            return true
        } catch (error) {
            console.error("s", error)
            throw error.response?.data?.error || '登录失败'
        }
    }

    async function register(userData) {
        try {
            const { access_token, user: newUser } = await apiService.register(userData)

            token.value = access_token
            user.value = newUser

            return true
        } catch (error) {
            throw error.response?.data?.error || '注册失败'
        }
    }

    function logout() {
        token.value = null
        user.value = null
        // apiService.logout()
    }

    async function checkAuth() {
        if (!token.value) return false
        try {
            const userData = await apiService.getProfile()
            user.value = userData
            console.log(userData)
            return true
        } catch (error) {
            console.error(error)
            logout()
            return false
        }
    }

    return {
        user,
        token,
        isAuthenticated,
        login,
        register,
        logout,
        checkAuth
    }
})