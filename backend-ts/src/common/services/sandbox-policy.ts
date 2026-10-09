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

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

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
