/**
 * 重建 backend-ts（dev 模式）的原生模块二进制
 *
 * dev 模式后端跑在系统 Node（非 Electron），原生模块要么下载预编译包、
 * 要么随 npm 包自带，仅在缺失时才需要 node-gyp 源码编译。
 *
 * 背景：国内网络直连 GitHub 不稳定，better-sqlite3 的 prebuild-install
 * 默认从 GitHub Releases 下载，容易失败；这里强制走 npmmirror 二进制镜像。
 * node-pty 的预编译包随 npm 包自带（prebuilds/），缺失时回退 node-gyp 编译
 * （需要 VS Build Tools / Xcode CLT / build-essential）。
 *
 * 设计：先验证所有原生模块能否加载，全部正常则直接跳过（不碰任何文件，
 * 避免与正在运行的 dev 后端冲突）；只有缺失/损坏的模块才触发重建。
 *
 * 用法：
 *   npm run rebuild:backend-native
 */

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const backendPath = path.join(__dirname, '..', 'backend-ts')
const modulesPath = path.join(backendPath, 'node_modules')

const NATIVE_MODULES = [
  'better-sqlite3',
  'node-pty',
  '@node-rs/jieba',
  'sharp',
  '@parcel/watcher',
  'sqlite-vec',
  'tiktoken',
]

// better-sqlite3 预编译包镜像（npmmirror 二进制镜像，与 .npmrc 的 registry 一致）
const BETTER_SQLITE3_MIRROR = 'https://registry.npmmirror.com/-/binary/better-sqlite3'

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function moduleLoads(name) {
  try {
    require(path.join(modulesPath, name))
    return true
  } catch {
    return false
  }
}

function verifyNativeModules() {
  console.log('\n==== 验证原生模块可加载 ====')
  const broken = []
  for (const name of NATIVE_MODULES) {
    if (moduleLoads(name)) {
      console.log('  OK   ' + name)
    } else {
      broken.push(name)
      console.log('  FAIL ' + name)
    }
  }
  return broken
}

function main() {
  if (!fs.existsSync(modulesPath)) {
    console.error(`❌ ${modulesPath} 不存在，请先安装依赖（npm install）`)
    process.exit(1)
  }

  console.log(`Node ${process.version} (ABI ${process.versions.modules}, ${process.platform}-${process.arch})`)
  console.log('目标：backend-ts/node_modules（dev 模式，系统 Node）')

  // 1. 先验证，全部正常则无需重建
  const broken = verifyNativeModules()
  if (broken.length === 0) {
    console.log('\n✓ 所有原生模块已就绪，无需重建')
    return
  }
  console.log(`\n⚠️  以下模块二进制缺失或损坏，开始重建：${broken.join(', ')}`)
  console.log('   提示：若 dev 后端正在运行，请先停止它，否则文件被占用会导致重建失败。')

  // 2. better-sqlite3：优先从 npmmirror 镜像下载预编译包，失败则回退 node-gyp 编译
  if (broken.includes('better-sqlite3')) {
    const bs3Dir = path.join(modulesPath, 'better-sqlite3')
    console.log('\n==== better-sqlite3 ====')
    try {
      run('npx --no-install prebuild-install', {
        cwd: bs3Dir,
        env: {
          ...process.env,
          npm_config_better_sqlite3_binary_host_mirror: BETTER_SQLITE3_MIRROR,
        },
      })
      console.log('✓ better-sqlite3 预编译包下载成功')
    } catch (e) {
      const msg = String(e.message || e)
      if (/EBUSY|EPERM|locked|占用/.test(msg)) {
        console.error('❌ better-sqlite3 二进制文件被占用（dev 后端正在运行）')
        console.error('   请先停止 dev 后端，再重新执行本脚本')
        process.exit(1)
      }
      console.warn('⚠️  prebuild-install 下载失败，回退 node-gyp 源码编译...')
      console.warn('   需要 VS Build Tools (Windows) / Xcode CLT (macOS) / build-essential (Linux)')
      run('npm rebuild better-sqlite3', { cwd: backendPath })
    }
  }

  // 3. node-pty：预编译包随包自带，缺失时 npm rebuild 触发 node-gyp 兜底
  if (broken.includes('node-pty')) {
    console.log('\n==== node-pty ====')
    run('npm rebuild node-pty', { cwd: backendPath })
    console.log('✓ node-pty 就绪')
  }

  // 4. 最终验证
  const stillBroken = verifyNativeModules()
  if (stillBroken.length > 0) {
    console.error(`\n❌ 仍有 ${stillBroken.length} 个原生模块加载失败：${stillBroken.join(', ')}`)
    process.exit(1)
  }

  console.log('\n========================================')
  console.log('SUCCESS: dev 模式原生模块就绪')
  console.log('========================================')
}

main()
