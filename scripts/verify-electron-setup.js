/**
 * 验证 Electron 依赖隔离设置是否正确
 */

const fs = require('fs')
const path = require('path')

console.log('========================================')
console.log('Verifying Electron Dependency Isolation Setup')
console.log('========================================')
console.log()

const backendPath = path.join(__dirname, '..', 'backend-ts')
const electronNodeModulesPath = path.join(backendPath, 'node_modules_electron', 'node_modules')

let allPassed = true

// 检查 1: node_modules_electron 目录是否存在
console.log('Check 1: node_modules_electron directory exists')
if (fs.existsSync(path.join(backendPath, 'node_modules_electron'))) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: Directory not found')
  allPassed = false
}
console.log()

// 检查 2: package.json 是否已复制
console.log('Check 2: package.json copied to node_modules_electron')
if (fs.existsSync(path.join(backendPath, 'node_modules_electron', 'package.json'))) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: package.json not found')
  allPassed = false
}
console.log()

// 检查 3: better-sqlite3 是否安装
console.log('Check 3: better-sqlite3 installed')
const betterSqlite3Path = path.join(electronNodeModulesPath, 'better-sqlite3')
if (fs.existsSync(betterSqlite3Path)) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: better-sqlite3 not found')
  allPassed = false
}
console.log()

// 检查 4: better-sqlite3 原生模块是否编译
console.log('Check 4: better-sqlite3 native module compiled')
const betterSqlite3NodePath = path.join(betterSqlite3Path, 'build', 'Release', 'better_sqlite3.node')
if (fs.existsSync(betterSqlite3NodePath)) {
  console.log('✅ PASS')
  console.log(`   File: ${betterSqlite3NodePath}`)
} else {
  console.log('❌ FAIL: better_sqlite3.node not found')
  console.log('   Run: npm run rebuild:backend-native:electron')
  allPassed = false
}
console.log()

// 检查 5: sqlite-vec 是否安装
console.log('Check 5: sqlite-vec installed')
const sqliteVecPath = path.join(electronNodeModulesPath, 'sqlite-vec')
if (fs.existsSync(sqliteVecPath)) {
  console.log('✅ PASS')
} else {
  console.log('❌ FAIL: sqlite-vec not found')
  allPassed = false
}
console.log()

// 检查 6: sqlite-vec-windows-x64 DLL 是否存在
console.log('Check 6: sqlite-vec-windows-x64 DLL exists')
const sqliteVecDllPath = path.join(electronNodeModulesPath, 'sqlite-vec-windows-x64', 'vec0.dll')
if (fs.existsSync(sqliteVecDllPath)) {
  console.log('✅ PASS')
  console.log(`   File: ${sqliteVecDllPath}`)
} else {
  console.log('❌ FAIL: vec0.dll not found')
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
  console.log('You can now run: npm run dev:electron')
  process.exit(0)
} else {
  console.log('❌ SOME CHECKS FAILED')
  console.log('========================================')
  console.log()
  console.log('Please follow the setup instructions:')
  console.log('1. npm run install:electron-deps')
  console.log('2. npm run rebuild:backend-native:electron')
  process.exit(1)
}
