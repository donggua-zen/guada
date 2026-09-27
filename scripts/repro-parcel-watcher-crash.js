// @parcel/watcher Windows 后端 use-after-free 复现（后端静默崩溃 0xC0000005 的根因）
// 用法: node scripts/repro-parcel-watcher-crash.js <mode> [次数]
//   churn      : 订阅→退订循环，目录无变动 → 存活
//   writeonly  : 目录高频写，订阅不退订        → 存活
//   churnwrite : 两者同时                      → 段错误（事件在途时 unsubscribe）
//   missingdir : 订阅不存在的目录              → 稳定抛 "Invalid handle"（不崩）
// 结论与 native 侧代码位置见 docs/TROUBLESHOOTING.md 第 21 节。
const path = require('path');
const fs = require('fs');
const os = require('os');
// 默认使用 backend-ts 里的实装版本；WATCHER_MODULE=<包目录> 可指向自编译产物（验证补丁时用）
const watcherModule =
  process.env.WATCHER_MODULE ||
  path.join(__dirname, '..', 'backend-ts', 'node_modules', '@parcel', 'watcher');
const watcher = require(watcherModule);

const mode = process.argv[2] || 'churn';
const N = Number(process.argv[3] || 200);
const live = new Set();

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-repro-'));
  fs.writeFileSync(path.join(d, 'a.txt'), 'x');
  const subDir = path.join(d, 'sub');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'b.txt'), 'y');
  return d;
}

const dirs = [tmpDir(), tmpDir(), tmpDir()];

async function churn() {
  for (let i = 0; i < N; i++) {
    const dir = dirs[i % dirs.length];
    const sub = await watcher.subscribe(dir, () => {});
    await sub.unsubscribe();
    if (i % 50 === 0) console.log(`churn ${i}/${N} alive rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
  }
  console.log(`OK churn 完成 ${N} 轮，进程存活 pid=${process.pid}`);
}

async function missingDir() {
  const ok = await watcher.subscribe(dirs[0], () => {});
  live.add(ok);
  const ghost = path.join(os.tmpdir(), 'watch-repro-does-not-exist-' + Date.now());
  for (let i = 0; i < N; i++) {
    try {
      await watcher.subscribe(ghost, () => {});
      console.log('subscribe 到不存在路径竟然成功了');
    } catch (err) {
      if (i % 50 === 0) console.log(`missing ${i}/${N}: ${String(err).slice(0, 60)}`);
    }
    // 每次失败后再退订/重订存活订阅，制造 backend 共享状态抖动
    if (i % 5 === 0) {
      await ok.unsubscribe();
      await new Promise((r) => setTimeout(r, 5));
      await watcher.subscribe(dirs[1], () => {}).then((s) => live.add(s));
    }
  }
  console.log(`OK missingdir 完成，进程存活 pid=${process.pid}`);
}

async function overlap() {
  const dir = dirs[2];
  for (let i = 0; i < N; i++) {
    const a = watcher.subscribe(dir, () => {});
    const b = watcher.subscribe(dir, () => {});
    const [sa, sb] = await Promise.all([a, b]);
    // 交替撤销：一个立刻退订，一个留着（两会话共用同一路径的形状）
    sa.unsubscribe();
    sb.unsubscribe().catch(() => {});
    if (i % 50 === 0) console.log(`overlap ${i}/${N} 存活`);
  }
  console.log(`OK overlap 完成，进程存活 pid=${process.pid}`);
}

async function churnWithWrite() {
  // 关键差异：订阅期间目录里持续有事件产生 → ReadDirectoryChangesW 完成回调在途，
  // 此时退订会让 native 侧 Subscription 被释放，而回调里存的是裸指针（mOverlapped.hEvent = this）
  const stop = setInterval(() => {
    for (const d of dirs) {
      try {
        fs.writeFileSync(path.join(d, `w-${Date.now()}.txt`), String(Math.random()));
      } catch {}
    }
  }, 1);
  for (let i = 0; i < N; i++) {
    const dir = dirs[i % dirs.length];
    const sub = await watcher.subscribe(dir, () => {});
    await sub.unsubscribe();
    if (i % 100 === 0) console.log(`wchurn ${i}/${N} 存活`);
  }
  clearInterval(stop);
  console.log(`OK churnWithWrite 完成，进程存活 pid=${process.pid}`);
}

async function writeOnly() {
  // 对照：只写文件、不退订 → 若存活则证明触发点是 unsubscribe 而不是事件本身
  const subs = [];
  for (const d of dirs) subs.push(await watcher.subscribe(d, () => {}));
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    for (const d of dirs) {
      try { fs.writeFileSync(path.join(d, `w-${Date.now()}.txt`), String(Math.random())); } catch {}
    }
    await new Promise((r) => setImmediate(r));
  }
  for (const s of subs) await s.unsubscribe();
  console.log(`OK writeOnly 完成（8s 高频写 + 收尾退订），进程存活 pid=${process.pid}`);
}

async function events() {
  // 功能回归：事件要收得到；退订后继续写文件（打补丁前正是这一步崩）
  const dir = dirs[0];
  const seen = [];
  const sub = await watcher.subscribe(dir, (error, evs) => {
    if (!error) seen.push(...evs.map((e) => e.type + ':' + path.basename(e.path)));
  });
  fs.writeFileSync(path.join(dir, 'probe.txt'), '1');
  await new Promise((r) => setTimeout(r, 1500));
  const received = seen.length > 0;
  await sub.unsubscribe();
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(dir, `after-${i}.txt`), String(i));
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(
    `${received ? 'OK' : 'FAIL'} 收到事件 ${seen.length} 条（${seen.slice(0, 3).join(', ')}），` +
      `退订后又写 30 次，进程存活 pid=${process.pid}`,
  );
  process.exit(received ? 0 : 1);
}

(async () => {
  try {
    if (mode === 'churn') await churn();
    else if (mode === 'churnwrite') await churnWithWrite();
    else if (mode === 'writeonly') await writeOnly();
    else if (mode === 'events') await events();
    else if (mode === 'missingdir') await missingDir();
    else if (mode === 'overlap') await overlap();
    else throw new Error('unknown mode ' + mode);
    for (const s of live) {
      try { await s.unsubscribe(); } catch {}
    }
    process.exit(0);
  } catch (err) {
    console.error('REPRO JS ERROR:', err);
    process.exit(1);
  }
})();
