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

// 重建函数
function rebuildNativeModules(targetPath, targetName) {
  if (!fs.existsSync(targetPath)) {
    console.warn(`⚠️  ${targetName} does not exist, skipping...`)
    return
  }
  
  console.log()
  console.log(`Rebuilding for ${targetName}...`)
  console.log(`Target path: ${targetPath}`)
  
  // 创建临时批处理文件
  const tempBatPath = path.join(backendPath, `_temp_rebuild_${targetName.replace(/\s+/g, '_')}.bat`)
  const modulesList = nativeModules.join(' ')
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

// 动态检测 Visual Studio 路径
function findVisualStudio() {
  console.log('Step 1: Detecting Visual Studio installation...')
  
  try {
    const tempPsPath = path.join(__dirname, '_temp_find_vs.ps1')
    const psScript = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module VSSetup -ErrorAction Stop
  $instance = Get-VSSetupInstance | Select-Object -First 1
  if ($instance) {
    Write-Output $instance.InstallationPath
    exit 0
  } else {
    Write-Error "No Visual Studio instance found"
    exit 1
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`
    fs.writeFileSync(tempPsPath, psScript)
    
    try {
      const vsPath = execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tempPsPath}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()
      
      if (!vsPath) {
        throw new Error('No Visual Studio installation found')
      }
      
      console.log(`Found Visual Studio at: ${vsPath}`)
      return vsPath
    } finally {
      if (fs.existsSync(tempPsPath)) {
        fs.unlinkSync(tempPsPath)
      }
    }
  } catch (error) {
    console.error('Failed to detect Visual Studio automatically')
    console.error('Please ensure:')
    console.error('1. Visual Studio is installed with "Desktop development with C++" workload')
    console.error('2. VSSetup PowerShell module is installed: Install-Module VSSetup -Scope CurrentUser')
    throw error
  }
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
