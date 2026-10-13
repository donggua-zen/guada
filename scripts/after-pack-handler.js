/**
 * 打包后处理脚本：清理语言包 + 嵌入图标
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 获取 rcedit 可执行文件路径
 */
function getRceditPath() {
  const projectRoot = path.resolve(__dirname, '..');
  const rceditExe = path.join(projectRoot, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  
  if (fs.existsSync(rceditExe)) {
    return rceditExe;
  }
  return null;
}

/**
 * 清理不需要的语言包文件
 */
function cleanupLocales(context) {
  const appOutDir = context.appOutDir;
  const localesDir = path.join(appOutDir, 'locales');
  
  if (!fs.existsSync(localesDir)) {
    return;
  }
  
  const keepLocales = ['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak'];
  const files = fs.readdirSync(localesDir);
  
  files.forEach(file => {
    if (!keepLocales.includes(file)) {
      const filePath = path.join(localesDir, file);
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        // 忽略删除错误
      }
    }
  });
}

/**
 * 嵌入图标到可执行文件
 */
function embedIcon(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  
  const rceditPath = getRceditPath();
  if (!rceditPath) {
    console.warn('[rcedit] 跳过图标嵌入：未找到 rcedit 工具');
    return;
  }
  
  // 使用 __dirname 获取项目根目录
  const projectRoot = path.resolve(__dirname, '..');
  const iconPath = path.join(projectRoot, 'icon.ico');
  
  if (!fs.existsSync(iconPath)) {
    console.warn(`[rcedit] 跳过图标嵌入：未找到图标文件 ${iconPath}`);
    return;
  }
  
  const exeName = context.packager.appInfo.productFilename || 'GuaDa';
  const exePath = path.join(context.appOutDir, `${exeName}.exe`);
  
  if (!fs.existsSync(exePath)) {
    console.warn(`[rcedit] 跳过图标嵌入：未找到可执行文件 ${exePath}`);
    return;
  }
  
  console.log(`[rcedit] 开始嵌入图标到 ${exePath}`);
  
  try {
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
      stdio: 'inherit',
      cwd: projectRoot
    });
    console.log('[rcedit] 图标嵌入成功！');
  } catch (error) {
    console.error('[rcedit] 图标嵌入失败:', error.message);
  }
}

/**
 * macOS：补齐 node-pty 的 spawn-helper 可执行位
 *
 * electron-builder 的 asarUnpack / extraResources 拷贝都不保留文件权限，源目录修好也不够；
 * 缺 x 位时 node-pty 的 posix_spawn 会 EACCES，用户一打开终端后端进程就 abort。
 * 候选目录覆盖两种布局：node_modules 进 asar 时 node-pty 被 asarUnpack 解到
 * app.asar.unpacked 下；走 extraResources 时在 Resources 下。
 */
function fixPtySpawnHelper(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const { ensureSpawnHelperExecutable } = require('./ensure-pty-spawn-helper');
  const productFilename = context.packager.appInfo.productFilename || 'GuaDa';
  const resourcesDir = path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources');
  const candidates = [
    path.join(resourcesDir, 'app.asar.unpacked', 'backend-ts', 'node_modules'),
    path.join(resourcesDir, 'backend-ts', 'node_modules'),
  ];
  const nodeModulesDirs = candidates.filter((dir) => fs.existsSync(dir));

  if (nodeModulesDirs.length === 0) {
    console.warn('[node-pty] 未找到打包后的 node_modules，跳过 spawn-helper 权限修复');
    console.warn(`[node-pty] 已尝试：${candidates.join('、')}`);
    return;
  }

  console.log(`[node-pty] 补齐 spawn-helper 可执行权限：${nodeModulesDirs.join('、')}`);
  if (!ensureSpawnHelperExecutable(nodeModulesDirs).ok) {
    console.error('[node-pty] ❌ spawn-helper 不可执行，打包版 macOS 打开终端会崩掉后端进程');
  }
}

/**
 * 主处理函数
 */
module.exports = async function (context) {
  try {
    cleanupLocales(context);
    embedIcon(context);
    fixPtySpawnHelper(context);
  } catch (error) {
    console.error('After pack handler error:', error);
  }
};
