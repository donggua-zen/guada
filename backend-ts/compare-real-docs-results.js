const fs = require('fs');
const path = require('path');

// 读取 Python 和 TypeScript 的测试结果
const pythonResultsPath = path.join(__dirname, '..', 'backend', 'tests', 'verification', 'bm25_real_docs_results.json');
const tsResultsPath = path.join(__dirname, 'bm25_real_docs_ts_results.json');

console.log('=== 真实文档 BM25 对比分析 ===\n');

if (!fs.existsSync(pythonResultsPath)) {
  console.error('❌ 未找到 Python 端结果文件');
  process.exit(1);
}

if (!fs.existsSync(tsResultsPath)) {
  console.error('❌ 未找到 TypeScript 端结果文件');
  process.exit(1);
}

const pythonData = JSON.parse(fs.readFileSync(pythonResultsPath, 'utf-8'));
const tsData = JSON.parse(fs.readFileSync(tsResultsPath, 'utf-8'));

console.log(`Python 端: ${pythonData.total_documents} 个文档`);
console.log(`TypeScript 端: ${tsData.results[0]?.total_docs || 0} 个文档`);
console.log();

// 对比每个查询
pythonData.results.forEach((pyResult, idx) => {
  const tsResult = tsData.results[idx];
  
  if (!tsResult || pyResult.query_name !== tsResult.query_name) {
    console.warn(`⚠️  查询不匹配: ${pyResult.query_name}`);
    return;
  }
  
  console.log(`查询 ${idx + 1}: ${pyResult.query_name}`);
  console.log(`  查询词: "${pyResult.query}"`);
  console.log(`  Python 匹配: ${pyResult.matched_docs}/${pyResult.total_docs}`);
  console.log(`  TS     匹配: ${tsResult.matched_docs}/${tsResult.total_docs}`);
  
  // 对比 Top-5
  console.log(`\n  Top-5 对比:`);
  console.log(`  排名 | Python 文档                           | 分数    | TS 文档                              | 分数    | 一致`);
  console.log(`  -----|--------------------------------------|---------|-------------------------------------|---------|-----`);
  
  const maxLen = Math.min(5, pyResult.top_results.length, tsResult.top_results.length);
  let consistentCount = 0;
  
  for (let i = 0; i < maxLen; i++) {
    const pyTop = pyResult.top_results[i];
    const tsTop = tsResult.top_results[i];
    
    const isConsistent = pyTop.path === tsTop.path;
    if (isConsistent) consistentCount++;
    
    const pyPathShort = pyTop.path.length > 36 ? pyTop.path.substring(0, 33) + '...' : pyTop.path.padEnd(36);
    const tsPathShort = tsTop.path.length > 36 ? tsTop.path.substring(0, 33) + '...' : tsTop.path.padEnd(36);
    
    console.log(`  ${String(i+1).padEnd(4)} | ${pyPathShort} | ${pyTop.score.toFixed(4).padEnd(7)} | ${tsPathShort} | ${tsTop.score.toFixed(4).padEnd(7)} | ${isConsistent ? '✅' : '❌'}`);
  }
  
  const consistencyRate = (consistentCount / maxLen * 100).toFixed(0);
  console.log(`\n  Top-${maxLen} 一致性: ${consistentCount}/${maxLen} (${consistencyRate}%)`);
  
  // 计算分数比例
  if (maxLen > 0) {
    const ratios = [];
    for (let i = 0; i < maxLen; i++) {
      const pyScore = pyResult.top_results[i].score;
      const tsScore = tsResult.top_results[i].score;
      if (pyScore > 0 && tsScore > 0) {
        ratios.push(tsScore / pyScore);
      }
    }
    
    if (ratios.length > 0) {
      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      console.log(`  平均分数比例 (TS/Python): ${avgRatio.toFixed(2)}x`);
    }
  }
  
  console.log();
});

// 总体统计
console.log('='.repeat(60));
console.log('总体统计');
console.log('='.repeat(60));

let totalComparisons = 0;
let totalConsistent = 0;
const allRatios = [];

pythonData.results.forEach((pyResult, idx) => {
  const tsResult = tsData.results[idx];
  if (!tsResult) return;
  
  const maxLen = Math.min(5, pyResult.top_results.length, tsResult.top_results.length);
  totalComparisons += maxLen;
  
  for (let i = 0; i < maxLen; i++) {
    if (pyResult.top_results[i].path === tsResult.top_results[i].path) {
      totalConsistent++;
    }
    
    const pyScore = pyResult.top_results[i].score;
    const tsScore = tsResult.top_results[i].score;
    if (pyScore > 0 && tsScore > 0) {
      allRatios.push(tsScore / pyScore);
    }
  }
});

const overallConsistency = (totalConsistent / totalComparisons * 100).toFixed(1);
const avgRatio = allRatios.length > 0 ? (allRatios.reduce((a, b) => a + b, 0) / allRatios.length).toFixed(2) : 'N/A';

console.log(`总对比数: ${totalComparisons}`);
console.log(`一致数量: ${totalConsistent}`);
console.log(`总体一致性: ${overallConsistency}%`);
console.log(`平均分数比例 (TS/Python): ${avgRatio}x`);

console.log('\n=== 结论 ===');
if (parseFloat(overallConsistency) >= 80) {
  console.log('✅ 排名一致性优秀');
} else if (parseFloat(overallConsistency) >= 60) {
  console.log('⚠️  排名一致性良好');
} else {
  console.log('❌ 排名一致性需优化');
}

if (avgRatio !== 'N/A') {
  const ratio = parseFloat(avgRatio);
  if (ratio >= 1.5 && ratio <= 2.5) {
    console.log(`⚠️  存在系统性分数偏差 (${avgRatio}x)，建议应用校准因子 ${(1/ratio).toFixed(2)}`);
  } else if (ratio < 1.2) {
    console.log('✅ 分数基本一致');
  } else {
    console.log(`❌ 分数偏差较大 (${avgRatio}x)`);
  }
}
