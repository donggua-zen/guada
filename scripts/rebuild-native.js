/**
 * 重新编译 backend-ts 的原生模块以匹配 Electron 版本
 * 自动检测并设置 Visual Studio 环境
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Electron 版本配置
const ELECTRON_VERSION = '41.2.2'
const TARGET_ARCH = 'x64'

console.log('========================================')
console.log('Rebuilding native modules for Electron')
console.log('========================================')
console.log()

// 动态检测 Visual Studio 路径
function findVisualStudio() {
  console.log('Step 1: Detecting Visual Studio installation...')
  
  try {
    // 创建临时 PowerShell 脚本
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
      // 清理临时文件
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

// 检查 vcvarsall.bat 是否存在
if (!fs.existsSync(vcvarsallPath)) {
  console.error(`ERROR: vcvarsall.bat not found at ${vcvarsallPath}`)
  process.exit(1)
}

console.log('Step 2: Setting up Visual Studio environment...')

// 创建临时批处理文件来设置环境变量并执行 npm rebuild
const tempBatPath = path.join(__dirname, '..', 'backend-ts', '_temp_rebuild.bat')
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
npm rebuild better-sqlite3 sqlite-vec
exit /b %errorlevel%
`

fs.writeFileSync(tempBatPath, batContent)

try {
  console.log('Step 3: Rebuilding native modules...')
  console.log(`Target: Electron ${ELECTRON_VERSION} (${TARGET_ARCH})`)
  console.log()
  
  execSync(tempBatPath, {
    cwd: path.join(__dirname, '..', 'backend-ts'),
    stdio: 'inherit',
    env: process.env
  })
  
  console.log()
  console.log('========================================')
  console.log('SUCCESS: Native modules rebuilt!')
  console.log('========================================')
} catch (error) {
  console.error()
  console.error('========================================')
  console.error('ERROR: Rebuild failed!')
  console.error('========================================')
  process.exit(1)
} finally {
  // 清理临时文件
  if (fs.existsSync(tempBatPath)) {
    fs.unlinkSync(tempBatPath)
  }
}
