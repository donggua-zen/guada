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