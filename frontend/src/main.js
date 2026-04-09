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
NProgress.configure({
    easing: 'ease-in-out',
    speed: 1000,
    showSpinner: false,
    trickle: true,
    trickleSpeed: 200,
    minimum: 0.08
})

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
                path: 'knowledge-base/:id?',
                name: 'KnowledgeBase',
                meta: { title: '知识库', requiresAuth: true },
                component: () => import('./components/KnowledgeBasePage.vue')
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

const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach(async (to, from, next) => {
    NProgress.start()  // 开始进度条
    const authStore = useAuthStore()

    // 检查认证状态
    if (to.meta.requiresAuth) {
        const isAuthenticated = await authStore.checkAuth()
        if (!isAuthenticated) {
            return next('/login')
        }
    }

    next()
})

// 全局后置守卫
router.afterEach(() => {
    NProgress.done()  // 结束进度条
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

