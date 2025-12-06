import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
// 引入 Font Awesome
import '@fortawesome/fontawesome-free/css/all.min.css'
// import ModalContainer from './components/ModalContainer.vue'
import { createRouter, createWebHistory } from 'vue-router'

import { createPinia } from 'pinia'
import { useAuthStore } from './stores/auth'
// import { Children } from 'react'
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
            },
            {
                path: '/characters',
                name: 'Characters',
                meta: { requiresLayout: true, title: '角色', requiresAuth: true },
                component: () => import('./components/CharactersPage.vue')
            },
            {
                path: '/models',
                name: 'Models',
                meta: { requiresLayout: true, title: '模型', requiresAuth: true },
                component: () => import('./components/ModelsPage.vue')
            }, {
                path: '/user/profile',
                name: 'My',
                meta: { requiresLayout: true, title: '用户', requiresAuth: true },
                component: () => import('./components/user/UserPage.vue')
            },
        ]
    },
    {
        path: '/login',
        name: 'Login',
        meta: { title: '登录' },
        component: () => import('./components/LoginPage.vue')
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach(async (to, from, next) => {
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
const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')
