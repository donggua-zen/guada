/**
 * 为 Electron 环境重新编译 backend-ts 的原生模块
 * 将编译结果输出到独立的 node_modules_electron 目录
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Electron 版本配置
const ELECTRON_VERSION = '41.2.2'
const TARGET_ARCH = 'x64'

console.log('========================================')
console.log('Rebuilding native modules for Electron (isolated)')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const productionNodeModulesPath = path.join(backendPath, 'node_modules_production')

// 需要重建的原生模块列表
// sharp 使用预编译二进制文件，不需要重新编译
const nativeModules = ['better-sqlite3', 'sqlite-vec', '@node-rs/jieba']

// 检查原生模块是否已为正确的 Electron 版本编译
function isModuleBuiltForElectron(modulePath, electronVersion, arch) {
  if (!fs.existsSync(modulePath)) {
    return false
  }
  
  // 对于 better-sqlite3，检查 .node 文件是否存在
  if (modulePath.includes('better-sqlite3')) {
    const nodeFile = path.join(modulePath, 'build', 'Release', 'better_sqlite3.node')
    if (!fs.existsSync(nodeFile)) {
      return false
    }
    
    // 注意：这里无法直接检查 ABI 版本，只能通过重新编译来确保
    // 返回 false 强制重新编译
    return false
  }
  
  // 对于 sqlite-vec 和 @node-rs/jieba，它们是预编译的，不需要重新编译
  return true
}

// 检查是否已经执行过优化（通过检查缓存文件）
function isOptimizationDone() {
  const cacheHashPath = path.join(productionNodeModulesPath, '.cache-hash')
  // 只有当 node_modules 存在且有缓存文件时才跳过
  return fs.existsSync(productionNodeModulesPath) && fs.existsSync(cacheHashPath)
}

// 重建函数
function rebuildNativeModules(targetPath, targetName) {
  if (!fs.existsSync(targetPath)) {
    console.warn(`⚠️  ${targetName} does not exist, skipping...`)
    return
  }
  
  // 检查是否已经执行过优化（有缓存文件说明已处理过）
  if (isOptimizationDone()) {
    console.log()
    console.log('✓ Optimization cache found, skipping native module rebuild')
    console.log('  (Delete node_modules_production/.cache-hash to force rebuild)')
    return
  }
  
  console.log()
  console.log(`Checking native modules for ${targetName}...`)
  console.log(`Target: Electron ${ELECTRON_VERSION} (${TARGET_ARCH})`)
  
  // 检查是否所有模块都已正确编译
  let allModulesBuilt = true
  const modulesToRebuild = []
  
  for (const moduleName of nativeModules) {
    const modulePath = path.join(targetPath, 'node_modules', moduleName)
    if (!isModuleBuiltForElectron(modulePath, ELECTRON_VERSION, TARGET_ARCH)) {
      allModulesBuilt = false
      modulesToRebuild.push(moduleName)
      console.log(`  ⚠️  ${moduleName} needs rebuilding`)
    } else {
      console.log(`  ✓ ${moduleName} already built`)
    }
  }
  
  if (allModulesBuilt) {
    console.log('✓ All native modules are already built')
    return
  }
  
  console.log()
  console.log(`Rebuilding modules: ${modulesToRebuild.join(', ')}`)
  
  // 创建临时批处理文件
  const tempBatPath = path.join(backendPath, `_temp_rebuild_${targetName.replace(/\s+/g, '_')}.bat`)
  const modulesList = modulesToRebuild.join(' ')
  const batContent = `@echo off
call "${vcvarsallPath}" x64
if errorlevel 1 exit /b 1
echo VCINSTALLDIR=%VCINSTALLDIR%
set npm_config_target=${ELECTRON_VERSION}
set npm_config_arch=${TARGET_ARCH}
set npm_config_target_arch=${TARGET_ARCH}
set npm_config_disturl=https://electronjs.org/headers
set npm_config_runtime=electron
set npm_config_build_from_source=true
cd "${targetPath}"
npm rebuild ${modulesList}
exit /b %errorlevel%
`
  
  fs.writeFileSync(tempBatPath, batContent)
  
  try {
    execSync(tempBatPath, {
      cwd: backendPath,
      stdio: 'inherit',
      env: process.env
    })
    
    console.log(`✓ ${targetName} native modules rebuilt`)
  } catch (error) {
    console.error(`❌ Failed to rebuild ${targetName}:`, error.message)
    throw error
  } finally {
    if (fs.existsSync(tempBatPath)) {
      fs.unlinkSync(tempBatPath)
    }
  }
}

// 动态检测 Visual Studio 路径（使用 vswhere.exe，比 VSSetup PowerShell 模块更可靠）
function findVisualStudio() {
  console.log('Step 1: Detecting Visual Studio installation...')
  
  // 可能的 vswhere 路径
  const vswhereCandidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(__dirname, '..', 'vswhere.exe')
  ]
  
  let vswherePath = null
  for (const candidate of vswhereCandidates) {
    if (fs.existsSync(candidate)) {
      vswherePath = candidate
      break
    }
  }
  
  if (vswherePath) {
    try {
      const vsPath = execSync(`"${vswherePath}" -latest -property installationPath`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()
      
      if (vsPath && fs.existsSync(vsPath)) {
        console.log(`Found Visual Studio at: ${vsPath}`)
        return vsPath
      }
    } catch (e) {
      // fall through to fallback
    }
  }
  
  // 回退方案：检查常见安装路径
  const commonPaths = [
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
    'D:\\Program Files\\Microsoft Visual Studio\\18\\Community',
    'D:\\Program Files\\Microsoft Visual Studio\\17\\Community',
    'D:\\Program Files\\Microsoft Visual Studio\\16\\Community'
  ]
  
  for (const vsPath of commonPaths) {
    const vcvarsall = path.join(vsPath, 'VC\\Auxiliary\\Build\\vcvarsall.bat')
    if (fs.existsSync(vcvarsall)) {
      console.log(`Found Visual Studio at: ${vsPath}`)
      return vsPath
    }
  }
  
  console.error('Failed to detect Visual Studio automatically')
  console.error('Please ensure:')
  console.error('1. Visual Studio is installed with "Desktop development with C++" workload')
  throw new Error('No Visual Studio installation found')
}

const vsPath = findVisualStudio()
const vcvarsallPath = path.join(vsPath, 'VC\\Auxiliary\\Build\\vcvarsall.bat')

if (!fs.existsSync(vcvarsallPath)) {
  console.error(`ERROR: vcvarsall.bat not found at ${vcvarsallPath}`)
  process.exit(1)
}

console.log('Step 2: Setting up Visual Studio environment...')

try {
  console.log('Step 3: Rebuilding native modules...')
  console.log(`Target: Electron ${ELECTRON_VERSION} (${TARGET_ARCH})`)
  console.log()
  
  // 为 node_modules_production 重建
  rebuildNativeModules(productionNodeModulesPath, 'node_modules_production')
  
  console.log()
  console.log('========================================')
  console.log('SUCCESS: Native modules rebuilt for Electron!')
  console.log('========================================')
} catch (error) {
  console.error()
  console.error('========================================')
  console.error('ERROR: Rebuild failed!')
  console.error('========================================')
  process.exit(1)
}
