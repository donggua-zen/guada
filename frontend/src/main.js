import { createApp } from 'vue'

import App from './App.vue'
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useAuthStore } from './stores/auth'
import NProgress from 'nprogress'

import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './tailwind.css'
import './style.css'
import 'nprogress/nprogress.css'

// 配置 NProgress
// 检测是否为 Electron 环境
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

NProgress.configure({
    easing: 'ease-in-out',
    speed: 1000,
    showSpinner: false,
    trickle: true,
    trickleSpeed: 200,
    minimum: 0.08,
    // 在 Electron 环境下完全禁用进度条
    disabled: isElectron
})

import { apiService } from '@/services/ApiService'

// 在 Electron 环境下初始化后端地址
if (isElectron) {
  await apiService.initBackendUrl().catch(err => console.error('Failed to init backend URL:', err))
}

const routes = [
    {
        path: '/',
        component: () => import('./components/MainLayout.vue'),
        children: [
            {
                path: '',
                name: 'Home',
                redirect: '/chat',
            },
            {
                path: 'chat/:sessionId?',
                name: 'Chat',
                meta: { title: '对话', requiresAuth: true },
                component: () => import('./components/ChatPage.vue')
            },
            {
                path: 'characters',
                name: 'Characters',
                meta: { title: '助手', requiresAuth: true },
                component: () => import('./components/CharactersPage.vue')
            },
            {
                path: 'account/:tab?',
                name: 'AccountCenter',
                meta: { title: '账户中心', requiresAuth: true },
                component: () => import('./components/account/AccountCenter.vue')
            },
            {
                path: 'setting/:tab?',
                name: 'SystemSettings',
                meta: { title: '系统设置', requiresAuth: true },
                component: () => import('./components/setting/SystemSettings.vue')
            },
            {
                path: 'plugins/:tab?',
                name: 'Plugins',
                meta: { title: '插件', requiresAuth: true },
                component: () => import('./components/plugins/PluginsPage.vue')
            },
            {
                path: 'knowledge-base/:id?',
                name: 'KnowledgeBase',
                meta: { title: '知识库', requiresAuth: true },
                component: () => import('./components/KnowledgeBase/KnowledgeBasePage.vue')
            }
        ]
    },
    {
        path: '/login',
        name: 'Login',
        meta: { title: '登录' },
        component: () => import('./components/LoginPage.vue')
    },
    {
        path: '/password',
        name: 'Password',
        meta: { title: '密码设置' },
        component: () => import('./components/PasswordPage.vue')
    },
    {
        path: '/test',
        name: 'Test',
        meta: { title: 'UI 测试' },
        component: () => import('./components/test/ui.vue')
    },
]

// 根据环境动态选择路由模式
// Electron 环境使用 Hash 模式（file:// 协议不支持 History 模式）
// Web 环境使用 History 模式（URL 更美观）
const router = createRouter({
    history: isElectron ? createWebHashHistory() : createWebHistory(),
    routes

});

router.beforeEach(async (to, from, next) => {
    // 仅在非 Electron 环境下显示进度条
    if (!isElectron) {
        NProgress.start()
    }

    console.log('Navigating to:', to.path)

    const authStore = useAuthStore()

    // 3. 正常的鉴权逻辑
    if (to.meta.requiresAuth) {
        // 先尝试自动登录（如果开启了免登录模式）
        if (!authStore.isAuthenticated) {
            await authStore.checkAutoLoginStatus()
            if (authStore.autoLoginEnabled) {
                const success = await authStore.tryAutoLogin()
                if (success) {
                    return next()
                }
            }
        }

        // 检查是否有存储的token（记住我功能）
        const hasStoredToken = localStorage.getItem('token') || sessionStorage.getItem('token')
        if (hasStoredToken && !authStore.isAuthenticated) {
            // 有token但store中未设置，尝试恢复
            const storedToken = localStorage.getItem('token') || sessionStorage.getItem('token')
            const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user')
            
            if (storedToken && storedUser) {
                authStore.token = storedToken
                authStore.user = JSON.parse(storedUser)
                console.log('从存储中恢复登录状态')
                return next()
            }
        }

        const isAuthenticated = await authStore.checkAuth()
        if (!isAuthenticated) {
            return next('/login')
        }
    }

    next()
})

// 全局后置守卫
router.afterEach(() => {
    // 仅在非 Electron 环境下结束进度条
    if (!isElectron) {
        NProgress.done()
    }
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

