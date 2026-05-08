/**
 * 为 Electron 生产环境精简 node_modules
 * 只保留生产必需的依赖，移除开发依赖和不必要的文件
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const glob = require('glob')

console.log('========================================')
console.log('Optimizing node_modules for Electron production')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const electronNodeModulesPath = path.join(backendPath, 'node_modules_electron')
const optimizedPath = path.join(backendPath, 'node_modules_production')

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
  return crypto.createHash('md5').update(JSON.stringify(deps)).digest('hex')
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

if (isCacheValid()) {
  console.log('\u2705 Cache valid, skipping dependency installation')
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

// Step 2: 复制 package.json 并移除 devDependencies
console.log('Step 1: Creating production-only package.json...')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

// 只保留 dependencies，移除 devDependencies
const prodPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  dependencies: packageJson.dependencies,
  overrides: packageJson.overrides
}

fs.writeFileSync(
  path.join(optimizedPath, 'package.json'),
  JSON.stringify(prodPackageJson, null, 2)
)
console.log('✓ Created production package.json')

// Step 3: 安装生产依赖（不包含 devDependencies）
console.log()
console.log('Step 2: Installing production dependencies only...')
try {
  // 创建干净的环境变量，移除 electron-builder 特有的配置
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY
  
  execSync('npm install --omit=dev --include=optional', {
    cwd: optimizedPath,
    stdio: 'inherit',
    env: cleanEnv
  })
  console.log('✓ Production dependencies installed')
} catch (error) {
  console.error('❌ Installation failed:', error.message)
  process.exit(1)
}

// Step 4: 复制 Prisma schema 并生成客户端
console.log()
console.log('Step 3: Setting up Prisma...')
const prismaDir = path.join(optimizedPath, 'prisma')
fs.mkdirSync(prismaDir, { recursive: true })

const prismaSchemaPath = path.join(backendPath, 'prisma', 'schema.prisma')
if (fs.existsSync(prismaSchemaPath)) {
  fs.copyFileSync(prismaSchemaPath, path.join(prismaDir, 'schema.prisma'))
  console.log('✓ Copied prisma/schema.prisma')
}

const prismaConfigPath = path.join(backendPath, 'prisma.config.ts')
if (fs.existsSync(prismaConfigPath)) {
  fs.copyFileSync(prismaConfigPath, path.join(optimizedPath, 'prisma.config.ts'))
  console.log('✓ Copied prisma.config.ts')
} else {
  console.warn('⚠️  prisma.config.ts not found, creating default config...')
  const defaultConfig = `import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
`
  fs.writeFileSync(path.join(optimizedPath, 'prisma.config.ts'), defaultConfig)
  console.log('✓ Created default prisma.config.ts')
}

// 从原项目复用已有 prisma CLI（devDependency），避免在生产目录临时安装
console.log('Generating Prisma Client using existing CLI...')
try {
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY

  execSync('npx prisma generate', {
    cwd: backendPath,
    stdio: 'inherit',
    env: cleanEnv
  })
  console.log('✓ Prisma Client generated in source project')

  const srcPrismaClient = path.join(backendPath, 'node_modules', '.prisma')
  const destPrismaClient = path.join(optimizedPath, 'node_modules', '.prisma')
  if (fs.existsSync(srcPrismaClient)) {
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
  console.warn('Note: You may need to run "npm run rebuild:backend-native:electron" after optimization')
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

// 5.2 移除不需要的 sharp 平台特定包（根据构建目标动态保留）
console.log()
console.log('Removing unnecessary sharp platform-specific packages...')

// 检测当前构建平台
const isWindows = process.platform === 'win32'
const isMacOS = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

console.log(`  Current platform: ${process.platform} (${isWindows ? 'Windows' : isMacOS ? 'macOS' : 'Linux'})`)

// 定义所有平台包，稍后根据目标平台决定保留哪些
const allSharpPlatformPackages = [
  { name: '@img/sharp-darwin-arm64', platform: 'darwin', arch: 'arm64' },
  { name: '@img/sharp-darwin-x64', platform: 'darwin', arch: 'x64' },
  { name: '@img/sharp-libvips-darwin-arm64', platform: 'darwin', arch: 'arm64' },
  { name: '@img/sharp-libvips-darwin-x64', platform: 'darwin', arch: 'x64' },
  { name: '@img/sharp-libvips-linux-arm', platform: 'linux', arch: 'arm' },
  { name: '@img/sharp-libvips-linux-arm64', platform: 'linux', arch: 'arm64' },
  { name: '@img/sharp-libvips-linux-x64', platform: 'linux', arch: 'x64' },
  { name: '@img/sharp-linux-arm', platform: 'linux', arch: 'arm' },
  { name: '@img/sharp-linux-arm64', platform: 'linux', arch: 'arm64' },
  { name: '@img/sharp-linux-x64', platform: 'linux', arch: 'x64' },
  { name: '@img/sharp-win32-x64', platform: 'win32', arch: 'x64' },
  { name: '@img/sharp-win32-ia32', platform: 'win32', arch: 'ia32' }
]

// 确定需要保留的平台（支持多平台构建）
// 可以通过环境变量 SHARP_TARGET_PLATFORMS 指定，例如: "win32,linux"
const targetPlatforms = process.env.SHARP_TARGET_PLATFORMS
  ? process.env.SHARP_TARGET_PLATFORMS.split(',')
  : [process.platform] // 默认只保留当前平台

console.log(`  Target platforms: ${targetPlatforms.join(', ')}`)

let sharpRemovedSize = 0
let sharpKeptCount = 0

for (const pkg of allSharpPlatformPackages) {
  const packagePath = path.join(optimizedPath, 'node_modules', pkg.name)
  if (fs.existsSync(packagePath)) {
    const shouldKeep = targetPlatforms.includes(pkg.platform)
    
    if (shouldKeep) {
      sharpKeptCount++
      console.log(`  ✓ Keeping ${pkg.name} (target: ${pkg.platform}-${pkg.arch})`)
    } else {
      const size = getDirSize(packagePath)
      fs.rmSync(packagePath, { recursive: true, force: true })
      sharpRemovedSize += size
      console.log(`  ✗ Removed ${pkg.name} (${(size / (1024 * 1024)).toFixed(2)} MB)`)
    }
  }
}

console.log(`  Summary: Kept ${sharpKeptCount} packages, removed ${(sharpRemovedSize / (1024 * 1024)).toFixed(2)} MB`)

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
      // 跳过目录和非可执行文件
      const filePath = path.join(prismaEnginesPath, file)
      const stats = fs.statSync(filePath)
      if (!stats.isFile() || !file.endsWith('.exe')) {
        continue
      }
      
      // 检测文件对应的平台
      let filePlatform = null
      if (file.includes('windows') || file.includes('win32')) {
        filePlatform = 'win32'
      } else if (file.includes('linux')) {
        filePlatform = 'linux'
      } else if (file.includes('darwin') || file.includes('macos')) {
        filePlatform = 'darwin'
      }
      
      // 如果没有识别出平台，保留（可能是通用文件）
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
    console.log('Please run "npm run rebuild:backend-native:electron" manually')
  }
} catch (error) {
  console.error('❌ Failed to rebuild native modules:', error.message)
  console.error('You can rebuild manually by running: npm run rebuild:backend-native:electron')
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
        const files = glob.sync(globPath, { nodir: true })
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
console.log('1. Run "npm run build:electron" to package')

// 保存缓存 hash
try {
  const hash = getDependenciesHash()
  fs.writeFileSync(path.join(optimizedPath, '.cache-hash'), hash, 'utf-8')
  console.log('\u2713 Cache hash saved for future builds')
} catch (e) {
  console.warn('\u26a0\ufe0f  Could not save cache hash:', e.message)
}
