/**
 * 对比不同 node_modules 目录的体积
 */

const fs = require('fs')
const path = require('path')

const backendPath = path.join(__dirname, '..', 'backend-ts')

function getDirSize(dirPath) {
  let size = 0
  let fileCount = 0
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      
      if (item.isDirectory()) {
        const result = getDirSize(fullPath)
        size += result.size
        fileCount += result.fileCount
      } else {
        size += fs.statSync(fullPath).size
        fileCount++
      }
    }
  } catch (e) {
    // 忽略错误
  }
  
  return { size, fileCount }
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024)
  return mb.toFixed(2) + ' MB'
}

console.log('========================================')
console.log('Node Modules Size Comparison')
console.log('========================================')
console.log()

const directories = [
  { name: 'node_modules_electron', path: path.join(backendPath, 'node_modules_electron', 'node_modules') },
  { name: 'node_modules_production', path: path.join(backendPath, 'node_modules_production') }
]

for (const dir of directories) {
  if (fs.existsSync(dir.path)) {
    const { size, fileCount } = getDirSize(dir.path)
    console.log(`📦 ${dir.name}:`)
    console.log(`   体积: ${formatSize(size)}`)
    console.log(`   文件数: ${fileCount}`)
    console.log()
  } else {
    console.log(`❌ ${dir.name}: 不存在`)
    console.log()
  }
}

console.log('========================================')
