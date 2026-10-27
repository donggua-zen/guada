/**
 * 用【临时数据根】启动打包后的后端，验证启动期全链路（`pnpm run verify:packaged`）。
 *
 * 为什么需要它：verify:asar 只证明"文件都在、模块能 require"。真正会炸的地方是启动期——
 * NestJS DI 装配、文件化 store 读写真实文件、健康检查与路由可用。
 * 这些只有把打包后的后端真跑起来才看得见。
 *
 * 安全性：数据根指向新建的临时目录（os.tmpdir），**不碰** `~/.guada` 正式数据，
 * 也不写注册表/快捷方式——只起一个后端进程、轮询健康检查、然后杀掉。
 *
 * 用法：
 *   node scripts/verify-packaged-backend.js [--app-dir <dir>] [--timeout <ms>]
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { resolveLayout } = require('./packaged-layout');

const HEALTH_PATH = '/api/v1/health';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

/** 取一个空闲端口：先监听 0 拿到系统分配的端口再释放 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs, getLog) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return res.status;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`健康检查超时（${timeoutMs}ms，最后错误：${lastError}）\n--- 后端日志尾部 ---\n${getLog().split('\n').slice(-25).join('\n')}`);
}

async function main() {
  const layout = resolveLayout(argValue('--app-dir'));
  const timeoutMs = Number(argValue('--timeout') ?? 180000);
  const port = await freePort();

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-verify-'));
  fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });

  // 与 electron/main.ts 的生产 spawn 保持一致（只把数据根换成临时目录）
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_APP: 'true',
    NODE_NO_WARNINGS: '1',
    NODE_PATH: path.join(layout.resourcesDir, 'app.asar', 'backend-ts', 'node_modules'),
    PORT: String(port),
    BASE_URL: `http://127.0.0.1:${port}`,
    STATIC_DIR: path.join(layout.backendDir, 'static'),
    UPLOAD_ROOT_DIR: path.join(dataRoot, 'file_stores'),
    UPLOAD_URL_PREFIX: '/uploads',
    SETTINGS_DIR: dataRoot,
    USERDATA_DIR: dataRoot,
    LOGS_DIR: path.join(dataRoot, 'logs'),
    SKILLS_DIR: path.join(dataRoot, 'skills'),
    WORKSPACE_BASE_DIR: path.join(dataRoot, 'workspaces'),
    PLUGINS_USER_DIR: path.join(dataRoot, 'plugins'),
    PLUGINS_BUILTIN_DIR: path.join(layout.resourcesDir, 'plugins'),
  };

  const script = path.join(layout.backendDir, 'dist', 'main.js');
  console.log('========================================');
  console.log('打包后端启动校验（临时数据根）');
  console.log('========================================');
  console.log(`后端入口: ${script}`);
  console.log(`数据根  : ${dataRoot}  (临时目录，非 ~/.guada)`);
  console.log(`端口    : ${port}`);

  let log = '';
  const child = spawn(layout.electronBin, [script], {
    cwd: layout.backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  let failure = null;
  try {
    const status = await Promise.race([
      waitForHealth(port, timeoutMs, () => log),
      exited.then(({ code, signal }) => {
        throw new Error(
          `后端进程提前退出（code=${code} signal=${signal}）\n--- 后端日志尾部 ---\n${log.split('\n').slice(-25).join('\n')}`,
        );
      }),
    ]);
    console.log(`\n✓ 健康检查 ${HEALTH_PATH} -> ${status}`);

    const agents = await fetch(`http://127.0.0.1:${port}/api/v1/agents`);
    console.log(`✓ GET /api/v1/agents -> ${agents.status}（NestJS 路由 + 文件化 store 可用）`);

    const metaDb = path.join(dataRoot, 'sessions', '_meta.db');
    if (!fs.existsSync(metaDb)) {
      throw new Error(`文件化存储没有初始化：${metaDb} 不存在`);
    }
    console.log(`✓ 会话元数据库已创建 ${metaDb}（${fs.statSync(metaDb).size} bytes）`);

    if (/打开知识库数据库失败|no such module: vec0/.test(log)) {
      throw new Error('日志里出现 sqlite-vec 加载失败——asar 路径重写没生效');
    }
    console.log('✓ 日志无 sqlite-vec 加载失败');
  } catch (e) {
    failure = e;
  } finally {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }

  if (failure) {
    console.error(`\nFAILED: ${failure.message}`);
    process.exit(1);
  }
  console.log('\nSUCCESS: 打包后端在临时数据根下启动并响应正常');
  console.log('========================================');
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
