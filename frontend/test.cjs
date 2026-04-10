// memory-investigator.cjs
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const path = require('path')

// 可疑包列表，按类型分类
const suspects = {
  // 构建工具核心
  buildCore: ['vite', '@vitejs/plugin-vue'],
  
  // CSS相关
  cssRelated: ['@tailwindcss/vite', 'tailwindcss'],
  
  // 自动导入插件
  autoImport: ['unplugin-vue-components', 'unplugin-auto-import'],
  
  // 构建分析工具
  buildAnalysis: ['rollup-plugin-visualizer'],
  
  // 构建优化插件
  buildOptimization: ['vite-plugin-clean', 'vite-plugin-inspect'],
  
  // UI框架
  uiFrameworks: ['element-plus', 'vue'],
  
  // 图标库
  iconLibraries: [
    '@vicons/antd', 
    '@vicons/fluent', 
    '@vicons/ionicons4', 
    '@vicons/ionicons5', 
    '@vicons/material'
  ],
  
  // 图片处理
  imageProcessing: [
    'vue-advanced-cropper',
    'vue-cropper', 
    'vue-cropperjs',
    'cropperjs'
  ]
}

console.log('🔍 内存问题深度排查脚本\n')

// 记录内存使用情况
let memoryStats = []

// 1. 系统信息检查
function checkSystemInfo() {
  console.log('=== 系统信息检查 ===')
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim()
    const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim()
    const osInfo = process.platform === 'win32' 
      ? execSync('systeminfo | findstr /B /C:"OS 名称" /C:"OS 版本"', { encoding: 'utf8' })
      : execSync('uname -a', { encoding: 'utf8' })
    
    console.log(`Node版本: ${nodeVersion}`)
    console.log(`npm版本: ${npmVersion}`)
    console.log(`系统信息: ${osInfo}`)
    
    // 检查内存
    if (process.platform === 'win32') {
      const memoryInfo = execSync('wmic memorychip get capacity', { encoding: 'utf8' })
      console.log(`内存信息: ${memoryInfo}`)
    }
  } catch (error) {
    console.log('系统信息检查失败:', error.message)
  }
  console.log('')
}

// 2. 项目规模分析
function analyzeProjectSize() {
  console.log('=== 项目规模分析 ===')
  try {
    // 统计文件数量
    const srcFiles = execSync('find src -name "*.vue" -o -name "*.js" -o -name "*.ts" | wc -l', { encoding: 'utf8' }).trim()
    const totalFiles = execSync('find src -type f | wc -l', { encoding: 'utf8' }).trim()
    
    // 目录大小
    const srcSize = execSync('du -sh src 2>/dev/null || echo "N/A"', { encoding: 'utf8' }).trim()
    const nodeModulesSize = execSync('du -sh node_modules 2>/dev/null || echo "N/A"', { encoding: 'utf8' }).trim()
    
    console.log(`Vue/JS/TS文件数: ${srcFiles}`)
    console.log(`src目录总文件数: ${totalFiles}`)
    console.log(`src目录大小: ${srcSize}`)
    console.log(`node_modules大小: ${nodeModulesSize}`)
    
    // 检查是否有大文件
    const largeFiles = execSync('find src -size +1M -type f 2>/dev/null || echo "无大文件"', { encoding: 'utf8' })
    console.log(`大文件检测: ${largeFiles}`)
  } catch (error) {
    console.log('项目规模分析失败:', error.message)
  }
  console.log('')
}

// 3. 依赖版本分析
function analyzeDependencyVersions() {
  console.log('=== 依赖版本分析 ===')
  
  Object.keys(suspects).forEach(category => {
    console.log(`\n${category}:`)
    suspects[category].forEach(pkg => {
      try {
        const versionInfo = execSync(`npm list ${pkg} --depth=0`, { encoding: 'utf8' })
        const versionMatch = versionInfo.match(new RegExp(`${pkg}@([^\\s]+)`))
        console.log(`  ${pkg}: ${versionMatch ? versionMatch[1] : '未安装'}`)
      } catch (error) {
        console.log(`  ${pkg}: 检查失败`)
      }
    })
  })
  console.log('')
}

