import { createApp } from 'vue'

import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'
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
        path: '/setup',
        name: 'SetupWizard',
        meta: { title: '首次运行设置' },
        component: () => import('./components/SetupWizard.vue')
    },
    {
        path: '/test',
        name: 'Test',
        meta: { title: 'UI 测试' },
        component: () => import('./components/test/ui.vue')
    },
]

const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach(async (to, from, next) => {
    // 仅在非 Electron 环境下显示进度条
    if (!isElectron) {
        NProgress.start()
    }
    
    const authStore = useAuthStore()

    // 1. 检查本地是否已完成过设置向导
    const hasCompletedSetup = localStorage.getItem('hasCompletedSetup') === 'true'

    // 2. 如果未完成且不在向导页，则需要进一步检查
    if (!hasCompletedSetup && to.path !== '/setup') {
        // 先确保已登录（自动登录逻辑在 AuthGuard 处理）
        const isAuthenticated = await authStore.checkAuth()
        
        if (isAuthenticated) {
            // 检查是否有模型供应商
            try {
                const providers = await apiService.fetchModels()
                // 如果供应商列表为空，强制进入向导
                if (!providers.items || providers.items.length === 0) {
                    return next('/setup')
                }
                // 如果有供应商但没标记完成，标记为完成并继续
                localStorage.setItem('hasCompletedSetup', 'true')
            } catch (e) {
                // 获取失败也先进入向导以防万一
                return next('/setup')
            }
        } else {
            // 未登录且未完成设置，进入向导（向导第一步会处理注册/登录）
            return next('/setup')
        }
    }

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

