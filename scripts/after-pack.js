/**
 * Electron Builder After Pack Hook
 * 打包后验证原生模块是否正确编译
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

module.exports = async function (context) {
  const backendPath = path.join(context.appOutDir, 'resources', 'backend-ts')
  
  if (!fs.existsSync(backendPath)) {
    console.log('Backend-ts not found in resources, skipping verification')
    return
  }
  
  console.log('Verifying native modules for Electron...')
  console.log('Backend path:', backendPath)
  
  const betterSqlite3Path = path.join(backendPath, 'node_modules_electron', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  const sqliteVecDllPath = path.join(backendPath, 'node_modules_electron', 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll')
  
  if (fs.existsSync(betterSqlite3Path)) {
    console.log('✅ better-sqlite3 native module found')
  } else {
    console.warn('⚠️  better-sqlite3 native module not found at:', betterSqlite3Path)
  }
  
  if (fs.existsSync(sqliteVecDllPath)) {
    console.log('✅ sqlite-vec DLL found')
  } else {
    console.warn('⚠️  sqlite-vec DLL not found at:', sqliteVecDllPath)
  }
  
  console.log('Native modules verification completed!')
}
