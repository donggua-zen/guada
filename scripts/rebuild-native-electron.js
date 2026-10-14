/**
 * 为 Electron 环境重建 backend-ts 的原生模块（跨平台：Windows / macOS / Linux）
 *
 * - better-sqlite3 需要针对 Electron ABI 重新编译（使用 @electron/rebuild）
 * - sqlite-vec / @node-rs/jieba 为预编译二进制，仅校验目标平台产物是否存在
 * - Windows 目标：给动态链接 MSVC 运行时的 .node 随包分发 vcruntime140*.dll
 *   （扫描 PE 导入表决定发给谁，见 distributeVcRuntime）
 * - 目标目录：backend-ts/node_modules_production
 * - 平台/架构/Electron 版本任一变化都会强制重建（marker 文件包含三者信息）
 *
 * 环境变量：
 *   TARGET_ARCH     覆盖目标架构（默认 process.arch，交叉构建时使用）
 *   ELECTRON_VERSION 覆盖 Electron 版本（默认读取已安装的 electron）
 *   GUADA_VCRUNTIME_DIR 指定 VC++ 运行时 DLL 来源目录（默认自动查找）
 */

const path = require('path')
const fs = require('fs')
const { resolveTargetPlatforms } = require('./platform-manifest')
const { peImportInfo, crtImports, collectNativeBinaries, PE_MACHINE } = require('./pe-imports')

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

// ── VC++ 运行时随包分发（仅 Windows 目标）──
//
// 背景：干净 Windows 上没有装 VC++ 运行时（vcruntime140*.dll），动态链接它的 .node
// 会 dlopen 失败报「找不到指定的模块」。@node-rs/jieba 就是这种（Rust MSVC 目标默认
// 动态链接 CRT），而它又是在模块顶层被 require 的，于是整个后端进程退出（实测：全新
// Win10 虚拟机装完包后端起不来）。sharp / canvas / watcher / better-sqlite3 /
// node-pty / sqlite-vec 都是静态链接，只依赖系统 DLL，所以只有 jieba 挂。
//
// 为什么单份共享目录 + 后端进程 PATH 注入，而不是每个包目录放一份：libuv 用
// LoadLibraryExW(LOAD_WITH_ALTERED_SEARCH_PATH) 加载 .node，该模式下搜索顺序是
// 「.node 所在目录 → System32 → Windows 目录 → cwd → PATH」——「应用目录
// （GuaDa.exe 同级）」这一档被替换掉了。实测（把依赖名改成只在一处存在的名字验证）：
// PATH ✅、cwd ✅、.node 同目录 ✅、应用目录 ❌。所以 DLL 单份放在 resources/vc-runtime，
// 由 electron 主进程注入后端 PATH（见 electron/main.ts 的 backendCrtPathEnv），
// 将来任何原生模块动态依赖运行时也都覆盖得到，不需要重复副本。
//
// 哪些 DLL 需要分发不写死：扫描所有原生二进制的 PE 导入表得出（vcruntime / msvcp /
// concrt 家族），来源按 VS Redist > Windows SDK Redist > 系统目录 查找；缺 DLL 直接让
// 构建失败而不是静默出包。

/** 随包分发的 VC++ 运行时目录（源目录；打包后落在 resources/vc-runtime） */
const CRT_OUTPUT_DIR = path.join(__dirname, '..', 'vc-runtime')

/**
 * 收集需要随包分发的 VC++ 运行时 DLL：扫描所有目标架构的原生二进制导入表，
 * 返回 { required: Set<dll名>, users: Map<dll名, string[]> }。
 */
function collectRequiredCrtDlls() {
  const wantMachine = PE_MACHINE[TARGET_ARCH]
  const required = new Set()
  const users = new Map()

  for (const file of collectNativeBinaries(productionModulesPath)) {
    let info
    try {
      info = peImportInfo(file)
    } catch (e) {
      continue // 非 PE（darwin/linux 的 .node 产物），与本次目标平台无关
    }
    if (wantMachine && info.machine !== wantMachine) continue

    for (const name of crtImports(info)) {
      required.add(name)
      if (!users.has(name)) users.set(name, [])
      users.get(name).push(path.relative(productionModulesPath, file))
    }
  }
  return { required, users }
}

/** 展开含 * 的路径模式（只展开目录层级），结果按路径倒序 = 新版本优先 */
function expandDirGlob(pattern) {
  const parts = pattern.split(/[\\/]+/)
  let current = [parts[0] + path.sep]
  for (const seg of parts.slice(1)) {
    const next = []
    for (const dir of current) {
      if (!seg.includes('*')) {
        next.push(path.join(dir, seg))
        continue
      }
      if (!fs.existsSync(dir)) continue
      const re = new RegExp('^' + seg.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && re.test(entry.name)) next.push(path.join(dir, entry.name))
      }
    }
    current = next
  }
  return current.filter((p) => fs.existsSync(p)).sort().reverse()
}

