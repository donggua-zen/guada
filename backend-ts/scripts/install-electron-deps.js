/**
 * 为 Electron 环境安装依赖到 node_modules_electron 目录
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

console.log('========================================')
console.log('Installing dependencies for Electron environment')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..')
const electronNodeModulesPath = path.join(backendPath, 'node_modules_electron')
const packageJsonPath = path.join(backendPath, 'package.json')
const packageLockPath = path.join(backendPath, 'package-lock.json')
const prismaSchemaPath = path.join(backendPath, 'prisma', 'schema.prisma')
const prismaConfigPath = path.join(backendPath, 'prisma.config.ts')

// 确保目标目录存在
if (!fs.existsSync(electronNodeModulesPath)) {
  console.log('Creating isolated node_modules directory:', electronNodeModulesPath)
  fs.mkdirSync(electronNodeModulesPath, { recursive: true })
}

// 复制 package.json 和 package-lock.json 到目标目录
console.log('Step 1: Setting up package files...')

// 使用符号链接而不是复制，确保两个环境始终使用相同的 package.json
const targetPackageJson = path.join(electronNodeModulesPath, 'package.json')
const targetPackageLock = path.join(electronNodeModulesPath, 'package-lock.json')

// 如果已存在符号链接或文件，先删除
if (fs.existsSync(targetPackageJson)) {
  fs.unlinkSync(targetPackageJson)
}
if (fs.existsSync(targetPackageLock)) {
  fs.unlinkSync(targetPackageLock)
}

// 创建符号链接（Windows 需要管理员权限或使用 mklink）
try {
  // Windows: 使用 fs.symlinkSync 需要开发者模式或管理员权限
  fs.symlinkSync(packageJsonPath, targetPackageJson, 'file')
  console.log('✓ Created symlink for package.json')
  
  if (fs.existsSync(packageLockPath)) {
    fs.symlinkSync(packageLockPath, targetPackageLock, 'file')
    console.log('✓ Created symlink for package-lock.json')
  }
} catch (symlinkError) {
  // 如果符号链接失败（权限问题），回退到复制方式
  console.warn('⚠️  Symlink failed (permission?), falling back to copy...')
  fs.copyFileSync(packageJsonPath, targetPackageJson)
  console.log('✓ Copied package.json')
  
  if (fs.existsSync(packageLockPath)) {
    fs.copyFileSync(packageLockPath, targetPackageLock)
    console.log('✓ Copied package-lock.json')
  }
}

// 复制 Prisma 相关文件
console.log('Step 2: Copying Prisma files...')
const prismaDir = path.join(electronNodeModulesPath, 'prisma')
if (!fs.existsSync(prismaDir)) {
  fs.mkdirSync(prismaDir, { recursive: true })
}
if (fs.existsSync(prismaSchemaPath)) {
  fs.copyFileSync(prismaSchemaPath, path.join(prismaDir, 'schema.prisma'))
  console.log('✓ Copied prisma/schema.prisma')
}
if (fs.existsSync(prismaConfigPath)) {
  fs.copyFileSync(prismaConfigPath, path.join(electronNodeModulesPath, 'prisma.config.ts'))
  console.log('✓ Copied prisma.config.ts')
}

// 在目标目录执行 npm install
console.log()
console.log('Step 3: Installing dependencies...')
try {
  execSync('npm install --include=dev', {
    cwd: electronNodeModulesPath,
    stdio: 'inherit',
    env: process.env
  })
  
  console.log()
  console.log('Step 4: Generating Prisma Client...')
  try {
    execSync('npx prisma generate', {
      cwd: electronNodeModulesPath,
      stdio: 'inherit',
      env: process.env
    })
    console.log('✓ Prisma Client generated')
  } catch (prismaError) {
    console.warn('⚠️  Prisma generation warning:', prismaError.message)
  }
  
  console.log()
  console.log('========================================')
  console.log('SUCCESS: Dependencies installed for Electron!')
  console.log('========================================')
  console.log()
  console.log('Next step: Run "npm run rebuild:electron" to compile native modules')
} catch (error) {
  console.error()
  console.error('========================================')
  console.error('ERROR: Installation failed!')
  console.error('========================================')
  console.error(error.message)
  process.exit(1)
}
