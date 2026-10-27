/**
 * 打包产物 asar 布局校验（`pnpm run verify:asar`）。
 *
 * 为什么需要它：后端 node_modules 从 extraResources（真实目录、1.5 万个小文件）搬进
 * app.asar 之后，"装出来的应用能不能跑"这件事在构建期完全看不出来——文件少了、原生模块
 * 没解包、路径没重写，都要等用户装完点开才发现。这个脚本把这类回归压到构建期。
 *
 * 校验内容：
 *   1. 真实目录布局：resources/backend-ts/node_modules 必须已消失，文件数必须降下来
 *   2. asar 内容：入口包在 asar 内；嵌套 node_modules 没被 walker 丢掉（includeSubNodeModules）
 *   3. asarUnpack 生效：配置里列的每个包，其源目录里的原生文件（.node/.dll/.exe/.so/.dylib）
 *      都出现在 app.asar.unpacked 下
 *   4. VC++ 运行时随包分发：动态链接 vcruntime140*.dll 的原生模块要有单份 resources/vc-runtime
 *   5. 不漏文件：源目录里过滤后应打包的文件，逐个能在 asar 或 unpacked 里找到
 *   6. @parcel/watcher 补丁二进制（win32）md5 与 third_party 一致
 *   7. 运行期烟测：以 ELECTRON_RUN_AS_NODE + NODE_PATH 起打包后的 Electron，逐个 require
 *      原生/关键依赖，并真加载一次 sqlite-vec（唯一必须走路径重写的原生扩展）
 *
 * 用法：
 *   node scripts/verify-asar-layout.js                  # 自动找 release/<platform>-unpacked
 *   node scripts/verify-asar-layout.js --skip-runtime   # 只做静态检查
 *   node scripts/verify-asar-layout.js --app-dir <dir>  # 指定打包目录（如 release/win-unpacked）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
const { globSync } = require('glob');
const { repoRoot, resolveLayout, countFiles } = require('./packaged-layout');
const { peImportInfo, crtImports, collectNativeBinaries } = require('./pe-imports');

const pkg = require(path.join(repoRoot, 'package.json'));

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  console.log(`  ✗ ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`  ! ${message}`);
}

function ok(message) {
  console.log(`  ✓ ${message}`);
}

/** 打包目录里 asar / 真实资源 / Electron 二进制的实际位置（win 与 mac 布局不同） */
function resolveLayoutOrExplain(appDirArg) {
  try {
    return resolveLayout(appDirArg);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

/** 源路径（仓库相对，正斜杠）→ 打进包里的相对路径 */
const SRC_NM_PREFIX = 'backend-ts/node_modules_production/node_modules/';
const DEST_NM_PREFIX = 'backend-ts/node_modules/';

function toDestPath(srcRel) {
  return srcRel.startsWith(SRC_NM_PREFIX)
    ? DEST_NM_PREFIX + srcRel.slice(SRC_NM_PREFIX.length)
    : srcRel;
}

/** 用 glob 的写法收集源目录文件（windowsPathsNoEscape：路径里是反斜杠，glob 9+ 默认当转义符） */
function collectSourceFiles(pattern, ignore) {
  return globSync(pattern, {
    cwd: repoRoot,
    nodir: true,
    ignore,
    windowsPathsNoEscape: true,
  }).map((p) => p.split(path.sep).join('/'));
}

function checkLayout(layout) {
  console.log('\n[1] 真实目录布局');
  const backendDir = path.join(layout.resourcesDir, 'backend-ts');
  if (!fs.existsSync(backendDir)) {
    fail(`resources/backend-ts 不存在（${backendDir}）`);
    return;
  }

  const realNodeModules = path.join(backendDir, 'node_modules');
  if (fs.existsSync(realNodeModules)) {
    fail(`resources/backend-ts/node_modules 仍然存在——它应该只在 app.asar 内`);
  } else {
    ok('resources/backend-ts/node_modules 已消失（依赖在 asar 内）');
  }

  const backendFiles = countFiles(backendDir);
  if (backendFiles >= 2500) {
    fail(`resources/backend-ts 文件数 ${backendFiles}，未降到预期（< 2500）`);
  } else {
    ok(`resources/backend-ts 文件数 ${backendFiles}（迁移前 17,164）`);
  }
  return backendFiles;
}

function checkAsar(layout) {
  console.log('\n[2] asar 内容');
  const entries = asar.listPackage(layout.asarPath).map((p) => p.split('\\').join('/'));
  const entrySet = new Set(entries);

  const required = [
    'backend-ts/node_modules/@nestjs/core/package.json',
    'backend-ts/node_modules/zod/package.json',
  ];
  for (const p of required) {
    if (entrySet.has('/' + p)) ok(`asar 内存在 ${p}`);
    else fail(`asar 内缺少 ${p}`);
  }

  // 嵌套 node_modules（pnpm hoisted 布局下仍有 20+ 个）——includeSubNodeModules 关掉就会静默丢
  const nestedPkgJsons = collectSourceFiles(`${SRC_NM_PREFIX}*/node_modules/*/package.json`, []);
  if (nestedPkgJsons.length === 0) {
    warn('源目录里没找到嵌套 node_modules，跳过该检查');
  } else {
    const missing = nestedPkgJsons.filter((p) => !entrySet.has('/' + toDestPath(p)));
    if (missing.length) {
      fail(`嵌套 node_modules 被丢弃 ${missing.length} 个（需 includeSubNodeModules: true），例：${missing[0]}`);
    } else {
      ok(`嵌套 node_modules 完整（${nestedPkgJsons.length} 个 package.json 抽查）`);
    }
  }

  const nmEntries = entries.filter((p) => p.startsWith('/' + DEST_NM_PREFIX)).length;
  ok(`asar 内 backend-ts/node_modules 条目数 ${nmEntries}，asar 总条目 ${entries.length}`);
  return { entries, entrySet };
}

function checkUnpacked(layout) {
  console.log('\n[3] asarUnpack 生效');
  const unpackedRoot = path.join(layout.resourcesDir, 'app.asar.unpacked');
  if (!fs.existsSync(unpackedRoot)) {
    fail('app.asar.unpacked 不存在——原生模块没解包，sqlite-vec 等必然加载失败');
    return { unpackedFiles: new Set() };
  }

  const nativeExt = /\.(node|dll|exe|so|dylib)$/i;
  const globs = pkg.build?.asarUnpack ?? [];
  let checkedPackages = 0;
  let checkedFiles = 0;

  // 逐个 asarUnpack 条目核对：该条命中目录里的原生文件，必须都能在 unpacked 下找到。
  // 条目既有精确包名（better-sqlite3）也有平台通配（@img/sharp-*），统一先解析出目录再枚举。
  for (const g of globs) {
    const dirPattern = g.replace(/\/\*\*$/, '');
    const dirs = globSync(dirPattern, { cwd: repoRoot, windowsPathsNoEscape: true })
      .map((d) => d.split(path.sep).join('/'))
      .filter((d) => {
        try {
          return fs.statSync(path.join(repoRoot, d)).isDirectory();
        } catch {
          return false;
        }
      });
    if (dirs.length === 0) continue; // 该平台没有这个包（如 win 上的 darwin 包）

    for (const srcDir of dirs) {
      const srcFiles = collectSourceFiles(`${srcDir}/**/*`, []).filter((f) => nativeExt.test(f));
      if (srcFiles.length === 0) continue;
      checkedPackages += 1;
      const missing = srcFiles.filter(
        (f) => !fs.existsSync(path.join(unpackedRoot, toDestPath(f))),
      );
      if (missing.length) {
        fail(`${srcDir} 有 ${missing.length}/${srcFiles.length} 个原生文件未解包，例：${missing[0]}`);
      } else {
        checkedFiles += srcFiles.length;
        ok(`${srcDir.replace(SRC_NM_PREFIX, '')} 原生文件全部解包（${srcFiles.length}）`);
      }
    }
  }
  ok(`已核对 ${checkedPackages} 个包的 ${checkedFiles} 个原生文件`);

  const unpackedFiles = new Set(
    globSync('**/*', { cwd: unpackedRoot, nodir: true, windowsPathsNoEscape: true }).map(
      (p) => 'app.asar.unpacked/' + p.split(path.sep).join('/'),
    ),
  );

  // 补丁二进制：装了未打补丁的 watcher.node 会在切换会话时 0xC0000005 静默崩溃
  if (process.platform === 'win32') {
    const shipped = path.join(repoRoot, 'third_party', 'parcel-watcher', 'watcher.node');
    const inPack = path.join(
      unpackedRoot,
      'backend-ts/node_modules/@parcel/watcher-win32-x64/watcher.node',
    );
    if (!fs.existsSync(shipped)) {
      warn('third_party/parcel-watcher/watcher.node 不存在，跳过 md5 校验');
    } else if (!fs.existsSync(inPack)) {
      fail('@parcel/watcher-win32-x64/watcher.node 不在 app.asar.unpacked 里');
    } else if (md5(shipped) !== md5(inPack)) {
      fail(`@parcel/watcher 补丁二进制 md5 不一致（包内 ${md5(inPack)}，期望 ${md5(shipped)}）`);
    } else {
      ok('@parcel/watcher 补丁二进制 md5 一致');
    }
  }

  return { unpackedFiles };
}

/**
 * VC++ 运行时随包分发校验（Windows）。
 *
 * 动态链接 vcruntime140*.dll 的 .node（当前只有 @node-rs/jieba，其余原生模块都静态链接
 * CRT）在没装 VC++ 运行时的干净系统上加载失败，而它是在模块顶层被 require 的，会把整个
 * 后端带崩（已发生过一次：全新 Win10 虚拟机装完包后端起不来）。机制：打包期把需要的 DLL
 * 收敛到单份 vc-runtime/ → resources/vc-runtime，主进程再注入后端 PATH
 * （见 electron/main.ts 的 backendCrtPathEnv）。这里从打包后的原生文件现算所需 DLL 逐个
 * 核对：漏了它、或又把它散成多份副本，都在这里拦住。
 */
function checkVcRuntime(layout) {
  console.log('\n[4] VC++ 运行时随包分发');
  if (process.platform !== 'win32') {
    ok('非 Windows 平台，跳过');
    return;
  }

  const unpackedRoot = path.join(layout.resourcesDir, 'app.asar.unpacked');
  const appMachine = peImportInfo(layout.electronBin).machine;
  const required = new Set();
  const users = new Map();

  for (const file of collectNativeBinaries(path.join(unpackedRoot, 'backend-ts', 'node_modules'))) {
    let info;
    try {
      info = peImportInfo(file);
    } catch {
      continue; // 其它平台的 .node 产物
    }
    if (info.machine !== appMachine) continue; // 非本产物架构（如 node-pty 的 arm64 预编译）
    for (const name of crtImports(info)) {
      required.add(name);
      if (!users.has(name)) users.set(name, []);
      users.get(name).push(path.relative(unpackedRoot, file).split(path.sep).join('/'));
    }
  }

  if (required.size === 0) {
    ok('没有动态链接 MSVC 运行时的原生模块');
    return;
  }

  const crtDir = path.join(layout.resourcesDir, 'vc-runtime');
  const missing = [...required].filter((n) => !fs.existsSync(path.join(crtDir, n)));
  if (missing.length) {
    fail(
      `resources/vc-runtime 缺少 ${missing.join('、')}（${users.get(missing[0])[0]} 需要它）——干净系统上后端会起不来`,
    );
  } else {
    const src = [...required].map((n) => `${n}`).join('、');
    ok(`resources/vc-runtime 备齐 ${src}`);
  }

  // 单份约束：这些 DLL 只能有一份（散进各包目录既冗余、又难维护）
  const dupes = globSync('**/*', { cwd: unpackedRoot, nodir: true, windowsPathsNoEscape: true }).filter(
    (p) => required.has(path.basename(p).toLowerCase()),
  );
  const inAsar = asar
    .listPackage(layout.asarPath)
    .filter((p) => required.has(path.basename(p).toLowerCase()));
  if (dupes.length || inAsar.length) {
    fail(
      `VC++ 运行时出现重复副本（应只有 resources/vc-runtime 一份）：` +
        [...dupes, ...inAsar].slice(0, 3).join('、'),
    );
  } else {
    ok('无重复副本（仅 resources/vc-runtime 一份）');
  }
}

function checkCompleteness(layout, entrySet, unpackedFiles) {
  console.log('\n[5] 不漏文件');
  const filesEntry = (pkg.build?.files ?? []).find(
    (f) => typeof f === 'object' && f.from === 'backend-ts/node_modules_production/node_modules',
  );
  if (!filesEntry) {
    fail('build.files 里没有 node_modules 的 from/to 条目');
    return;
  }

  const ignore = (filesEntry.filter ?? [])
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1));
  const expected = collectSourceFiles(`${SRC_NM_PREFIX}**/*`, ignore);
  const missing = [];
  for (const srcRel of expected) {
    const dest = toDestPath(srcRel);
    if (entrySet.has('/' + dest)) continue;
    if (unpackedFiles.has('app.asar.unpacked/' + dest)) continue;
    missing.push(srcRel);
  }

  if (missing.length) {
    fail(
      `源目录里应打包的 ${expected.length} 个文件中，有 ${missing.length} 个既不在 asar 也不在 unpacked，例：${missing[0]}`,
    );
  } else {
    ok(`应打包的 ${expected.length} 个文件全部就位`);
  }

  const packedCount = entrySet.size;
  if (packedCount + unpackedFiles.size < expected.length) {
    fail('asar + unpacked 的文件数少于源目录应打包数，存在静默丢失');
  }
}

