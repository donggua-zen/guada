const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
let grand = 0;
const rows = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  let n = 0;
  for (const v of Object.values(d)) {
    if (v && typeof v === 'object' && Array.isArray(v.models)) n += v.models.length;
  }
  if (n > 0) { rows.push([f.replace('.json', ''), n]); grand += n; }
}
rows.sort((a, b) => b[1] - a[1]);
for (const [name, n] of rows) console.log(name.padEnd(26), n);
console.log('--- 有模型的供应商目录:', rows.length, '| 预置模型条目合计:', grand);
// 样例：deepseek 一个条目的完整字段
const ds = JSON.parse(fs.readFileSync(path.join(dir, 'deepseek.json'), 'utf8'));
const sample = ds['openai-completions'].models[0];
console.log('--- deepseek 条目样例字段:', JSON.stringify(Object.keys(sample)));
console.log(JSON.stringify(sample, null, 1).slice(0, 600));
