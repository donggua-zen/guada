/**
 * Electron Builder After Pack Hook
 * 打包后验证原生模块是否正确编译（跨平台）
 */

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

  const nodeModulesPath = path.join(backendPath, 'node_modules')
  const betterSqlite3Node = path.join(
    nodeModulesPath,
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )

  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const arch = process.arch
  const sqliteVecToken = platform === 'win32' ? 'windows' : platform
  const sqliteVecPlatformDir = path.join(
    nodeModulesPath,
    `sqlite-vec-${sqliteVecToken}-${arch}`
  )

  if (fs.existsSync(betterSqlite3Node)) {
    console.log('✅ better-sqlite3 native module found')
  } else {
    console.warn('⚠️  better-sqlite3 native module not found at:', betterSqlite3Node)
  }

  if (fs.existsSync(sqliteVecPlatformDir)) {
    console.log(`✅ sqlite-vec ${platform}-${arch} binary found`)
  } else {
    console.warn('⚠️  sqlite-vec platform binary not found at:', sqliteVecPlatformDir)
  }

  console.log('Native modules verification completed!')
}
