/**
 * 为 Electron 环境重建 backend-ts 的原生模块（跨平台：Windows / macOS / Linux）
 *
 * - better-sqlite3 需要针对 Electron ABI 重新编译（使用 @electron/rebuild）
 * - sqlite-vec / @node-rs/jieba 为预编译二进制，仅校验目标平台产物是否存在
 * - 目标目录：backend-ts/node_modules_production
 * - 平台/架构/Electron 版本任一变化都会强制重建（marker 文件包含三者信息）
 *
 * 环境变量：
 *   TARGET_ARCH     覆盖目标架构（默认 process.arch，交叉构建时使用）
 *   ELECTRON_VERSION 覆盖 Electron 版本（默认读取已安装的 electron）
 */

const path = require('path')
const fs = require('fs')

const backendPath = path.join(__dirname, '..', 'backend-ts')
const productionNodeModulesPath = path.join(backendPath, 'node_modules_production')
const productionModulesPath = path.join(productionNodeModulesPath, 'node_modules')

// ── 参数解析 ──
const ELECTRON_VERSION =
  process.env.ELECTRON_VERSION ||
  (() => {
    try {
      return require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version
    } catch (e) {
      return null
    }
  })()

const TARGET_ARCH = process.env.TARGET_ARCH || process.arch
const TARGET_PLATFORM =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'

// 需要针对 Electron ABI 重新编译的模块
const COMPILE_MODULES = ['better-sqlite3']

// 预编译模块：仅校验目标平台二进制是否存在
const PREBUILT_MODULES = [
  { name: 'sqlite-vec', token: (platform) => (platform === 'win32' ? 'windows' : platform) },
  { name: '@node-rs/jieba', token: (platform) => platform },
]

// 设置 Electron 下载镜像（与 package.json 构建脚本保持一致；已设置则不覆盖）
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.npm_config_disturl ||= 'https://npmmirror.com/mirrors/electron/'

console.log('========================================')
console.log('Rebuilding native modules for Electron (cross-platform)')
console.log('========================================')
console.log()

function findPrebuiltPackage(name) {
  const isScoped = name.startsWith('@')
  const scopeDir = isScoped
    ? path.join(productionModulesPath, name.split('/')[0])
    : productionModulesPath
  const base = isScoped ? name.split('/')[1] : name
  const prefix = `${base}-${TARGET_PLATFORM}-${TARGET_ARCH}`

  if (!fs.existsSync(scopeDir)) {
    return null
  }

  const found = fs.readdirSync(scopeDir).find((entry) => entry.startsWith(prefix))
  return found ? path.join(scopeDir, found) : null
}

async function main() {
  if (!fs.existsSync(productionModulesPath)) {
    console.error(`❌ ${productionNodeModulesPath} does not exist.`)
    console.error('Please run "npm run optimize:electron-deps" first.')
    process.exit(1)
  }

  if (!ELECTRON_VERSION) {
    console.error('❌ Cannot determine Electron version. Install dependencies or set ELECTRON_VERSION.')
    process.exit(1)
  }

  console.log(`Target: Electron ${ELECTRON_VERSION} (${TARGET_ARCH}, ${TARGET_PLATFORM})`)
  console.log()

  // macOS 前置检查：better-sqlite3 编译需要 Xcode Command Line Tools
  if (TARGET_PLATFORM === 'darwin') {
    try {
      const { execSync } = require('child_process')
      execSync('xcode-select -p', { stdio: 'ignore' })
      console.log('✓ Xcode Command Line Tools detected')
    } catch (e) {
      console.warn('⚠️  Xcode Command Line Tools not detected.')
      console.warn('   better-sqlite3 编译需要它，请先运行: xcode-select --install')
    }
    console.log()
  }

  // 预编译模块校验
  console.log('Verifying prebuilt platform binaries...')
  for (const mod of PREBUILT_MODULES) {
    const pkgName = mod.name
    const token = mod.token(TARGET_PLATFORM)
    const found = findPrebuiltPackage(pkgName)

    if (found) {
      console.log(`  ✓ ${pkgName}: prebuilt binary found (${path.basename(found)})`)
    } else {
      console.warn(`  ⚠️  ${pkgName}: no ${token}-${TARGET_ARCH} prebuilt package found.`)
      console.warn(`     Delete ${productionNodeModulesPath} and rerun "npm run optimize:electron-deps" to reinstall.`)
    }
  }
  console.log()

  // 重建缓存标记：平台/架构/Electron 版本任一变化都会强制重建
  const markerFile = path.join(
    productionNodeModulesPath,
    `.rebuild-electron-${ELECTRON_VERSION}-${TARGET_PLATFORM}-${TARGET_ARCH}`
  )

  if (fs.existsSync(markerFile)) {
    console.log('✓ Rebuild marker found, skipping better-sqlite3 rebuild')
    console.log(`  (Marker: ${path.basename(markerFile)})`)
    console.log('  Delete the marker file to force a rebuild')
  } else {
    console.log(`Rebuilding ${COMPILE_MODULES.join(', ')} for Electron ${ELECTRON_VERSION}...`)
    console.log()

    try {
      const { rebuild } = require('@electron/rebuild')

      await rebuild({
        buildPath: productionNodeModulesPath,
        // 关键：限制模块搜索范围，避免沿目录向上把 dev 的 node_modules 也重建掉
        projectRootPath: productionNodeModulesPath,
        electronVersion: ELECTRON_VERSION,
        arch: TARGET_ARCH,
        onlyModules: COMPILE_MODULES,
        force: true,
        prebuildTagPrefix: 'v',
      })

      console.log()
      console.log(`✓ ${COMPILE_MODULES.join(', ')} rebuilt for Electron`)

      // 写入 marker，供后续构建跳过
      fs.writeFileSync(markerFile, `${new Date().toISOString()}\n`)
      console.log(`✓ Rebuild marker saved: ${path.basename(markerFile)}`)
    } catch (error) {
      console.error()
      console.error('❌ Native module rebuild failed:', error.message)
      console.error('   Windows: 需要 Visual Studio Build Tools (Desktop development with C++)')
      console.error('   macOS:   需要 Xcode Command Line Tools (xcode-select --install)')
      console.error('   Linux:   需要 build-essential + python3')
      process.exit(1)
    }
  }

  console.log()
  console.log('========================================')
  console.log('SUCCESS: Native modules ready for Electron')
  console.log('========================================')
}

main().catch((error) => {
  console.error('❌ Rebuild failed:', error.message)
  process.exit(1)
})
