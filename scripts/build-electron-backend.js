/**
 * 跨平台后端构建入口（替代 package.json 中固定的 win-linux 平台参数）
 *
 * 按当前构建平台自动设置 SHARP_TARGET_PLATFORMS / TARGET_PLATFORMS，
 * 依次执行：
 *   1. backend 编译（nest build）
 *   2. 依赖优化（按目标平台裁剪 sharp / sqlite-vec / jieba / watcher 等原生模块）
 *   3. Electron 原生模块重建（@electron/rebuild）
 *
 * 交叉构建示例（在 Apple Silicon 上构建 x64 包）：
 *   TARGET_ARCH=x64 pnpm run build:electron:backend
 */

const { execSync } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const platform =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'

const env = {
  ...process.env,
  SHARP_TARGET_PLATFORMS: platform,
  TARGET_PLATFORMS: platform,
}

console.log(`[build:electron:backend] Target platform: ${platform}`)
console.log(`[build:electron:backend] Target arch: ${env.TARGET_ARCH || process.arch}`)

const steps = [
  ['build backend', 'pnpm run build:backend'],
  ['optimize electron deps', 'node scripts/optimize-electron-deps.js'],
  ['rebuild native modules', 'node scripts/rebuild-native-electron.js'],
]

for (const [label, cmd] of steps) {
  console.log()
  console.log(`===== ${label} =====`)
  execSync(cmd, { cwd: root, stdio: 'inherit', env })
}

console.log()
console.log('===== build:electron:backend complete =====')
