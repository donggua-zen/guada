import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * 用本地编译的 @parcel/watcher Windows 二进制覆盖安装产物。
 *
 * 原因：@parcel/watcher 2.6.0 的 Windows 后端在 unsubscribe 时释放 Subscription，
 * 而已提交的 ReadDirectoryChangesW 完成回调仍持有指向它的裸指针（mOverlapped.hEvent），
 * 事件在途时退订 = use-after-free = 0xC0000005 静默崩溃（切换会话时必现）。
 * 上游 issue #262 未修复，补丁见同目录 WindowsBackend.patch。
 *
 * 只在 win32/x64 生效；@parcel/watcher 版本不是 2.6.0 时跳过（补丁是按该版本源码编的）。
 */

const PATCHED_MD5 = '20df8c54e32e0a1e317eea85a99e0ad5';
const UPSTREAM_MD5 = '94b809936b337f4ce46ce49122971637';
const SUPPORTED_VERSION = '2.6.0';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shipped = path.join(repoRoot, 'third_party', 'parcel-watcher', 'watcher.node');

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

// pnpm 用硬链接铺 node_modules，直接覆写会污染 store：先删再拷。
function replaceWith(target) {
  fs.rmSync(target, { force: true });
  fs.copyFileSync(shipped, target);
  const after = md5(target);
  if (after !== PATCHED_MD5) {
    throw new Error(`${target} 覆盖后校验失败：${after}`);
  }
}

function installedVersion(target) {
  // 平台包与主包同版本发布，取平台包 package.json 即可。
  const pkgDir = path.dirname(target);
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function collect() {
  const found = [];
  const roots = [
    path.join(repoRoot, 'backend-ts', 'node_modules'),
    path.join(repoRoot, 'backend-ts', 'node_modules_production', 'node_modules'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const pnpmDir = path.join(root, '.pnpm');
    const dirs = [root];
    if (fs.existsSync(pnpmDir)) {
      for (const entry of fs.readdirSync(pnpmDir)) {
        if (!entry.startsWith('@parcel+watcher-win32-x64@')) continue;
        dirs.push(path.join(pnpmDir, entry, 'node_modules'));
      }
    }
    for (const dir of dirs) {
      const target = path.join(dir, '@parcel', 'watcher-win32-x64', 'watcher.node');
      if (fs.existsSync(target)) found.push(target);
    }
  }
  return found;
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log(`[patch-parcel-watcher] 跳过：${process.platform}/${process.arch} 不用 Windows 后端`);
    return;
  }
  if (!fs.existsSync(shipped)) {
    console.warn(`[patch-parcel-watcher] 找不到 ${shipped}，跳过`);
    return;
  }

  const targets = collect();
  if (targets.length === 0) {
    console.warn('[patch-parcel-watcher] 未找到 @parcel/watcher-win32-x64，跳过');
    return;
  }

  let changed = 0;
  for (const target of targets) {
    const version = installedVersion(target);
    if (version !== SUPPORTED_VERSION) {
      console.warn(
        `[patch-parcel-watcher] @parcel/watcher 版本 ${version} != ${SUPPORTED_VERSION}，保留上游二进制未打补丁（请重新编译补丁：见 third_party/parcel-watcher/README.md）`,
      );
      continue;
    }
    const current = md5(target);
    if (current === PATCHED_MD5) {
      console.log('[patch-parcel-watcher] 已打补丁，跳过');
      continue;
    }
    if (current !== UPSTREAM_MD5) {
      console.warn(
        `[patch-parcel-watcher] 注意：原二进制 md5=${current} 与已知上游 2.6.0 产物不符，仍按补丁覆盖`,
      );
    }
    replaceWith(target);
    changed++;
    console.log(`[patch-parcel-watcher] 已替换 ${path.relative(repoRoot, target)}`);
  }

  if (changed > 0) {
    console.log(`[patch-parcel-watcher] 共打补丁 ${changed} 处（Windows 后端 use-after-free 修复）`);
  }
}

main();
