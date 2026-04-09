const report = require('./bm25_comparison_report.json');

console.log('=== 修复后对比结论 ===\n');

report.forEach((r, i) => {
  console.log(`测试 ${i+1}: ${r.test_name}`);
  console.log(`  排名一致性: ${r.ranking_consistent ? '✅' : '❌'}`);
  console.log(`  平均相对误差: ${(r.avg_relative_error * 100).toFixed(2)}%`);
  console.log(`  Python Top-3: [${r.python_top_indices.slice(0,3).join(', ')}]`);
  console.log(`  TS     Top-3: [${r.ts_top_indices.slice(0,3).join(', ')}]`);
  console.log();
});

const avgRelError = report.reduce((sum, r) => sum + r.avg_relative_error, 0) / report.length;
const consistentCount = report.filter(r => r.ranking_consistent).length;

console.log('=== 总体统计 ===');
console.log(`平均相对误差: ${(avgRelError * 100).toFixed(2)}%`);
console.log(`排名一致性: ${consistentCount}/${report.length} (${(consistentCount/report.length*100).toFixed(0)}%)`);
