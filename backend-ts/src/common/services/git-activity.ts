/**
 * 后端 git 命令活动标记（跨模块共享，无 DI 依赖，避免 GitModule ↔ SharedModule 循环）。
 *
 * 背景：git 的读命令（status/diff/show）在 stat 缓存过期时会在 .git 内写 index
 * （表现为 index.lock 的 create/delete + index 写入）——这些是「本端读命令引发的噪声」，
 * 会被 .git watcher 捕获并推给前端，造成 读命令 → git 事件 → 刷新 → 读命令 的死循环。
 *
 * GitService 每次读命令后打点；WorkspaceWatcherService 的 .git watcher 据此抑制噪声事件，
 * 只推送真正的外部操作（commit/stage/checkout 等，或非读操作窗口内的 index 变化）。
 */
export const gitActivity = {
  lastReadAt: 0,
};

export function markGitRead(): void {
  gitActivity.lastReadAt = Date.now();
}
