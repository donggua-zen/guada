import * as fs from "node:fs";
import * as path from "node:path";

/** node-pty 原生模块目录查找顺序，与 node-pty/lib/utils.js 的 loadNativeModule 一致 */
const NATIVE_DIRS = ["build/Release", "build/Debug", `prebuilds/${process.platform}-${process.arch}`];

/** 已确认 helper 可执行后不再重复 stat */
let verified = false;

/** 带修复提示的错误：Gateway 会把 fixHint 透传给前端错误横幅 */
export class PtyHelperError extends Error {
  readonly fixHint: string;

  constructor(message: string, fixHint: string) {
    super(message);
    this.name = "PtyHelperError";
    this.fixHint = fixHint;
  }
}

/**
 * macOS 前置检查：node-pty 用 posix_spawn 执行 spawn-helper（helper 负责 chdir(cwd) + execvp(shell)）。
 *
 * 该文件缺 x 位时 posix_spawn 返回 EACCES，node-pty 原生层抛出的 Napi::Error 在
 * node-addon-api 的异常转换路径上会 std::terminate：
 *   libc++abi: terminating due to uncaught exception of type Napi::Error
 * 整个后端进程被 abort —— JS 层 try/catch 拦不住。因此调用 pty.spawn 之前先确认 helper
 * 可执行：能修则 chmod（幂等），修不了抛可读错误由 Gateway 回传前端。
 */
export function ensureSpawnHelperExecutable(): void {
  if (process.platform !== "darwin" || verified) return;

  let pkgDir: string;
  try {
    // node-pty 的 main 是 lib/index.js，两级 dirname 即包根目录
    pkgDir = path.dirname(path.dirname(require.resolve("node-pty")));
  } catch {
    return; // 无法解析包路径：交给 loadNodePty 抛「未安装」的错误
  }

  for (const dir of NATIVE_DIRS) {
    if (!fs.existsSync(path.join(pkgDir, dir, "pty.node"))) continue;

    const helper = path.join(pkgDir, dir, "spawn-helper");
    // 该目录下没有 helper：不在本检查范围，交给 node-pty 自己报错
    if (!fs.existsSync(helper)) return;

    if ((fs.statSync(helper).mode & 0o111) !== 0) {
      verified = true;
      return;
    }

    const fixHint = `chmod +x "${helper}"（或在项目根目录运行 pnpm run rebuild:backend-native）`;
    try {
      fs.chmodSync(helper, 0o755);
    } catch (e: any) {
      throw new PtyHelperError(
        `node-pty spawn-helper 不可执行且无法自动修复：${helper}（${e?.message}）`,
        fixHint,
      );
    }
    if ((fs.statSync(helper).mode & 0o111) === 0) {
      throw new PtyHelperError(`node-pty spawn-helper 仍不可执行：${helper}`, fixHint);
    }

    verified = true;
    return;
  }
}
