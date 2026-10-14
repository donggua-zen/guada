/**
 * 用自签名证书打包 macOS 安装包（本地开发用）
 *
 * 证书与密码放在 `~/.guada-mac-signing/`（不入库）：
 *   guada-sign.p12.base64  证书（p12 的 base64，单行）
 *   password.txt           p12 密码（单行）
 *
 * 为什么要签名：macOS 的本地网络权限（Local Network Privacy）按 app 的代码签名身份
 * 记录授权——未签名 / 每次换身份的包既拿不到授权也不弹询问，表现为打包版终端
 * `ping` 局域网报 "No route to host"、外网正常。生成证书与 CI 侧的 secret 配置见
 * docs/ELECTRON_DEPLOYMENT.md 4.3.1。
 *
 * 用法：pnpm run build:electron:package:mac:sign [--arm64|--x64]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const signDir = path.join(os.homedir(), '.guada-mac-signing');
const linkPath = path.join(signDir, 'guada-sign.p12.base64');
const passPath = path.join(signDir, 'password.txt');

const required = [
  [linkPath, '证书（p12 base64）'],
  [passPath, '证书密码（单行文本）'],
];
for (const [file, label] of required) {
  if (!fs.existsSync(file)) {
    console.error(`❌ 缺少${label}：${file}`);
    console.error('   生成方式见 docs/ELECTRON_DEPLOYMENT.md 4.3.1');
    process.exit(1);
  }
}

const archArg = process.argv.slice(2).find((a) => a === '--arm64' || a === '--x64') || `--${process.arch}`;
console.log(`用自签名证书打包 macOS 包（${archArg}）…`);

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--mac', archArg, '--publish', 'never'],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      // 由 scripts/after-pack-handler.js 的 signMacApp 读取并签名（不使用 electron-builder
      // 的 CSC_*：它只认受信任身份，自签名证书过不了）
      MAC_SIGN_LINK: fs.readFileSync(linkPath, 'utf8').trim(),
      MAC_SIGN_PASSWORD: fs.readFileSync(passPath, 'utf8').trim(),
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
  },
);
