import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import clean from 'vite-plugin-clean'
import Inspect from 'vite-plugin-inspect'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import type { PluginOption } from 'vite'

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
    }) as PluginOption,
    clean({ cleanOnceBeforeBuildPatterns: ['**/*', '!some-important-file.txt'] }) as PluginOption,
    Inspect() as PluginOption,  // 查看模块转换过程
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/auto-imports.d.ts',  // 生成类型声明
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/types/components.d.ts',  // 生成组件类型声明
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
        target: 'http://localhost:8800', // 后端地址（run.py 启动的端口）
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 代理静态资源请求
      '/static': {
        target: 'http://localhost:8800',
        changeOrigin: true
      }
    }
  }
})