// 4. 创建特定包的测试配置
function createTestConfig(packages, category) {
  const configParts = []
  
  configParts.push("import { defineConfig } from 'vite'")
  configParts.push("import vue from '@vitejs/plugin-vue'")
  configParts.push("import path from 'path'")
  
  // 添加特定包的导入
  if (packages.includes('@tailwindcss/vite')) {
    configParts.push("import tailwind from '@tailwindcss/vite'")
  }
  if (packages.includes('unplugin-vue-components')) {
    configParts.push("import Components from 'unplugin-vue-components/vite'")
  }
  if (packages.includes('unplugin-auto-import')) {
    configParts.push("import AutoImport from 'unplugin-auto-import/vite'")
  }
  if (packages.includes('rollup-plugin-visualizer')) {
    configParts.push("import { visualizer } from 'rollup-plugin-visualizer'")
  }
  if (packages.includes('vite-plugin-clean')) {
    configParts.push("import clean from 'vite-plugin-clean'")
  }
  if (packages.includes('vite-plugin-inspect')) {
    configParts.push("import Inspect from 'vite-plugin-inspect'")
  }
  
  configParts.push("")
  configParts.push("export default defineConfig({")
  configParts.push("  plugins: [")
  configParts.push("    vue(),")
  
  // 添加特定包的插件配置
  if (packages.includes('@tailwindcss/vite')) {
    configParts.push("    tailwind(),")
  }
  if (packages.includes('unplugin-vue-components')) {
    configParts.push("    Components({ resolvers: [] }),")
  }
  if (packages.includes('unplugin-auto-import')) {
    configParts.push("    AutoImport({ imports: ['vue'] }),")
  }
  if (packages.includes('rollup-plugin-visualizer')) {
    configParts.push("    visualizer({ open: false }),")
  }
  if (packages.includes('vite-plugin-clean')) {
    configParts.push("    clean({ cleanOnceBeforeBuildPatterns: ['dist/*'] }),")
  }
  if (packages.includes('vite-plugin-inspect')) {
    configParts.push("    Inspect(),")
  }
  
  configParts.push("  ],")
  configParts.push("  resolve: {")
  configParts.push("    alias: {")
  configParts.push("      '@': path.resolve(__dirname, './src'),")
  configParts.push("    },")
  configParts.push("  },")
  configParts.push("  build: {")
  configParts.push("    minify: false,")
  configParts.push("    sourcemap: false")
  configParts.push("  }")
  configParts.push("})")
  
  return configParts.join('\n')
}