/**
 * VC++ 运行时 DLL 的来源目录（按优先级）：
 * 显式指定 > VS/VS Build Tools 的 Redist > Windows SDK Redist > 系统目录。
 * 优先用官方 Redist 目录（随应用分发许可清晰），兜底用本机已安装的运行时。
 */
function crtSourceDirs(arch) {
  const dirs = []
  const push = (d) => d && fs.existsSync(d) && dirs.push(d)

  push(process.env.GUADA_VCRUNTIME_DIR)

  const redistNames = arch === 'ia32' ? ['x86', 'x64'] : ['x64', 'x86']
  const vsRoots = [
    process.env.VCToolsRedistDir, // 形如 <VS>\VC\Redist\MSVC\14.xx\
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', '*', '*', 'VC', 'Redist', 'MSVC'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', '*', '*', 'VC', 'Redist', 'MSVC'),
  ].filter(Boolean)
  for (const root of vsRoots) {
    for (const name of redistNames) {
      for (const base of expandDirGlob(path.join(root, '*')).concat(expandDirGlob(root))) {
        for (const crt of expandDirGlob(path.join(base, name, 'Microsoft.VC*.CRT'))) push(crt)
      }
    }
  }

  const kitsRoot = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'Redist')
  for (const name of redistNames) {
    for (const crt of expandDirGlob(path.join(kitsRoot, '*', name, 'Microsoft.VC*.CRT'))) push(crt)
  }

  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  push(path.join(systemRoot, arch === 'ia32' ? 'SysWOW64' : 'System32'))
  return dirs
}

/**
 * 把需要分发的 VC++ 运行时 DLL 收敛到单份共享目录（CRT_OUTPUT_DIR）并校验，
 * 由 electron 主进程注入后端 PATH（见 electron/main.ts）。
 */
function distributeVcRuntime() {
  const targetPlatforms = resolveTargetPlatforms(process.env)
  if (!targetPlatforms.includes('win32')) return

  const { required, users } = collectRequiredCrtDlls()

  console.log('Collecting VC++ runtime for native modules (Windows target)...')
  if (required.size === 0) {
    console.log('  · 没有动态链接 MSVC 运行时的原生模块，无需分发')
    console.log()
    return
  }

  const sourceDirs = crtSourceDirs(TARGET_ARCH)
  fs.mkdirSync(CRT_OUTPUT_DIR, { recursive: true })

  let missing = 0
  for (const name of [...required].sort()) {
    const src = sourceDirs.map((d) => path.join(d, name)).find((p) => fs.existsSync(p))
    if (!src) {
      console.error(`  ❌ ${name}: 本机找不到（需要：${users.get(name).join('、')}）`)
      missing++
      continue
    }
    const dest = path.join(CRT_OUTPUT_DIR, name)
    try {
      const unchanged = fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size
      if (!unchanged) fs.copyFileSync(src, dest)
      console.log(`  ✓ ${name} ← ${path.dirname(src)}${unchanged ? ' （已是最新，跳过复制）' : ''}`)
    } catch (e) {
      console.error(`  ❌ ${dest}: 复制失败（${e.message}）`)
      missing++
    }
  }

  // 清掉不再需要的旧 DLL（如依赖变化），保证目录内容恰好 = 当前所需
  for (const entry of fs.readdirSync(CRT_OUTPUT_DIR)) {
    if (!required.has(entry.toLowerCase())) {
      fs.rmSync(path.join(CRT_OUTPUT_DIR, entry), { force: true })
      console.log(`  · 移除不再需要的 ${entry}`)
    }
  }

  // 校验：目录里必须正好备齐所需 DLL
  const stillMissing = [...required].filter((n) => !fs.existsSync(path.join(CRT_OUTPUT_DIR, n)))
  if (missing > 0 || stillMissing.length > 0) {
    console.error()
    console.error(`❌ VC++ 运行时不全（${stillMissing.join(', ') || '复制失败'}），打包出来的安装包在干净 Windows 上会起不来后端。`)
    console.error('   Windows: 安装 Visual Studio Build Tools（勾选 C++ 生成工具）或 VC++ 可再发行组件，')
    console.error('   或用 GUADA_VCRUNTIME_DIR 指向含 vcruntime140.dll / vcruntime140_1.dll 的目录。')
    process.exit(1)
  }

  console.log(`✓ ${[...required].join(', ')} → ${path.relative(path.join(__dirname, '..'), CRT_OUTPUT_DIR)}（单份，随包分发）`)
  console.log()
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

  // 每次构建都执行：node_modules_production 会被 optimize-electron-deps 重新生成
  distributeVcRuntime()

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
