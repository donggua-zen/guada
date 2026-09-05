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
  // hoisted 布局下平台包（sqlite-vec-windows-x64 等）在顶层 node_modules 可见
  const prefix = `${base}-${TARGET_PLATFORM}-${TARGET_ARCH}`
  const prefixAlt = `${base}-${TARGET_PLATFORM === 'win32' ? 'windows' : TARGET_PLATFORM}-${TARGET_ARCH}`

  if (!fs.existsSync(scopeDir)) {
    return null
  }

  const entries = fs.readdirSync(scopeDir)
  const found = entries.find((entry) => entry.startsWith(prefix)) ||
    (prefixAlt !== prefix ? entries.find((entry) => entry.startsWith(prefixAlt)) : null)
  return found ? path.join(scopeDir, found) : null
}

// better-sqlite3 自带 electron 运行时的预编译包（prebuild-install 支持 --runtime=electron）。
// 从 npmmirror 二进制镜像下载，避免依赖本地 Visual Studio 工具链
async function tryPrebuildInstall() {
  const { execSync } = require('child_process')
  const bs3Dir = path.join(productionModulesPath, 'better-sqlite3')
  if (!fs.existsSync(bs3Dir)) {
    console.warn('⚠️  better-sqlite3 not found in production modules')
    return false
  }

  // 优先用 dev node_modules 里现成的 prebuild-install
  let bin = null
  for (const candidate of [
    path.join(productionModulesPath, '.bin', 'prebuild-install'),
    path.join(__dirname, '..', 'backend-ts', 'node_modules', '.bin', 'prebuild-install'),
  ]) {
    if (fs.existsSync(candidate)) { bin = candidate; break }
  }
  if (!bin) {
    console.warn('⚠️  prebuild-install not available, falling back to source compile')
    return false
  }

  console.log(`Downloading better-sqlite3 prebuilt for Electron ${ELECTRON_VERSION} (${TARGET_PLATFORM}-${TARGET_ARCH})...`)
  try {
    execSync(
      `"${bin}" --runtime=electron --target=${ELECTRON_VERSION} --arch=${TARGET_ARCH} --platform=${TARGET_PLATFORM} --verbose`,
      {
        cwd: bs3Dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          // 与 rebuild-native.js 保持一致：走 npmmirror 二进制镜像
          npm_config_better_sqlite3_binary_host_mirror: 'https://registry.npmmirror.com/-/binary/better-sqlite3',
          PREBUILD_INSTALL_HOST: 'https://registry.npmmirror.com/-/binary/better-sqlite3',
        },
      }
    )
    return true
  } catch (e) {
    console.warn('⚠️  prebuild-install failed: ' + String(e.message || e).split('\n')[0])
    return false
  }
}

async function main() {
  if (!fs.existsSync(productionModulesPath)) {
    console.error(`❌ ${productionNodeModulesPath} does not exist.`)
    console.error('Please run "pnpm run optimize:electron-deps" first.')
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
      console.warn(`     Delete ${productionNodeModulesPath} and rerun "pnpm run optimize:electron-deps" to reinstall.`)
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

    // 优先尝试 better-sqlite3 自带的 electron 预编译包（走 npmmirror 镜像），
    // 无需本地工具链；失败才回退 @electron/rebuild 源码编译（需要 VS / Xcode）
    const prebuildOk = await tryPrebuildInstall()

    if (prebuildOk) {
      console.log()
      console.log(`✓ ${COMPILE_MODULES.join(', ')} prebuilt for Electron downloaded`)
    } else {
      console.log()
      console.log('⚠️  预编译下载失败，回退 node-gyp 源码编译...')
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
      } catch (error) {
        console.error()
        console.error('❌ Native module rebuild failed:', error.message)
        console.error('   Windows: 需要 Visual Studio Build Tools (Desktop development with C++)')
        console.error('   macOS:   需要 Xcode Command Line Tools (xcode-select --install)')
        console.error('   Linux:   需要 build-essential + python3')
        process.exit(1)
      }
    }

    // 写入 marker，供后续构建跳过
    fs.writeFileSync(markerFile, `${new Date().toISOString()}\n`)
    console.log(`✓ Rebuild marker saved: ${path.basename(markerFile)}`)
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
