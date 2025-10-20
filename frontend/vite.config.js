import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 代理 API 请求
      '/v1': {
        target: 'http://localhost:5000', // 后端地址
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 代理静态资源请求
      '/static': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
})
