/**
 * 验证 Electron 依赖隔离与原生模块是否正确（跨平台）
 *
 * 检查目标：backend-ts/node_modules_production（构建产物目录）
 * - 生产 node_modules 是否存在
 * - better-sqlite3 是否为 Electron ABI 编译（build/Release/better_sqlite3.node）
 * - sqlite-vec 目标平台预编译包是否存在
 */

const fs = require('fs')
const path = require('path')

console.log('========================================')
console.log('Verifying Electron Dependency Isolation Setup')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const productionNodeModulesPath = path.join(backendPath, 'node_modules_production')
const electronNodeModulesPath = path.join(productionNodeModulesPath, 'node_modules')

const platform =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const sqliteVecToken = platform === 'win32' ? 'windows' : platform
const sqliteVecPlatformName = `sqlite-vec-${sqliteVecToken}-${process.arch}`

let allPassed = true

// 检查 1: node_modules_production 目录是否存在
console.log('Check 1: node_modules_production directory exists')
if (fs.existsSync(productionNodeModulesPath)) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: Directory not found (run "pnpm run optimize:electron-deps" first)')
  allPassed = false
}
console.log()

// 检查 2: better-sqlite3 是否安装
console.log('Check 2: better-sqlite3 installed')
const betterSqlite3Path = path.join(electronNodeModulesPath, 'better-sqlite3')
if (fs.existsSync(betterSqlite3Path)) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: better-sqlite3 not found')
  allPassed = false
}
console.log()

// 检查 3: better-sqlite3 原生模块是否编译
console.log('Check 3: better-sqlite3 native module compiled')
const betterSqlite3NodePath = path.join(betterSqlite3Path, 'build', 'Release', 'better_sqlite3.node')
if (fs.existsSync(betterSqlite3NodePath)) {
  console.log('✅ PASS')
  console.log(`   File: ${betterSqlite3NodePath}`)
} else {
  console.log('❌ FAIL: better_sqlite3.node not found')
  console.log('   Run: pnpm run rebuild:backend-native:electron')
  allPassed = false
}
console.log()

// 检查 4: sqlite-vec 是否安装
console.log('Check 4: sqlite-vec installed')
const sqliteVecPath = path.join(electronNodeModulesPath, 'sqlite-vec')
if (fs.existsSync(sqliteVecPath)) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: sqlite-vec not found')
  allPassed = false
}
console.log()

// 检查 5: sqlite-vec 目标平台预编译包是否存在
console.log(`Check 5: sqlite-vec ${platform}-${process.arch} binary exists`)
const sqliteVecPlatformPath = path.join(electronNodeModulesPath, sqliteVecPlatformName)
if (fs.existsSync(sqliteVecPlatformPath)) {
  console.log('✅ PASS')
  console.log(`   Package: ${sqliteVecPlatformName}`)
} else {
  console.log(`❌ FAIL: ${sqliteVecPlatformName} not found`)
  console.log('   Delete node_modules_production and rerun "pnpm run optimize:electron-deps"')
  allPassed = false
}
console.log()

// 总结
console.log('========================================')
if (allPassed) {
  console.log('✅ ALL CHECKS PASSED')
  console.log('========================================')
  console.log()
  console.log('Electron dependency isolation is correctly set up!')
  console.log('You can now run: pnpm run dev:electron')
  process.exit(0)
} else {
  console.log('❌ SOME CHECKS FAILED')
  console.log('========================================')
  console.log()
  console.log('Please follow the setup instructions:')
  console.log('1. pnpm run optimize:electron-deps')
  console.log('2. pnpm run rebuild:backend-native:electron')
  process.exit(1)
}
