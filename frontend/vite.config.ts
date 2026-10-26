import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import clean from 'vite-plugin-clean'

import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import type { PluginOption } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Electron 环境使用相对路径，Web 环境使用根路径
  base: process.env.ELECTRON === 'true' ? './' : '/',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag === 'webview',
        },
      },
    }),
    tailwindcss(),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
      filename: 'stats.html'
    }) as PluginOption,
    clean({ cleanOnceBeforeBuildPatterns: ['**/*', '!some-important-file.txt'] }) as PluginOption,
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // 允许局域网真机访问（手机联调移动端适配）；不影响桌面 localhost 访问
    host: true,
    // 端口固定 5173：dev 下移动访问（局域网/公网隧道）直接指向该端口，
    // 端口漂移会让设置页展示的地址失效；被占用时直接报错而不是静默换端口
    strictPort: true,
    // 公网隧道/域名反代过来时 Host 不是 IP，放行以免被 Vite 的 host 校验拦截
    allowedHosts: true,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/static': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      // 后端上传资源（FileRef.url 相对存储路径展示用）
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  test: {
    // 纯逻辑/store 单测,node 环境即可;组件测试(如需要)再切 jsdom
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})