// 5. 内存监控构建函数
function buildWithMemoryMonitoring(configName, packages, category) {
  return new Promise((resolve) => {
    console.log(`\n🧪 测试: ${category} (${packages.join(', ')})`)
    
    const configFile = `vite-test-${configName}.js`
    const testConfig = createTestConfig(packages, category)
    fs.writeFileSync(configFile, testConfig)
    
    // 创建测试入口文件
    const testEntry = `
// main.js
import { createApp } from 'vue'
${packages.includes('element-plus') ? "import ElementPlus from 'element-plus'" : ""}
${packages.includes('@vicons/antd') ? "import { IconName } from '@vicons/antd'" : ""}

const app = createApp({
  template: '<div>测试应用</div>',
  mounted() {
    console.log('应用已加载')
  }
})

${packages.includes('element-plus') ? "app.use(ElementPlus)" : ""}
app.mount('#app')
`
    fs.writeFileSync('test-main.js', testEntry)
    fs.writeFileSync('test-index.html', '<div id="app"></div>')
    
    let startMemory = process.memoryUsage().heapUsed
    const startTime = Date.now()
    let maxMemory = 0
    
    // 内存监控
    const memoryInterval = setInterval(() => {
      const currentMemory = process.memoryUsage().heapUsed
      maxMemory = Math.max(maxMemory, currentMemory)
    }, 100)
    
    try {
      const result = execSync(
        `node --max-old-space-size=2048 node_modules/vite/bin/vite.js build --config ${configFile} 2>&1`,
        { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      )
      
      clearInterval(memoryInterval)
      const endTime = Date.now()
      const duration = endTime - startTime
      
      const memoryUsageMB = (maxMemory - startMemory) / 1024 / 1024
      
      memoryStats.push({
        category,
        packages,
        duration,
        memoryMB: Math.round(memoryUsageMB * 100) / 100,
        success: true
      })
      
      console.log(`构建成功 - 耗时: ${duration}ms, 内存峰值: ${memoryUsageMB.toFixed(2)}MB`)
      
      if (result.includes('warning') || result.includes('WARN')) {
        console.log(`  警告信息: ${result.match(/(warning|WARN).*/gi)?.slice(0, 3).join(', ') || '无'}`)
      }
      
    } catch (error) {
      clearInterval(memoryInterval)
      const endTime = Date.now()
      const duration = endTime - startTime
      
      memoryStats.push({
        category,
        packages,
        duration,
        memoryMB: -1, // 错误标记
        success: false,
        error: error.message
      })
      
      console.log(`❌ 构建失败 - 耗时: ${duration}ms`)
      console.log(`   错误: ${error.message.split('\n')[0]}`)
    }
    
    // 清理文件
    try {
      fs.unlinkSync(configFile)
      fs.unlinkSync('test-main.js')
      fs.unlinkSync('test-index.html')
      fs.unlinkSync('dist/test-main.js')
      fs.rmSync('dist', { recursive: true, force: true })
    } catch (e) {
      // 忽略清理错误
    }
    
    resolve()
  })
}

// 6. 渐进式测试
async function progressiveTesting() {
  console.log('\n=== 渐进式构建测试 ===')
  
  // 测试1: 最小化构建（基线）
  await buildWithMemoryMonitoring('minimal', [], '最小化构建')
  
  // 测试2: 核心构建工具
  await buildWithMemoryMonitoring('core', suspects.buildCore, '核心构建工具')
  
  // 测试3: 逐个添加包类别
  for (const [category, packages] of Object.entries(suspects)) {
    if (category !== 'buildCore') {
      await buildWithMemoryMonitoring(category, [...suspects.buildCore, ...packages], category)
    }
  }
  
  // 测试4: 完整配置（模拟真实项目）
  const allPackages = Object.values(suspects).flat()
  await buildWithMemoryMonitoring('full', allPackages, '完整配置')
}

// 7. 结果分析
function analyzeResults() {
  console.log('\n=== 测试结果分析 ===')
  
  if (memoryStats.length === 0) {
    console.log('无测试数据')
    return
  }
  
  // 按内存使用排序
  const sortedByMemory = [...memoryStats].filter(s => s.success).sort((a, b) => b.memoryMB - a.memoryMB)
  const sortedByDuration = [...memoryStats].filter(s => s.success).sort((a, b) => b.duration - a.duration)
  
  console.log('\n📊 内存使用排名:')
  sortedByMemory.slice(0, 5).forEach((stat, index) => {
    console.log(`  ${index + 1}. ${stat.category}: ${stat.memoryMB}MB (${stat.duration}ms)`)
  })
  
  console.log('\n⏱️ 构建时间排名:')
  sortedByDuration.slice(0, 5).forEach((stat, index) => {
    console.log(`  ${index + 1}. ${stat.category}: ${stat.duration}ms (${stat.memoryMB}MB)`)
  })
  
  console.log('\n❌ 失败的构建:')
  memoryStats.filter(s => !s.success).forEach(stat => {
    console.log(`  ${stat.category}: ${stat.error}`)
  })
  
  // 识别问题包
  const baseline = memoryStats.find(s => s.category === '最小化构建')
  if (baseline && baseline.success) {
    console.log('\n🔍 问题包识别:')
    
    Object.keys(suspects).forEach(category => {
      if (category !== '最小化构建') {
        const testStat = memoryStats.find(s => s.category === category)
        if (testStat && testStat.success && baseline.success) {
          const memoryIncrease = testStat.memoryMB - baseline.memoryMB
          if (memoryIncrease > 100) { // 内存增加超过100MB视为有问题
            console.log(`  ⚠️  ${category}: 内存增加 ${memoryIncrease.toFixed(2)}MB`)
          }
        }
      }
    })
  }
}

// 8. 生成修复建议
function generateRecommendations() {
  console.log('\n=== 修复建议 ===')
  
  const highMemoryTests = memoryStats
    .filter(s => s.success && s.memoryMB > 500)
    .sort((a, b) => b.memoryMB - a.memoryMB)
  
  if (highMemoryTests.length > 0) {
    console.log('🔴 高内存消耗的包:')
    highMemoryTests.forEach(test => {
      console.log(`  - ${test.category} (${test.memoryMB}MB)`)
    })
    
    console.log('\n💡 建议操作:')
    console.log('1. 移除或降级高内存消耗的包')
    console.log('2. 使用更轻量级的替代方案')
    console.log('3. 在开发和生产环境使用不同的配置')
  }
  
  const failedTests = memoryStats.filter(s => !s.success)
  if (failedTests.length > 0) {
    console.log('\n🔴 构建失败的包:')
    failedTests.forEach(test => {
      console.log(`  - ${test.category}: ${test.error}`)
    })
    
    console.log('\n💡 建议操作:')
    console.log('1. 检查这些包的兼容性')
    console.log('2. 查看官方文档是否有已知问题')
    console.log('3. 考虑使用稳定版本而非最新版本')
  }
  
  // 特定包的建议
  if (memoryStats.some(s => s.packages && s.packages.includes('@tailwindcss/vite'))) {
    console.log('\n🎯 针对 Tailwind CSS v4 的建议:')
    console.log('  考虑降级到 Tailwind CSS v3:')
    console.log('  npm uninstall @tailwindcss/vite tailwindcss')
    console.log('  npm install -D tailwindcss@^3.3.0 postcss autoprefixer')
  }
  
  console.log('\n🛠️ 通用优化建议:')
  console.log('1. 分离开发和生产环境的依赖')
  console.log('2. 使用 externals 排除大型库')
  console.log('3. 启用代码分割和懒加载')
  console.log('4. 定期清理 node_modules 和缓存')
}

// 主执行函数
async function main() {
  try {
    // 检查当前目录是否是有效项目
    if (!fs.existsSync('package.json')) {
      console.log('❌ 请在项目根目录运行此脚本')
      return
    }
    
    console.log('开始内存问题排查...\n')
    
    // 执行各个检查阶段
    checkSystemInfo()
    analyzeProjectSize()
    analyzeDependencyVersions()
    
    // 进行渐进式测试
    await progressiveTesting()
    
    // 分析结果
    analyzeResults()
    generateRecommendations()
    
    console.log('\n排查完成')
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error.message)
  }
}

// 运行主函数
main()