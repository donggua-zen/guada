/**
 * 为 Electron 生产环境精简 node_modules
 * 只保留生产必需的依赖，移除开发依赖和不必要的文件
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const glob = require('glob')
const platformManifest = require('./platform-manifest')

console.log('========================================')
console.log('Optimizing node_modules for Electron production')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const optimizedPath = path.join(backendPath, 'node_modules_production')
const repoRoot = path.join(__dirname, '..')
const watcherPatchScript = path.join(__dirname, 'patch-parcel-watcher.mjs')
const shippedWatcherBinary = path.join(repoRoot, 'third_party', 'parcel-watcher', 'watcher.node')
const watcherBinaryRelPath = path.join('node_modules', '@parcel', 'watcher-win32-x64', 'watcher.node')

function getDirSize(dirPath) {
  let size = 0
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        size += fs.statSync(fullPath).size
      }
    }
  } catch (e) {
  }
  return size
}

const packageJsonPath = path.join(backendPath, 'package.json')

function getDependenciesHash() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  const deps = {
    dependencies: pkg.dependencies,
    overrides: pkg.overrides
  }
  let hash = crypto.createHash('md5').update(JSON.stringify(deps))

  // 目标平台纳入哈希：切换构建平台时强制重新安装与裁剪
  hash = hash.update(
    JSON.stringify({ targetPlatforms: platformManifest.resolveTargetPlatforms(process.env) })
  )

  // 将 schema.prisma 内容纳入哈希计算，schema 变更时强制重新生成
  const prismaSchemaPath = path.join(backendPath, 'prisma', 'schema.prisma')
  if (fs.existsSync(prismaSchemaPath)) {
    const schemaContent = fs.readFileSync(prismaSchemaPath, 'utf-8')
    hash = hash.update(schemaContent)
  }

  return hash.digest('hex')
}

function isCacheValid() {
  const cacheHashPath = path.join(optimizedPath, '.cache-hash')
  const nodeModulesPath = path.join(optimizedPath, 'node_modules')
  if (!fs.existsSync(cacheHashPath) || !fs.existsSync(nodeModulesPath)) {
    return false
  }
  const currentHash = getDependenciesHash()
  const cachedHash = fs.readFileSync(cacheHashPath, 'utf-8').trim()
  return currentHash === cachedHash
}

function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

/**
 * 确保生产目录里的 @parcel/watcher Windows 后端是打过补丁的二进制。
 *
 * 上游 2.6.0 在退订时释放仍被在途回调持有的 Subscription（use-after-free），
 * 打包版切换会话必现 0xC0000005 静默崩溃。补丁二进制随仓库分发（third_party/），
 * 由 patch-parcel-watcher.mjs 覆盖安装产物，这里负责兜底执行并校验结果。
 *
 * 缓存命中会跳过整个安装流程（含 postinstall 里的补丁），所以两条路径都要走这里。
 * 仅 win32/x64 生效，判断条件与 patch-parcel-watcher.mjs 保持一致。
 */
function ensureWatcherPatched() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return

  if (!fs.existsSync(shippedWatcherBinary)) {
    console.warn(`⚠️  找不到 ${path.relative(repoRoot, shippedWatcherBinary)}，跳过 @parcel/watcher 校验`)
    return
  }

  try {
    execSync(`node "${watcherPatchScript}"`, { cwd: repoRoot, stdio: 'inherit', env: process.env })
  } catch (error) {
    console.error('❌ @parcel/watcher 补丁执行失败:', error.message)
    process.exit(1)
  }

  const target = path.join(optimizedPath, watcherBinaryRelPath)
  if (!fs.existsSync(target)) {
    console.error('❌ 生产目录里没有 @parcel/watcher-win32-x64/watcher.node，打包版工作区监听会直接崩溃。')
    console.error('   检查 backend-ts/package.json 的 dependencies 是否包含 @parcel/watcher。')
    process.exit(1)
  }

  const expected = md5File(shippedWatcherBinary)
  const actual = md5File(target)
  if (actual !== expected) {
    console.error(`❌ 生产目录中的 @parcel/watcher 未打补丁（md5=${actual}，期望 ${expected}）`)
    console.error('   打包版切换会话会触发 0xC0000005 崩溃。')
    console.error('   补丁二进制与重新编译步骤见 third_party/parcel-watcher/README.md。')
    process.exit(1)
  }
  console.log('✓ @parcel/watcher 已打补丁（Windows 后端 use-after-free 修复）')
}

