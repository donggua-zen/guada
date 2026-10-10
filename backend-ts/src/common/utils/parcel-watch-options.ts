import type { Options } from "@parcel/watcher";

/**
 * parcel-watcher 订阅选项（Windows 必须显式指定原生后端）。
 *
 * 默认后端 `"default"` 在 Windows 上会先执行 `WatchmanBackend::checkAvailable()`——它在 C++ 里
 * 用 `_popen("watchman --output-encoding=bser get-sockname")` 探测 watchman。`_popen` 在 Windows
 * 上是「经 cmd.exe 启动 + **新建控制台窗口**」，而打包版后端由 Electron 以 `ELECTRON_RUN_AS_NODE`
 * 启动（无控制台）→ 每次（重）订阅工作目录都会闪出一个黑色控制台窗口：
 *   打开带工作区的会话、切换会话、工作目录变更（watcher 重建）时各闪一次；
 *   watchman 未安装时该进程瞬间失败，所以窗口「一闪而过」很难截到。
 *
 * 显式传 `"windows"`（原生 ReadDirectoryChangesW）在未安装 watchman 时与 default 的解析结果完全一致，
 * 只是跳过了这次探测——既消除黑窗，也省掉一次子进程。非 Windows 平台保持 `"default"`
 * （POSIX 的 `popen` 不会产生窗口，且 inotify/kqueue 需要 default 解析）。
 */
export const PARCEL_WATCH_OPTIONS: Options =
  process.platform === "win32" ? { backend: "windows" } : {};
