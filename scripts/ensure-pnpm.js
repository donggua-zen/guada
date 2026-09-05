/**
 * pnpm 强制守卫：在 preinstall 阶段阻止使用 npm / yarn 安装依赖
 *
 * 背景：backend-ts 依赖 pnpm 的 patchedDependencies 机制给 node-pty 打补丁
 * （修复 Windows 下关闭终端时 conpty_console_list_agent 的 AttachConsole failed）。
 * npm 不认识 pnpm 的补丁机制，任何一次 npm install 都会把打补丁的包
 * 静默替换回原版。此脚本保证只有 pnpm 能执行 install。
 *
 * npm / yarn / pnpm 都会注入 npm_config_user_agent 环境变量，形如：
 *   pnpm/11.7.0 npm/? node/v25 ...
 *   npm/11.6.2 node/v25 ...
 *   yarn/1.22.0 npm/? node/v25 ...
 */
const userAgent = process.env.npm_config_user_agent || '';

if (!userAgent.startsWith('pnpm/')) {
  const tool = userAgent.split(' ')[0] || '未知包管理器';
  console.error('');
  console.error('❌ 检测到正在使用 ' + tool + ' 安装依赖，本项目统一使用 pnpm。');
  console.error('');
  console.error('   本项目依赖 pnpm 的 patchedDependencies 给 node-pty 打补丁，');
  console.error('   npm/yarn install 会静默冲掉补丁，导致 Windows 下关闭终端时报');
  console.error('   "Error: AttachConsole failed" 并重启后端。');
  console.error('');
  console.error('   请改用：');
  console.error('     pnpm install');
  console.error('');
  process.exit(1);
}
