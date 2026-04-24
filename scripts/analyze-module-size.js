/**
 * 分析 node_modules 中体积最大的模块
 */

const fs = require('fs')
const path = require('path')

const backendPath = path.join(__dirname, '..', 'backend-ts')
const nodeModulesPath = path.join(backendPath, 'node_modules_production', 'node_modules')

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

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  } else if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  } else if (bytes >= 1024) {
    return (bytes / 1024).toFixed(2) + ' KB'
  }
  return bytes + ' B'
}

console.log('========================================')
console.log('Node Modules Size Analysis')
console.log('========================================')
console.log()

if (!fs.existsSync(nodeModulesPath)) {
  console.error('Error: node_modules not found at', nodeModulesPath)
  process.exit(1)
}

const modules = []
const items = fs.readdirSync(nodeModulesPath, { withFileTypes: true })

for (const item of items) {
  if (item.isDirectory()) {
    const fullPath = path.join(nodeModulesPath, item.name)
    
    // 处理 @scope/module 格式
    if (item.name.startsWith('@')) {
      const scopeItems = fs.readdirSync(fullPath, { withFileTypes: true })
      for (const scopeItem of scopeItems) {
        if (scopeItem.isDirectory()) {
          const modulePath = path.join(fullPath, scopeItem.name)
          const size = getDirSize(modulePath)
          modules.push({
            name: `${item.name}/${scopeItem.name}`,
            size,
            path: modulePath
          })
        }
      }
    } else {
      const size = getDirSize(fullPath)
      modules.push({
        name: item.name,
        size,
        path: fullPath
      })
    }
  }
}

// 按大小排序
modules.sort((a, b) => b.size - a.size)

// 显示前 30 个最大的模块
console.log('Top 30 Largest Modules:')
console.log('-'.repeat(80))
console.log('%-40s %15s %10s', 'Module Name', 'Size', '% of Total')
console.log('-'.repeat(80))

const totalSize = modules.reduce((sum, m) => sum + m.size, 0)

for (let i = 0; i < Math.min(30, modules.length); i++) {
  const module = modules[i]
  const percentage = ((module.size / totalSize) * 100).toFixed(1)
  console.log('%-40s %15s %9s%%', module.name, formatSize(module.size), percentage)
}

console.log('-'.repeat(80))
console.log('%-40s %15s', 'Total', formatSize(totalSize))
console.log()

// 分类统计
console.log('Category Breakdown:')
console.log('-'.repeat(80))

const categories = {
  'Prisma & Database': ['@prisma', 'prisma', '.prisma', 'better-sqlite3', '@electric-sql'],
  'AI & NLP': ['tiktoken', '@huggingface', '@node-rs', 'natural', 'wordnet-db'],
  'PDF Processing': ['pdf-parse', 'pdfjs-dist', 'mammoth'],
  'NestJS Core': ['@nestjs', 'reflect-metadata', 'rxjs'],
  'Image Processing': ['sharp', '@img'],
  'Utilities': ['class-validator', 'class-transformer', 'uuid', 'bcrypt']
}

for (const [category, keywords] of Object.entries(categories)) {
  let categorySize = 0
  const matchedModules = []
  
  for (const module of modules) {
    if (keywords.some(keyword => module.name.includes(keyword))) {
      categorySize += module.size
      matchedModules.push(module.name)
    }
  }
  
  if (categorySize > 0) {
    const percentage = ((categorySize / totalSize) * 100).toFixed(1)
    console.log(`\n${category}: ${formatSize(categorySize)} (${percentage}%)`)
    matchedModules.slice(0, 5).forEach(m => {
      const mod = modules.find(mod => mod.name === m)
      console.log(`  - ${m}: ${formatSize(mod.size)}`)
    })
  }
}

console.log()
console.log('========================================')
console.log('Optimization Suggestions:')
console.log('========================================')
console.log()
console.log('1. Prisma 相关模块占用最大 (约 200MB+)')
console.log('   - 考虑使用更轻量的 ORM 或查询构建器')
console.log()
console.log('2. better-sqlite3 原生模块 (约 70MB)')
console.log('   - 这是必需的，无法优化')
console.log()
console.log('3. wordnet-db 自然语言数据库 (约 34MB)')
console.log('   - 如果不需要 natural 的词网功能，可以考虑移除')
console.log()
console.log('4. tiktoken Tokenizer (约 22MB)')
console.log('   - AI 对话必需，无法优化')
console.log()
console.log('5. pdfjs-dist PDF 渲染库 (约 16MB)')
console.log('   - 如果只是提取文本，可以使用更轻量的方案')
console.log()
