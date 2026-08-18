/**
 * 插件前端构建配置
 *
 * 用法（在主应用 frontend 目录执行）：
 *   node scripts/build-plugin.mjs
 * 或在插件 frontend 目录（需有 vite/vue 依赖）：
 *   vite build --config vite.plugin.config.js
 * → 产物 dist/MyPanel.js + dist/MyPanel.css
 *
 * 产物约定：
 *  - IIFE，vue 从 window.__GuaDaShared__.vue 取（单实例保证）
 *  - 执行时调用 window.__GuaDaModuleLoader__.register('pluginId:Name', { default: Component })
 *  - CSS 由 loader 自动注入 <link>
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/index.js',   // 每个 UI 组件一个入口
      formats: ['iife'],
      name: 'GuaDaPlugin',
      fileName: () => 'MyPanel.js',
    },
    rollupOptions: {
      external: ['vue'],                       // vue 不打进产物
      output: {
        globals: { vue: 'window.__GuaDaShared__.vue' },
        assetFileNames: 'MyPanel.css',
      },
    },
  },
});
