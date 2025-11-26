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
        component: () => import('./components/MainLayout.vue'),
        children: [
            {
                path: '', meta: { requiresLayout: true },
                name: 'Home',
                redirect: '/chat',
            },
            {
                path: '/chat/:sessionId?',
                name: 'Chat',
                meta: { requiresLayout: true, title: '对话' },
                component: () => import('./components/ChatPage.vue')
            },
            {
                path: '/characters',
                name: 'Characters',
                meta: { requiresLayout: true, title: '角色' },
                component: () => import('./components/CharactersPage.vue')
            },
            {
                path: '/models',
                name: 'Models',
                meta: { requiresLayout: true, title: '模型' },
                component: () => import('./components/ModelsPage.vue')
            },
        ]
    },
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
