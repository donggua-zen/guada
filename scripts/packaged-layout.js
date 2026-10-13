/**
 * 定位打包产物里的关键路径（win / mac 布局不同）。
 *
 * 供 verify-asar-layout.js 与 verify-packaged-backend.js 共用，避免两处各写一份
 * 路径推断而慢慢走偏。
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

/** 候选打包目录（electron-builder --dir 的输出） */
function candidateAppDirs() {
  return [
    path.join(repoRoot, 'release', 'win-unpacked'),
    path.join(repoRoot, 'release', 'mac', 'GuaDa.app'),
    path.join(repoRoot, 'release', 'mac-arm64', 'GuaDa.app'),
    path.join(repoRoot, 'release', 'mac-x64', 'GuaDa.app'),
    path.join(repoRoot, 'release', 'linux-unpacked'),
  ];
}

/**
 * @param {string | null} appDirArg 显式指定的打包目录（相对仓库根或绝对路径）
 * @returns {{ appDir: string, resourcesDir: string, electronBin: string, asarPath: string, backendDir: string }}
 */
function resolveLayout(appDirArg) {
  const candidates = appDirArg
    ? [path.resolve(repoRoot, appDirArg)]
    : candidateAppDirs();
  const appDir = candidates.find((p) => fs.existsSync(p));
  if (!appDir) {
    throw new Error(
      `找不到打包目录，先跑 pnpm run build:electron:dir。已尝试：\n  ${candidates.join('\n  ')}`,
    );
  }

  const isMac = appDir.endsWith('.app');
  const resourcesDir = isMac
    ? path.join(appDir, 'Contents', 'Resources')
    : path.join(appDir, 'resources');

  return {
    appDir,
    resourcesDir,
    electronBin: isMac
      ? path.join(appDir, 'Contents', 'MacOS', 'GuaDa')
      : path.join(appDir, 'GuaDa.exe'),
    asarPath: path.join(resourcesDir, 'app.asar'),
    backendDir: path.join(resourcesDir, 'backend-ts'),
  };
}

/** 递归统计文件数（跳过打不开的目录，统计用途不必 fail） */
function countFiles(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else n += 1;
    }
  }
  return n;
}

module.exports = { repoRoot, resolveLayout, countFiles };