function runRuntimeSmoke(layout) {
  console.log('\n[6] 运行期烟测（ELECTRON_RUN_AS_NODE + NODE_PATH）');
  if (!fs.existsSync(layout.electronBin)) {
    fail(`找不到 Electron 二进制：${layout.electronBin}`);
    return;
  }

  const probePath = path.join(os.tmpdir(), `guada-asar-smoke-${process.pid}.js`);
  const nmPath = path.join(layout.resourcesDir, 'app.asar', 'backend-ts', 'node_modules');
  const distUtil = path.join(
    layout.resourcesDir,
    'backend-ts',
    'dist',
    'common',
    'utils',
    'asar-path.util.js',
  );

  fs.writeFileSync(
    probePath,
    `const Database = require('better-sqlite3');
const specs = ['@nestjs/core','better-sqlite3','sharp','@napi-rs/canvas','@node-rs/jieba','@parcel/watcher','node-pty','pdfjs-dist','sqlite-vec','tiktoken'];
for (const s of specs) {
  const r = require.resolve(s);
  if (!r.includes('app.asar')) throw new Error(s + ' 解析到了 asar 之外：' + r);
  require(s);
  console.log('  ok ' + s);
}
// 唯一必须走路径重写的原生扩展：真加载 + 真建 vec0 表
const { loadSqliteVec, toUnpackedPath } = require(${JSON.stringify(distUtil)});
const sqliteVec = require('sqlite-vec');
const p = toUnpackedPath(sqliteVec.getLoadablePath());
require('fs').accessSync(p);
console.log('  ok sqlite-vec 扩展真实路径 ' + p);
const db = new Database(':memory:');
loadSqliteVec(db);
db.exec('CREATE VIRTUAL TABLE t USING vec0(v float[2])');
db.prepare('INSERT INTO t(rowid, v) VALUES (?, ?)').run(1n, Buffer.from(new Float32Array([1, 0]).buffer));
const rows = db.prepare('SELECT rowid, distance FROM t WHERE v MATCH ? ORDER BY distance LIMIT 1').all(Buffer.from(new Float32Array([1, 0]).buffer));
if (rows.length !== 1) throw new Error('vec0 KNN 查询失败');
console.log('  ok sqlite-vec vec0 KNN 查询通过');
db.close();
`,
    'utf8',
  );

  try {
    const res = spawnSync(layout.electronBin, [probePath], {
      cwd: os.tmpdir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: nmPath },
      encoding: 'utf8',
      timeout: 120000,
    });
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
    console.log(out.split('\n').map((l) => '  ' + l).join('\n'));
    if (res.status !== 0) {
      fail(`运行期烟测失败（exit ${res.status}）`);
    } else {
      ok('运行期烟测通过');
    }
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

/**
 * Computer Use sidecar 随包分发（Windows 首期）。
 * 校验存在性与可执行性；协议细节由 verify-sidecar.js 的 --version 覆盖。
 */
function checkComputerSidecar(layout) {
  if (process.platform !== 'win32') return;
  const binary = path.join(layout.resourcesDir, 'computer-sidecar', 'guada-computer.exe');
  if (!fs.existsSync(binary)) {
    fail(`resources/computer-sidecar/guada-computer.exe 不存在（${binary}）`);
    return;
  }
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) {
    fail(`computer sidecar --version 失败（exit ${result.status}）`);
    return;
  }
  ok(`computer sidecar v${String(result.stdout).trim()}`);
}

function main() {
  const args = process.argv.slice(2);
  const appDirArg = args.includes('--app-dir') ? args[args.indexOf('--app-dir') + 1] : null;
  const skipRuntime = args.includes('--skip-runtime');

  const layout = resolveLayoutOrExplain(appDirArg);
  console.log('========================================');
  console.log('asar 布局校验');
  console.log('========================================');
  console.log(`打包目录: ${layout.appDir}`);

  checkLayout(layout);
  const { entrySet } = checkAsar(layout);
  const { unpackedFiles } = checkUnpacked(layout);
  checkVcRuntime(layout);
  checkComputerSidecar(layout);
  checkCompleteness(layout, entrySet, unpackedFiles);
  if (!skipRuntime) runRuntimeSmoke(layout);

  console.log('\n========================================');
  if (warnings.length) console.log(`警告 ${warnings.length} 条`);
  if (failures.length) {
    console.log(`FAILED: ${failures.length} 项未通过`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('SUCCESS: asar 布局校验全部通过');
  console.log('========================================');
}

main();
