/**
 * 构建后脚本：使用 rcedit 手动嵌入图标
 * 替代 electron-builder 的 winCodeSign 工具（避免符号链接权限问题）
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// 获取 rcedit 可执行文件路径
function getRceditPath() {
  try {
    const rceditPkg = require.resolve('rcedit/package.json');
    const rceditDir = path.dirname(rceditPkg);
    
    // rcedit 的可执行文件在 bin 目录下
    const platform = process.platform;
    const arch = process.arch;
    
    let rceditExe;
    if (platform === 'win32') {
      rceditExe = path.join(rceditDir, 'bin', 'rcedit-x64.exe');
    } else if (platform === 'darwin') {
      rceditExe = path.join(rceditDir, 'bin', 'rcedit');
    } else {
      rceditExe = path.join(rceditDir, 'bin', `rcedit-${arch}`);
    }
    
    if (fs.existsSync(rceditExe)) {
      console.log(`[rcedit] 找到 rcedit: ${rceditExe}`);
      return rceditExe;
    }
  } catch (e) {
    console.warn('[rcedit] 未找到 rcedit 模块:', e.message);
  }
  return null;
}

module.exports.default = async function (context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'win32') {
    return; // 只处理 Windows 平台
  }
  
  const rceditPath = getRceditPath();
  if (!rceditPath) {
    console.warn('[rcedit] 跳过图标嵌入：未找到 rcedit 工具');
    return;
  }
  
  // 图标文件路径（项目根目录）
  const projectRoot = context.projectDir;
  const iconPath = path.join(projectRoot, 'icon.ico');
  
  if (!fs.existsSync(iconPath)) {
    console.warn(`[rcedit] 跳过图标嵌入：未找到图标文件 ${iconPath}`);
    return;
  }
  
  // 可执行文件路径
  const exeName = context.packager.appInfo.productFilename || 'GuaDa';
  const exePath = path.join(appOutDir, `${exeName}.exe`);
  
  if (!fs.existsSync(exePath)) {
    console.warn(`[rcedit] 跳过图标嵌入：未找到可执行文件 ${exePath}`);
    return;
  }
  
  console.log(`[rcedit] 开始嵌入图标到 ${exePath}`);
  console.log(`[rcedit] 使用图标: ${iconPath}`);
  
  try {
    // 使用 rcedit 嵌入图标
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
      stdio: 'inherit',
      cwd: projectRoot
    });
    
    console.log('[rcedit] 图标嵌入成功！');
  } catch (error) {
    console.error('[rcedit] 图标嵌入失败:', error.message);
    // 不抛出错误，避免中断构建流程
  }
};
