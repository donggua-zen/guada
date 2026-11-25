import { createApp } from 'vue'
import { i18n } from '@/locales'
import '@/style.css'
import '@/assets/markdown.css'
import Preview from './Preview.vue'

createApp(Preview).use(i18n).mount('#app')
