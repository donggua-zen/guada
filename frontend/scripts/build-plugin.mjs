/**
 * 构建 demo 插件前端产物
 *
 * 在主应用 frontend 目录运行（利用主应用已安装的 vite/vue 插件）：
 *   node scripts/build-plugin.mjs
 *
 * 说明：正式插件在自己的目录里放 package.json + node_modules 即可独立构建；
 * demo 借主应用依赖，避免在插件目录重复安装。
 */
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = 'D:/AI/ai_chat/plugins/demo-settings/frontend';

try {
  await build({
    root: pluginDir,
    plugins: [vue()],
    logLevel: 'info',
    build: {
      outDir: path.join(pluginDir, 'dist'),
      emptyOutDir: false,
      lib: {
        entry: path.join(pluginDir, 'src/index.js'),
        formats: ['iife'],
        name: 'GuaDaPlugin',
        fileName: () => 'MyPanel.js',
      },
      rollupOptions: {
        external: ['vue'],
        output: {
          globals: { vue: 'window.__GuaDaShared__.vue' },
          assetFileNames: 'MyPanel.css',
        },
      },
    },
  });
  console.log('✓ demo-settings 插件前端构建完成');
} catch (e) {
  console.error('✗ 构建失败:', e.message || e);
  process.exitCode = 1;
}
