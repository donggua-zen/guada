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
 * 主处理函数
 */
module.exports = async function (context) {
  try {
    cleanupLocales(context);
    embedIcon(context);
  } catch (error) {
    console.error('After pack handler error:', error);
  }
};
