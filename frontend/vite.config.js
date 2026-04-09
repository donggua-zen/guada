import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer';
import clean from 'vite-plugin-clean'
import Inspect from 'vite-plugin-inspect'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    visualizer({
      open: false,           // 构建完成后自动打开报告
      gzipSize: true,       // 显示 gzip 压缩后的大小
      brotliSize: true,     // 显示 Brotli 压缩后的大小
      filename: 'stats.html' // 报告文件名
    }),
    clean({ cleanOnceBeforeBuildPatterns: ['**/*', '!some-important-file.txt'] }),
    Inspect(),  // 查看模块转换过程
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  // optimizeDeps: {
  //   force: false, // 不要强制预构建
  //   // 明确需要预构建的包
  //   include: [
  //     'vue',
  //     'vue-router',
  //     'pinia',
  //     'axios',
  //     'dayjs',
  //     'lodash-es',
  //     'naive-ui',
  //   ]
  // },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // 代理 API 请求
      '/api/v1': {
        target: 'http://localhost:3000', // 后端地址
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 代理静态资源请求
      '/static': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