if (isCacheValid()) {
  console.log('\u2705 Cache valid, skipping dependency installation')
  // 旧缓存可能来自未打补丁的构建，缓存命中也不能跳过校验
  ensureWatcherPatched()
  const cachedSize = (getDirSize(optimizedPath) / (1024 * 1024)).toFixed(2)
  console.log(`\uD83D\uDCE6 Cached node_modules size: ${cachedSize} MB`)
  console.log()
  console.log('========================================')
  console.log('SUCCESS: Cache hit! Using existing optimized node_modules')
  console.log('(Delete node_modules_production to force reinstall)')
  console.log('========================================')
  process.exit(0)
}

// Step 1: 创建临时目录
if (fs.existsSync(optimizedPath)) {
  console.log('Cleaning existing optimized directory...')
  try {
    fs.rmSync(optimizedPath, { recursive: true, force: true })
  } catch (error) {
    console.warn('⚠️  Could not clean directory, trying alternative method...')
    // Windows 下可能需要重试
    setTimeout(() => {
      try {
        fs.rmSync(optimizedPath, { recursive: true, force: true })
      } catch (retryError) {
        console.error('❌ Failed to clean directory. Please close any processes using it and try again.')
        console.error('Error:', retryError.message)
        process.exit(1)
      }
    }, 1000)
  }
}
fs.mkdirSync(optimizedPath, { recursive: true })

// Step 2: 复制 pnpm 工程文件（package.json / lockfile / 补丁）
// 必须用 pnpm 安装：只有 pnpm 会应用 patches/ 下的 node-pty 补丁，
// npm install 会静默装回未打补丁的原版
console.log('Step 1: Copying package files (pnpm project files + patches)...')

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

// 暂存目录比 backend-ts 深一层：所有指向仓库根脚本的 ../scripts/ 相对路径
// （preinstall / postinstall / rebuild:electron）都要上移一级，否则这里会解析到
// backend-ts/scripts/ 而 MODULE_NOT_FOUND，整个打包链在安装阶段就中断
const rewrittenScripts = []
for (const [name, cmd] of Object.entries(packageJson.scripts || {})) {
  if (typeof cmd !== 'string' || !cmd.includes('../scripts/')) continue
  packageJson.scripts[name] = cmd.split('../scripts/').join('../../scripts/')
  rewrittenScripts.push(name)
}
if (rewrittenScripts.length > 0) {
  console.log(`✓ Rewrote ../scripts/ paths for staging dir: ${rewrittenScripts.join(', ')}`)
}

// 暂存目录里既没有 prisma/schema.prisma，prisma 又是被 --prod 跳过的 devDependency，
// postinstall 里的 prisma generate 必然报 "Could not find Prisma Schema" 再被 || 吞掉，
// 只会干扰排查。真正的生成在下方 Step 3（cwd 指向 backend-ts），这里只留补丁调用。
if (packageJson.scripts && packageJson.scripts.postinstall) {
  packageJson.scripts.postinstall = 'node ../../scripts/patch-parcel-watcher.mjs'
}

fs.writeFileSync(
  path.join(optimizedPath, 'package.json'),
  JSON.stringify(packageJson, null, 2)
)

