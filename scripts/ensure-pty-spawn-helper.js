/**
 * 补齐 node-pty 在 macOS 下的 spawn-helper 可执行权限
 *
 * 背景：macOS 上 node-pty 用 posix_spawn 执行 <node-pty>/prebuilds/darwin-<arch>/spawn-helper
 * （helper 负责 chdir(cwd) + execvp(shell)，见 node-pty/src/unix/spawn-helper.cc）。
 * 该文件在 pnpm 安装（尤其是 patchedDependencies 整包重新物化）、electron-builder
 * extraResources 拷贝等环节会丢掉 x 位，随后 posix_spawn 返回 EACCES，node-pty 原生层
 * 抛 Napi::Error —— 这条异常路径在后端进程里会直接 std::terminate：
 *   libc++abi: terminating due to uncaught exception of type Napi::Error
 * 整个后端被 abort（JS 层 try/catch 拦不住）。Windows 用 ConPTY/winpty、Linux 用 forkpty，
 * 都不使用该 helper，因此只有 macOS 受影响。
 *
 * 用法：
 *   node scripts/ensure-pty-spawn-helper.js [--warn-only] [node_modules 目录...]
 *   不传目录时默认处理 dev 与打包用两套 node_modules（存在才处理）。
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')

const DEFAULT_ROOTS = [
  path.join(REPO_ROOT, 'backend-ts', 'node_modules'),
  path.join(REPO_ROOT, 'backend-ts', 'node_modules_production', 'node_modules'),
]

/** node-pty 原生模块目录查找顺序，与 node-pty/lib/utils.js 的 loadNativeModule 一致 */
function nativeDirs() {
  return ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]
}

/**
 * 确保指定 node_modules 目录下 node-pty 的 spawn-helper 可执行
 *
 * @param {string[]} nodeModulesDirs node_modules 目录列表
 * @param {{ warnOnly?: boolean, log?: (msg: string) => void }} [options]
 * @returns {{ ok: boolean, skipped: boolean, fixed: number, failed: number }}
 */
function ensureSpawnHelperExecutable(nodeModulesDirs, options = {}) {
  const log = options.log || console.log

  // Windows 用 ConPTY/winpty、Linux 用 forkpty，都不需要 helper，也没有 x 位语义
  if (process.platform !== 'darwin') {
    log(`  跳过：当前平台 ${process.platform} 不使用 spawn-helper`)
    return { ok: true, skipped: true, fixed: 0, failed: 0 }
  }

  let fixed = 0
  let failed = 0

  for (const root of nodeModulesDirs) {
    const pkgDir = path.join(root, 'node-pty')
    if (!fs.existsSync(pkgDir)) {
      log(`  跳过：${pkgDir} 不存在（node-pty 未安装）`)
      continue
    }

    let found = 0
    for (const dir of nativeDirs()) {
      const helper = path.join(pkgDir, dir, 'spawn-helper')
      if (!fs.existsSync(helper)) continue
      found++

      if ((fs.statSync(helper).mode & 0o111) !== 0) {
        log(`  OK   ${dir}/spawn-helper 已可执行`)
        continue
      }

      try {
        fs.chmodSync(helper, 0o755)
      } catch (e) {
        failed++
        log(`  FAIL ${helper} 无法 chmod：${e.message}`)
        log(`       修复：chmod +x "${helper}"（或确认该目录可写）`)
        continue
      }

      if ((fs.statSync(helper).mode & 0o111) === 0) {
        failed++
        log(`  FAIL ${helper} chmod 后仍不可执行`)
        continue
      }
      fixed++
      log(`  FIX  ${dir}/spawn-helper 已补齐 x 位`)
    }

    if (found === 0) {
      log(`  警告：${pkgDir} 内未找到 spawn-helper（源码编译安装时位于 build/Release/）`)
    }
  }

  return { ok: failed === 0, skipped: false, fixed, failed }
}

module.exports = { ensureSpawnHelperExecutable, DEFAULT_ROOTS, nativeDirs }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const warnOnly = argv.includes('--warn-only')
  const roots = argv.filter((a) => !a.startsWith('--'))
  const targets = roots.length > 0 ? roots : DEFAULT_ROOTS

  console.log('==== 检查 node-pty spawn-helper 可执行权限 ====')
  const res = ensureSpawnHelperExecutable(targets)

  if (!res.ok) {
    console.error('\n❌ 有 spawn-helper 仍不可执行：macOS 打开终端会让后端进程直接 abort')
    console.error('   请检查上述路径的权限，或重新安装依赖（pnpm install）后重试')
    if (!warnOnly) process.exit(1)
    console.error('   （--warn-only：本次不中断流程）')
  } else if (!res.skipped) {
    console.log(res.fixed > 0 ? `\n✓ 已修复 ${res.fixed} 个 spawn-helper 权限` : '\n✓ spawn-helper 权限正常')
  }
}
