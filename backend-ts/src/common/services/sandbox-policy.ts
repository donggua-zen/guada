/**
 * 沙盒策略纯函数（从 SandboxEscalationService 拆出，不含任何交互逻辑）。
 *
 * 三档安全模式词表（与 DSH SandboxMode 同构，会话持久化于 settings.sandboxMode，
 * shell 与文件工具同时生效）：read-only < workspace-write < danger-full-access。
 *
 * 模型不能自我提权：越界一律由系统询问用户（命令策略弹窗 / 文件写入审批卡），
 * 无人可应答时 fail-closed 拒绝；档位切换只由用户在界面上完成。
 */

// ==================== 沙盒模式词汇表 ====================

export const ALL_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type SandboxMode = (typeof ALL_SANDBOX_MODES)[number];

/**
 * 用户可选的会话档位。
 *
 * Windows 没有可靠的 OS 级只读沙盒（shell 侧只是命令白名单），
 * read-only 容易让用户误以为存在系统级只读保证，因此不再作为用户档位提供。
 * 计划模式仍在内部使用只读命令策略，见 shell.plugin 的 effectiveMode。
 */
export function supportedSandboxModes(
  platform: NodeJS.Platform = process.platform,
): SandboxMode[] {
  return platform === "win32"
    ? ["workspace-write", "danger-full-access"]
    : [...ALL_SANDBOX_MODES];
}

export function isSandboxModeSupported(
  mode: string,
  platform: NodeJS.Platform = process.platform,
): mode is SandboxMode {
  return (supportedSandboxModes(platform) as readonly string[]).includes(mode);
}

/**
 * 归一化持久化值或客户端传入值。
 *
 * - 未知值回退 workspace-write（fail-safe：不放开到 danger-full-access）
 * - Windows 上的 read-only 转为 workspace-write（用户档位已取消）
 *
 * 计划模式的内部只读不经过这里：shell.plugin 会把 effectiveMode 强制为
 * read-only，与用户会话档位分开。
 */
export function normalizeSandboxMode(
  mode: unknown,
  platform: NodeJS.Platform = process.platform,
): SandboxMode {
  const valid = (ALL_SANDBOX_MODES as readonly unknown[]).includes(mode)
    ? (mode as SandboxMode)
    : "workspace-write";
  return platform === "win32" && valid === "read-only"
    ? "workspace-write"
    : valid;
}

/** 模式 → SandboxOptions（结构兼容 process-manager SandboxOptions；danger-full-access = 无沙盒） */
export function sandboxForMode(
  mode: SandboxMode,
): { enabled: true; readOnly: boolean } | undefined {
  if (mode === "read-only") return { enabled: true, readOnly: true };
  if (mode === "workspace-write") return { enabled: true, readOnly: false };
  return undefined;
}

/**
 * shell 是否支持 OS 级沙盒（sandbox.exe）。
 *
 * Windows 已停用：受限令牌 + ACL 授权在该平台兼容性差（工作区授权失败、MSYS 工具崩溃、
 * 受限语言模式、junction/长路径不可用等），改由命令策略层
 * （command-policy：只读白名单 + 人工审批）承担。设 SANDBOX_WIN_ENABLE=1 可临时恢复，
 * 用于回归对比。
 */
export function isShellSandboxSupported(): boolean {
  return process.platform !== "win32" || process.env.SANDBOX_WIN_ENABLE === "1";
}

/**
 * 命令策略层是否生效。
 *
 * - Windows：默认生效（沙盒停用后由其接管）；重新启用 Windows 沙盒（SANDBOX_WIN_ENABLE=1）时让位
 * - 其它平台：默认不生效（继续用 Landlock/Seatbelt 沙盒），可用 GUADA_COMMAND_POLICY=1 显式启用
 *   （也用于在任意平台跑策略层的端到端测试）
 *
 * 显式开关优先：GUADA_COMMAND_POLICY=1 强制生效，=0 强制关闭。
 */
export function isCommandPolicyEnforced(): boolean {
  if (process.env.GUADA_COMMAND_POLICY === "1") return true;
  if (process.env.GUADA_COMMAND_POLICY === "0") return false;
  return process.platform === "win32" && !isShellSandboxSupported();
}
