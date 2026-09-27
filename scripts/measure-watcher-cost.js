// 量一条常驻 parcel 订阅的内存代价（决定「永不 unsubscribe」方案是否可行）
const path = require('path');
const fs = require('fs');
const watcher = require(path.join(__dirname, '..', 'backend-ts', 'node_modules', '@parcel', 'watcher'));

const IGNORE_GLOBS = [
  '**/node_modules/**', '**/.git/**', '**/.next/**', '**/dist/**', '**/build/**',
  '**/.venv/**', '**/__pycache__/**', '**/.cache/**',
];

const roots = process.argv.slice(2).filter((p) => fs.existsSync(p));
const mem = () => Math.round(process.memoryUsage().rss / 1048576);

(async () => {
  console.log(`基线 rss=${mem()}MB`);
  const subs = [];
  for (const dir of roots) {
    const t0 = Date.now();
    const sub = await watcher.subscribe(dir, () => {}, { ignore: IGNORE_GLOBS });
    subs.push(sub);
    const n = fs.readdirSync(dir).length;
    console.log(`订阅 ${path.basename(dir)}（顶层 ${n} 项）用时 ${Date.now() - t0}ms → rss=${mem()}MB`);
  }
  console.log(`常驻 ${subs.length} 条订阅，rss=${mem()}MB，进程存活`);
  process.exit(0);
})();
