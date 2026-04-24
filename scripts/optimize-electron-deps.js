/**
 * 为 Electron 生产环境精简 node_modules
 * 只保留生产必需的依赖，移除开发依赖和不必要的文件
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

console.log('========================================')
console.log('Optimizing node_modules for Electron production')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const electronNodeModulesPath = path.join(backendPath, 'node_modules_electron')
const optimizedPath = path.join(backendPath, 'node_modules_production')

// Step 1: 创建临时目录
if (fs.existsSync(optimizedPath)) {
  console.log('Cleaning existing optimized directory...')
  fs.rmSync(optimizedPath, { recursive: true, force: true })
}
fs.mkdirSync(optimizedPath, { recursive: true })

// Step 2: 复制 package.json 并移除 devDependencies
console.log('Step 1: Creating production-only package.json...')
const packageJsonPath = path.join(backendPath, 'package.json')
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
  
  execSync('npm install --omit=dev --omit=optional', {
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
}

// 先安装 Prisma CLI（临时）
console.log('Installing Prisma CLI for client generation...')
try {
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY
  
  execSync('npm install --no-save prisma@^7.6.0', {
    cwd: optimizedPath,
    stdio: 'pipe',
    env: cleanEnv
  })
  console.log('✓ Prisma CLI installed temporarily')
} catch (error) {
  console.warn('⚠️  Prisma CLI installation warning:', error.message)
}

try {
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_MIRROR
  delete cleanEnv.ELECTRON_BUILDER_BINARIES_MIRROR
  delete cleanEnv.WIN_CSC_IDENTITY_AUTO_DISCOVERY
  
  execSync('npx prisma generate', {
    cwd: optimizedPath,
    stdio: 'inherit',
    env: cleanEnv
  })
  console.log('✓ Prisma Client generated')
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
  // Prisma Studio (开发工具，生产环境不需要)
  { path: 'node_modules/@prisma/studio-core', reason: 'Prisma Studio UI' },
  { path: 'node_modules/@prisma/dev', reason: 'Prisma dev tools' },
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

// Step 5.3: 优化 Prisma 引擎（只保留当前平台）
console.log()
console.log('Step 5: Optimizing Prisma engines...')
const prismaEnginesPath = path.join(optimizedPath, 'node_modules', '@prisma', 'engines')
if (fs.existsSync(prismaEnginesPath)) {
  try {
    const engineFiles = fs.readdirSync(prismaEnginesPath)
    let removedEngines = 0
    for (const file of engineFiles) {
      // 保留 Windows x64 引擎，移除其他平台
      if (!file.includes('windows') && !file.includes('win32') && file.endsWith('.exe')) {
        const filePath = path.join(prismaEnginesPath, file)
        const stats = fs.statSync(filePath)
        fs.unlinkSync(filePath)
        removedEngines++
      }
    }
    if (removedEngines > 0) {
      console.log(`✓ Removed ${removedEngines} unnecessary Prisma engine binaries`)
    }
  } catch (e) {
    console.warn('⚠️  Could not optimize Prisma engines:', e.message)
  }
}

// Step 6: 计算体积
console.log()
console.log('Step 5: Calculating size...')
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
    // 忽略错误
  }
  return size
}

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
console.log('1. Update package.json extraResources to use "node_modules_production"')
console.log('2. Run "npm run rebuild:backend-native:electron" to rebuild native modules')
console.log('3. Run "npm run build:electron" to rebuild')