const pnpmLockPath = path.join(backendPath, 'pnpm-lock.yaml')
if (fs.existsSync(pnpmLockPath)) {
  fs.copyFileSync(pnpmLockPath, path.join(optimizedPath, 'pnpm-lock.yaml'))
} else {
  console.error('❌ backend-ts/pnpm-lock.yaml 不存在，请先在 backend-ts 执行 pnpm install')
  process.exit(1)
}

// 补丁与 allowBuilds 配置必须一起复制，pnpm 才能在该目录应用 patchedDependencies
const pnpmWorkspacePath = path.join(optimizedPath, 'pnpm-workspace.yaml')
if (fs.existsSync(path.join(backendPath, 'pnpm-workspace.yaml'))) {
  fs.copyFileSync(path.join(backendPath, 'pnpm-workspace.yaml'), pnpmWorkspacePath)
  // hoisted 布局：npm 风格的扁平 node_modules（真实文件、无符号链接），
  // 兼容 electron-builder 的 extraResources 拷贝和后续裁剪步骤。
  // 注意 pnpm 11 不再从 .npmrc 读取 node-linker，必须写在 pnpm-workspace.yaml
  fs.appendFileSync(pnpmWorkspacePath, '\n# 打包目录使用扁平布局（真实文件，无符号链接），兼容 electron-builder\nnodeLinker: hoisted\n')
}
const patchesSrc = path.join(backendPath, 'patches')
if (fs.existsSync(patchesSrc)) {
  fs.cpSync(patchesSrc, path.join(optimizedPath, 'patches'), { recursive: true })
}

// hoisted 布局：npm 风格的扁平 node_modules（真实文件、无符号链接），
// 兼容 electron-builder 的 extraResources 拷贝和后续裁剪步骤
fs.writeFileSync(path.join(optimizedPath, '.npmrc'), 'node-linker=hoisted\n', 'utf-8')

console.log('✓ Copied package.json / pnpm-lock.yaml / pnpm-workspace.yaml / patches/')
console.log('✓ Created .npmrc (node-linker=hoisted)')

// Step 3: 安装生产依赖（不包含 devDependencies）
console.log()
console.log('Step 2: Installing production dependencies with pnpm (patches applied)...')
try {
  // 创建干净的环境变量，移除 electron-builder 特有的配置
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY

  execSync('pnpm install --prod --frozen-lockfile', {
    cwd: optimizedPath,
    stdio: 'inherit',
    env: cleanEnv
  })
  console.log('✓ Production dependencies installed')
} catch (error) {
  console.error('❌ Installation failed:', error.message)
  process.exit(1)
}

// Step 3.1: 校验 node-pty 补丁已生效（防止未来工具链变更悄悄回退到未打补丁的包）
console.log()
console.log('Verifying node-pty patch...')
const nodePtyAgentPath = path.join(optimizedPath, 'node_modules', 'node-pty', 'lib', 'conpty_console_list_agent.js')
if (!fs.existsSync(nodePtyAgentPath)) {
  console.error('❌ node-pty 未安装到生产目录！终端功能在打包版中将不可用。')
  console.error('   检查 backend-ts/package.json 的 dependencies 是否包含 node-pty。')
  process.exit(1)
}
if (!fs.readFileSync(nodePtyAgentPath, 'utf-8').includes('GuaDa patch')) {
  console.error('❌ 生产目录中的 node-pty 未打补丁！打包版关闭终端会触发 "AttachConsole failed"。')
  console.error('   请确认 backend-ts/pnpm-workspace.yaml 的 patchedDependencies 已复制到安装目录。')
  process.exit(1)
}
console.log('✓ node-pty installed and patched')

// Step 3.2: 校验 @parcel/watcher 补丁（install 阶段的 postinstall 已应用，这里再兜底 + 校验 md5）
console.log()
console.log('Verifying @parcel/watcher patch...')
ensureWatcherPatched()

// Step 4: 复制 Prisma schema 并生成客户端
console.log()
console.log('Step 3: Generating Prisma Client...')

