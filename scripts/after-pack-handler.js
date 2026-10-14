/**
 * 打包后处理脚本：清理语言包 + 嵌入图标 + 补 spawn-helper 权限 + 可选自签名
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

/** 执行外部命令（失败即抛，stdout/stderr 直通） */
function sh(cmd, opts = {}) {
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit', ...opts });
}

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
 * macOS：用自签名证书签名 app（可选，不设 MAC_SIGN_LINK 则跳过）
 *
 * 为什么不交给 electron-builder 的 CSC_LINK：它只认「有效（受信任）」身份
 * （`security find-identity -v -p codesigning`），自签名证书默认不受信任 → 找不到身份
 * 直接失败。这里自己导入临时钥匙串、按 SHA1 指定身份 codesign —— 不需要把证书加入
 * 系统信任（也不需要 sudo），本地与 CI 走同一条路径。
 *
 * 为什么要签名：macOS 的本地网络权限按 app 的代码签名身份记授权，未签名包拿不到授权
 * 也不弹询问（打包版终端连不上局域网）。详见 docs/ELECTRON_DEPLOYMENT.md 4.3.1。
 */
function signMacApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  const link = process.env.MAC_SIGN_LINK;
  const password = process.env.MAC_SIGN_PASSWORD;
  if (!link || !password) {
    console.log('[sign] 未提供 MAC_SIGN_LINK / MAC_SIGN_PASSWORD，跳过签名（产物未签名）');
    return;
  }

  const productFilename = context.packager.appInfo.productFilename || 'GuaDa';
  const appPath = path.join(context.appOutDir, productFilename + '.app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-sign-'));
  const keychain = path.join(dir, 'sign.keychain');
  const p12 = path.join(dir, 'cert.p12');
  const keychainPassword = `guada-sign-${process.pid}`;

  try {
    fs.writeFileSync(p12, Buffer.from(link.trim(), 'base64'));
    sh(['security', 'create-keychain', '-p', keychainPassword, keychain]);
    sh(['security', 'unlock-keychain', '-p', keychainPassword, keychain]);
    sh(['security', 'import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    sh(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain]);

    // 身份名未知（自签名证书 CN 任意），直接按 SHA1 指定；不带 -v 才能看到未受信任身份
    const listed = execSync(`security find-identity -p codesigning "${keychain}"`).toString();
    const sha1 = (listed.match(/[0-9A-F]{40}/) || [])[0];
    if (!sha1) {
      throw new Error('临时钥匙串里没有可用的签名身份');
    }

    sh(['codesign', '--force', '--deep', '--sign', sha1, '--keychain', keychain, appPath]);
    sh(['codesign', '--verify', '--deep', '--strict', appPath]);
    const authority = execSync(`codesign -dv --verbose=2 "${appPath}" 2>&1 || true`).toString();
    const name = (authority.match(/Authority=(.+)/) || [])[1] || sha1;
    console.log(`[sign] ✓ 已签名并通过严格校验（Authority=${name.trim()}）`);
  } finally {
    try {
      execSync(`security delete-keychain "${keychain}"`, { stdio: 'ignore' });
    } catch {
      /* 清理失败不影响产物 */
    }
    fs.rmSync(dir, { recursive: true, force: true });
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
    signMacApp(context);
  } catch (error) {
    console.error('After pack handler error:', error);
  }
};
