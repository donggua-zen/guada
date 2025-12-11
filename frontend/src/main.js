import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

import { createPinia } from 'pinia'
import { useAuthStore } from './stores/auth'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

// 配置NProgress
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
                path: '', meta: { requiresLayout: true, requiresAuth: true },
                name: 'Home',
                redirect: '/chat',
            },
            {
                path: '/chat/:sessionId?',
                name: 'Chat',
                meta: { requiresLayout: true, title: '对话', requiresAuth: true },
                component: () => import('./components/ChatPage.vue')
            }
        ]
    },
    {
        path: '/login',
        name: 'Login',
        meta: { title: '登录' },
        component: () => import('./components/LoginPage.vue')
    }, {
        path: '/yest',
        name: 'Login',
        meta: { title: '登录' },
        component: () => import('./components/test/ui.vue')
    }
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
    // if (to.meta.requiresGuest && authStore.isAuthenticated) {
    //     return next('/chat')
    // }

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