// 从原项目复用已有 prisma CLI（devDependency），避免在生产目录临时安装
console.log('Generating Prisma Client using existing CLI...')
try {
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY

  // 强制清除 Prisma Client 缓存，确保基于最新 schema 重新生成
  const prismaClientCachePath = path.join(backendPath, 'node_modules', '.prisma')
  if (fs.existsSync(prismaClientCachePath)) {
    fs.rmSync(prismaClientCachePath, { recursive: true, force: true })
    console.log('✓ Cleared existing Prisma Client cache')
  }

  execSync('pnpm exec prisma generate', {
    cwd: backendPath,
    stdio: 'inherit',
    env: cleanEnv
  })
  console.log('✓ Prisma Client generated in source project')

  // pnpm 布局下生成物位于 node_modules/.pnpm/@prisma+client@X/node_modules/.prisma
  // （npm 布局则直接在 node_modules/.prisma），两种都兼容
  function findGeneratedPrismaClient() {
    const flatPath = path.join(backendPath, 'node_modules', '.prisma')
    if (fs.existsSync(flatPath)) return flatPath
    const virtualRoot = path.join(backendPath, 'node_modules', '.pnpm')
    if (fs.existsSync(virtualRoot)) {
      const entry = fs.readdirSync(virtualRoot).find((d) => d.startsWith('@prisma+client@'))
      if (entry) {
        const candidate = path.join(virtualRoot, entry, 'node_modules', '.prisma')
        if (fs.existsSync(candidate)) return candidate
      }
    }
    return null
  }

  const srcPrismaClient = findGeneratedPrismaClient()
  const destPrismaClient = path.join(optimizedPath, 'node_modules', '.prisma')
  if (srcPrismaClient) {
    if (fs.existsSync(destPrismaClient)) {
      fs.rmSync(destPrismaClient, { recursive: true, force: true })
    }
    fs.cpSync(srcPrismaClient, destPrismaClient, { recursive: true })
    console.log('✓ Copied .prisma client to production directory')
  } else {
    console.warn('⚠️  .prisma client not found in source project')
  }
} catch (error) {
  console.warn('⚠️  Prisma generation warning:', error.message)
  console.warn('Note: You may need to run "pnpm run rebuild:backend-native:electron" after optimization')
}

// Step 5: 清理不必要的文件
console.log()
console.log('Step 4: Cleaning unnecessary files...')

// 5.1 移除开发工具和不必要的模块
console.log('Removing development tools and unnecessary modules...')
const modulesToRemove = [
  // WordNet 数据库（如果不使用 natural 的同义词功能）
  { path: 'node_modules/wordnet-db', reason: 'WordNet database for NLP' },
  // PGlite（如果只使用 SQLite）
  { path: 'node_modules/@electric-sql/pglite', reason: 'Embedded PostgreSQL' }
]

let removedSize = 0
for (const module of modulesToRemove) {
  const modulePath = path.join(optimizedPath, module.path)
  if (fs.existsSync(modulePath)) {
    const size = getDirSize(modulePath)
    fs.rmSync(modulePath, { recursive: true, force: true })
    removedSize += size
    console.log(`  ✓ Removed ${module.path} (${(size / (1024 * 1024)).toFixed(2)} MB) - ${module.reason}`)
  }
}

if (removedSize > 0) {
  console.log(`  Total removed: ${(removedSize / (1024 * 1024)).toFixed(2)} MB`)
}

// 5.2 移除平台特定二进制包（根据构建目标动态保留）
console.log()
console.log('Removing unnecessary platform-specific packages...')

// 检测当前构建平台
const isWindows = process.platform === 'win32'
const isMacOS = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

console.log(`  Current platform: ${process.platform} (${isWindows ? 'Windows' : isMacOS ? 'macOS' : 'Linux'})`)

