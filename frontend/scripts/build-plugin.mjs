/**
 * 构建插件前端产物（通用：--plugin=<插件目录>）
 *
 * 用法（在主应用 frontend 目录）：
 *   node scripts/build-plugin.mjs          # 构建 demo-settings（默认示例）
 *   node scripts/build-plugin.mjs --plugin=D:/AI/.../plugin-dir
 *
 * 说明：借主应用已安装的 vite/vue 插件构建；正式插件可自带依赖独立构建。
 */
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = argv.find((a) => a.startsWith('--plugin='));
// 默认 demo-settings（若存在）
let pluginDir = flag ? flag.slice('--plugin='.length) : 'D:/AI/ai_chat/plugins/demo-settings/frontend';

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
  console.log(`✓ 插件前端构建完成: ${pluginDir}`);
} catch (e) {
  console.error('✗ 构建失败:', e.message || e);
  process.exitCode = 1;
}
