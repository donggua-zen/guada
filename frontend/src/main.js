import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
// 引入 Font Awesome
import '@fortawesome/fontawesome-free/css/all.min.css'
// import ModalContainer from './components/ModalContainer.vue'
import { createRouter, createWebHistory } from 'vue-router'


// import { Children } from 'react'
const routes = [
    {
        path: '/',
        name: 'Home',
        component: () => import('./components/MainLayout.vue'),
        children: [
            {
                path: '', meta: { requiresLayout: true },
                redirect: '/chat'
            },
            {
                path: '/chat/:sessionId?',
                name: 'Chat',
                meta: { requiresLayout: true },
                component: () => import('./components/ChatPage.vue')
            },
            {
                path: '/characters',
                name: 'Characters',
                meta: { requiresLayout: true },
                component: () => import('./components/CharactersPage.vue')
            },

        ]
    },
    {
        path: '/character/:characterId?',
        name: 'Character',
        meta: { requiresLayout: true },
        component: () => import('./components/CharacterPage.vue')
    },
    // {
    //     path: '/settings',
    //     name: 'Settings',
    //     component: () => import('./components/SettingsPage.vue')
    // },
    // 动态路由示例
    //   {
    //     path: '/user/:id',
    //     name: 'User',
    //     component: () => import('../views/UserView.vue'),
    //     props: true // 将路由参数作为props传递给组件
    //   },
    //   {
    //     path: '/product/:category/:id',
    //     name: 'Product',
    //     component: () => import('../views/ProductView.vue')
    //   },
    //   // 可选参数路由
    //   {
    //     path: '/settings/:tab?',
    //     name: 'Settings',
    //     component: () => import('../views/SettingsView.vue')
    //   },
    //   // 通配符路由（404页面）
    //   {
    //     path: '/:pathMatch(.*)*',
    //     name: 'NotFound',
    //     component: () => import('../views/NotFoundView.vue')
    //   }
]
import SimpleBar from 'simplebar-vue'
import 'simplebar-vue/dist/simplebar.min.css'
const route = createRouter({
    history: createWebHistory(),
    routes
});

const app = createApp(App)
app.use(route)
app.component('SimpleBar', SimpleBar)
app.mount('#app')