// 确定需要保留的平台（支持多平台构建）
// 可通过 TARGET_PLATFORMS / SHARP_TARGET_PLATFORMS 指定，例如: "win32,linux" / "darwin"
const targetPlatforms = platformManifest.resolveTargetPlatforms(process.env)

console.log(`  Target platforms: ${targetPlatforms.join(', ')}`)

let platformRemovedSize = 0
let platformRemovedCount = 0

// 先处理更长前缀的包族（如 sharp-libvips-* 先于 sharp-*），避免误删
const families = [...platformManifest.PACKAGE_FAMILIES].sort(
  (a, b) => b.prefix.length - a.prefix.length
)
const handledPackageNames = new Set()

for (const family of families) {
  const scanDir = family.name.includes('/')
    ? path.join(optimizedPath, 'node_modules', family.name.split('/')[0])
    : path.join(optimizedPath, 'node_modules')

  if (!fs.existsSync(scanDir)) {
    continue
  }

  const entries = fs.readdirSync(scanDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const entryName = entry.name
    if (handledPackageNames.has(entryName)) continue
    if (!entryName.startsWith(family.prefix)) continue
    handledPackageNames.add(entryName)

    const entryPath = path.join(scanDir, entryName)
    const shouldKeep = family.keep(entryName, targetPlatforms)

    if (shouldKeep) {
      console.log(`  ✓ Keeping ${entryName} (target: ${targetPlatforms.join(',')})`)
    } else {
      const size = getDirSize(entryPath)
      fs.rmSync(entryPath, { recursive: true, force: true })
      platformRemovedSize += size
      platformRemovedCount++
      console.log(`  ✗ Removed ${entryName} (${(size / (1024 * 1024)).toFixed(2)} MB)`)
    }
  }
}

// 5.2.1 单包内嵌多平台二进制（如 @huggingface/tokenizers 内含多平台 .node 文件）
for (const spec of platformManifest.IN_PACKAGE_BINARIES) {
  const pkgPath = path.join(optimizedPath, 'node_modules', spec.name)
  if (!fs.existsSync(pkgPath)) {
    continue
  }

  console.log()
  console.log(`Removing unnecessary ${spec.describe}...`)

  const candidates = []
  const walkDir = (dir) => {
    const dirEntries = fs.readdirSync(dir, { withFileTypes: true })
    for (const dirEntry of dirEntries) {
      const fullPath = path.join(dir, dirEntry.name)
      if (dirEntry.isDirectory()) {
        walkDir(fullPath)
      } else if (spec.match(dirEntry.name)) {
        candidates.push(fullPath)
      }
    }
  }
  walkDir(pkgPath)

  for (const fullPath of candidates) {
    const fileName = path.basename(fullPath)
    const filePlatform = spec.platformOf(fileName)
    const shouldKeep = filePlatform && targetPlatforms.includes(filePlatform)

    if (shouldKeep) {
      console.log(`  ✓ Keeping ${fileName} (${filePlatform})`)
    } else {
      const size = fs.statSync(fullPath).size
      fs.unlinkSync(fullPath)
      platformRemovedSize += size
      platformRemovedCount++
      console.log(`  ✗ Removed ${fileName} (${(size / 1024).toFixed(1)} KB)`)
    }
  }
}

console.log(`  Summary: removed ${platformRemovedCount} platform packages/files (${(platformRemovedSize / (1024 * 1024)).toFixed(2)} MB)`)

// 5.2 清理文件扩展名和目录
function cleanDirectory(dirPath, patterns) {
  let cleanedCount = 0
  
  function walk(currentPath) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true })
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name)
        
        if (item.isDirectory()) {
          // 跳过 node_modules/.cache 等缓存目录
          if (item.name === '.cache' || item.name === '__tests__' || item.name === 'test' || item.name === 'tests') {
            fs.rmSync(fullPath, { recursive: true, force: true })
            cleanedCount++
            continue
          }
          walk(fullPath)
        } else {
          const ext = path.extname(item.name).toLowerCase()
          const name = item.name.toLowerCase()
          
          // 检查是否需要删除
          let shouldDelete = false
          
          // Source maps
          if (ext === '.map') {
            shouldDelete = true
          }
          // TypeScript source files (in node_modules)
          else if (ext === '.ts' && !ext.endsWith('.d.ts')) {
            shouldDelete = true
          }
          // Markdown files
          else if (ext === '.md' || name === 'readme' || name === 'changelog' || name === 'license') {
            shouldDelete = true
          }
          // Example/demo files
          else if (currentPath.includes('/examples/') || currentPath.includes('/demo/')) {
            shouldDelete = true
          }
          
          if (shouldDelete && fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath)
            cleanedCount++
          }
        }
      }
    } catch (e) {
      // 忽略错误
    }
  }
  
  walk(dirPath)
  return cleanedCount
}

const cleanedCount = cleanDirectory(optimizedPath)
console.log(`✓ Cleaned ${cleanedCount} unnecessary files`)

// Step 5.3: 优化 Prisma 引擎（根据目标平台动态保留）
console.log()
console.log('Step 5: Optimizing Prisma engines...')
const prismaEnginesPath = path.join(optimizedPath, 'node_modules', '@prisma', 'engines')
if (fs.existsSync(prismaEnginesPath)) {
  try {
    const engineFiles = fs.readdirSync(prismaEnginesPath)
    let removedEngines = 0
    let keptEngines = 0
    
    for (const file of engineFiles) {
      const filePath = path.join(prismaEnginesPath, file)
      const stats = fs.statSync(filePath)
      if (!stats.isFile()) {
        continue
      }

      // 识别引擎文件对应的平台（schema-engine-* / query-engine-* / libquery_engine-* 等，
      // 支持 .exe / .dylib.node / .so.node / 无后缀二进制）
      const filePlatform = platformManifest.prismaEnginePlatform(file)

      // 没有平台标记的文件（如 WASM、说明文件）保留
      if (!filePlatform) {
        keptEngines++
        continue
      }

      // 根据目标平台决定是否保留
      const shouldKeep = targetPlatforms.includes(filePlatform)
      if (shouldKeep) {
        keptEngines++
        console.log(`  ✓ Keeping Prisma engine: ${file} (${filePlatform})`)
      } else {
        const size = stats.size
        fs.unlinkSync(filePath)
        removedEngines++
        console.log(`  ✗ Removed Prisma engine: ${file} (${filePlatform}, ${(size / (1024 * 1024)).toFixed(2)} MB)`)
      }
    }
    
    console.log(`  Summary: Kept ${keptEngines} engines, removed ${removedEngines} engines`)
  } catch (e) {
    console.warn('⚠️  Could not optimize Prisma engines:', e.message)
  }
}

// Step 5.4: 优化 Prisma Client WASM 文件（只保留 SQLite）
console.log()
console.log('Step 6: Optimizing Prisma Client WASM files...')
const prismaClientRuntimePath = path.join(optimizedPath, 'node_modules', '@prisma', 'client', 'runtime')
if (fs.existsSync(prismaClientRuntimePath)) {
  try {
    // 定义需要保留的数据库（当前项目只使用 SQLite）
    const keepDatabases = ['sqlite']
    const removeDatabases = ['postgresql', 'mysql', 'sqlserver', 'cockroachdb']
    
    let removedFiles = 0
    let removedSize = 0
    let keptFiles = 0
    
    const runtimeFiles = fs.readdirSync(prismaClientRuntimePath)
    
    for (const file of runtimeFiles) {
      const filePath = path.join(prismaClientRuntimePath, file)
      const stats = fs.statSync(filePath)
      
      if (!stats.isFile()) {
        continue
      }
      
      // 检查文件是否属于要移除的数据库
      let shouldRemove = false
      let matchedDb = null
      
      for (const db of removeDatabases) {
        if (file.toLowerCase().includes(db)) {
          shouldRemove = true
          matchedDb = db
          break
        }
      }
      
      if (shouldRemove) {
        const size = stats.size
        fs.unlinkSync(filePath)
        removedFiles++
        removedSize += size
        console.log(`  ✗ Removed ${matchedDb} WASM: ${file} (${(size / (1024 * 1024)).toFixed(2)} MB)`)
      } else {
        keptFiles++
      }
    }
    
    console.log(`  Summary: Kept ${keptFiles} files, removed ${removedFiles} files (${(removedSize / (1024 * 1024)).toFixed(2)} MB)`)
  } catch (e) {
    console.warn('⚠️  Could not optimize Prisma Client WASM files:', e.message)
  }
}

// Step 5.5: 移除 Prisma Studio Web UI（生产环境不需要）
console.log()
console.log('Step 7: Removing Prisma Studio Web UI...')
const studioUiPath = path.join(optimizedPath, 'node_modules', '@prisma', 'studio-core', 'dist', 'ui')
if (fs.existsSync(studioUiPath)) {
  try {
    const beforeSize = getDirSize(path.dirname(studioUiPath))
    
    // 删除整个 ui 目录（Web 界面，CLI 不需要）
    fs.rmSync(studioUiPath, { recursive: true, force: true })
    
    const afterSize = getDirSize(path.dirname(studioUiPath))
    const savedSize = beforeSize - afterSize
    
    console.log(`  ✓ Removed Prisma Studio Web UI: ${(savedSize / (1024 * 1024)).toFixed(2)} MB`)
    console.log(`  Note: 'npx prisma studio' will not work, but CLI commands remain functional`)
  } catch (e) {
    console.warn('⚠️  Could not remove Prisma Studio UI:', e.message)
  }
} else {
  console.log('  ℹ️  Prisma Studio UI not found (already removed or not installed)')
}

// Step 5.6: 重建原生模块为 Electron 兼容版本（在清理之前）
console.log()
console.log('Step 6: Rebuilding native modules for Electron...')
try {
  const rebuildScript = path.join(__dirname, 'rebuild-native-electron.js')
  if (fs.existsSync(rebuildScript)) {
    console.log('Calling rebuild-native-electron.js...')
    execSync(`node "${rebuildScript}"`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env
    })
    console.log('✓ Native modules rebuilt successfully')
  } else {
    console.warn('⚠️  rebuild-native-electron.js not found, skipping rebuild')
    console.log('Please run "pnpm run rebuild:backend-native:electron" manually')
  }
} catch (error) {
  console.error('❌ Failed to rebuild native modules:', error.message)
  console.error('You can rebuild manually by running: pnpm run rebuild:backend-native:electron')
  // 不中断流程，继续后续步骤
}

// Step 5.7: 清理 better-sqlite3 编译中间文件（在重建之后）
console.log()
console.log('Step 7: Cleaning better-sqlite3 build artifacts...')
const betterSqlite3Path = path.join(optimizedPath, 'node_modules', 'better-sqlite3')
if (fs.existsSync(betterSqlite3Path)) {
  try {
    let removedSize = 0
    
    // 1. 删除 build 目录中的编译中间文件（保留 .node 文件）
    const buildPath = path.join(betterSqlite3Path, 'build')
    if (fs.existsSync(buildPath)) {
      const patternsToRemove = [
        '**/*.pdb',     // 调试符号
        '**/*.iobj',    // 增量链接对象
        '**/*.ipdb',    // 优化数据库
        '**/*.obj',     // 编译对象
        '**/*.lib',     // 静态库
        '**/*.exp',     // 导出文件
        '**/*.tlog',    // 构建日志
        '**/*.vcxproj', // Visual Studio 项目文件
        '**/*.filters', // VS 过滤器文件
        '**/*.lastbuildstate', // 最后构建状态
        '**/*.recipe',  // 配方文件
        '**/*.sln',     // 解决方案文件
        'sqlite3.c',    // SQLite3 源码副本
        'sqlite3.h',    // 头文件副本
        'sqlite3ext.h'  // 扩展头文件
      ]
      
      for (const pattern of patternsToRemove) {
        const globPath = path.join(buildPath, pattern)
        // windowsPathsNoEscape：pattern 由 path.join 拼出，Windows 上是反斜杠，而 glob 9+
        // 默认把反斜杠当转义符——不开这个开关会静默匹配不到文件，清理变成空跑
        const files = glob.sync(globPath, { nodir: true, windowsPathsNoEscape: true })
        for (const file of files) {
          try {
            const stats = fs.statSync(file)
            removedSize += stats.size
            fs.unlinkSync(file)
          } catch (e) {
            // 忽略无法删除的文件
          }
        }
      }
      
      // 清理空的子目录
      try {
        const subdirs = fs.readdirSync(buildPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => path.join(buildPath, dirent.name))
        
        for (const dir of subdirs) {
          try {
            if (fs.readdirSync(dir).length === 0) {
              fs.rmdirSync(dir)
            }
          } catch (e) {
            // 忽略非空目录
          }
        }
      } catch (e) {
        // 忽略目录遍历错误
      }
    }
    
    // 2. 删除 deps 目录（SQLite3 源码，运行时不需要）
    const depsPath = path.join(betterSqlite3Path, 'deps')
    if (fs.existsSync(depsPath)) {
      try {
        const depsSize = getDirSize(depsPath)
        removedSize += depsSize
        fs.rmSync(depsPath, { recursive: true, force: true })
      } catch (e) {
        // 忽略删除错误
      }
    }
    
    // 3. 删除 src 目录（C++ 绑定源码，运行时不需要）
    const srcPath = path.join(betterSqlite3Path, 'src')
    if (fs.existsSync(srcPath)) {
      try {
        const srcSize = getDirSize(srcPath)
        removedSize += srcSize
        fs.rmSync(srcPath, { recursive: true, force: true })
      } catch (e) {
        // 忽略删除错误
      }
    }
    
    console.log(`  ✓ Removed better-sqlite3 build artifacts: ${(removedSize / (1024 * 1024)).toFixed(2)} MB`)
    console.log(`  Kept: lib/ (JavaScript API) + build/Release/better_sqlite3.node (native module)`)
  } catch (e) {
    console.warn('⚠️  Could not clean better-sqlite3 artifacts:', e.message)
  }
} else {
  console.log('  ℹ️  better-sqlite3 not found')
}

// Step 8: 计算体积
console.log()
console.log('Step 8: Calculating size...')

const sizeInMB = (getDirSize(optimizedPath) / (1024 * 1024)).toFixed(2)
console.log(`✓ Optimized node_modules size: ${sizeInMB} MB`)

console.log()
console.log('========================================')
console.log('SUCCESS: Optimization complete!')
console.log('========================================')
console.log()
console.log('Output directory:', optimizedPath)
console.log()
console.log('Next step:')
console.log('1. Run "pnpm run build:electron" to package')

// 收尾复核：后续步骤（Prisma 生成、裁剪、原生模块重建）若改写了 watcher 二进制，
// 这里必须拦住；同时保证失败的构建不会留下有效的缓存 hash
console.log()
console.log('Final check: @parcel/watcher patch...')
ensureWatcherPatched()

// 保存缓存 hash
try {
  const hash = getDependenciesHash()
  fs.writeFileSync(path.join(optimizedPath, '.cache-hash'), hash, 'utf-8')
  console.log('\u2713 Cache hash saved for future builds')
} catch (e) {
  console.warn('\u26a0\ufe0f  Could not save cache hash:', e.message)
}
