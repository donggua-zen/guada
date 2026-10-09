/**
 * 沙盒策略纯函数（从 SandboxEscalationService 拆出，不含任何交互逻辑）。
 *
 * 三档安全模式词表（与 DSH SandboxMode 同构，会话持久化于 settings.sandboxMode，
 * shell 与文件工具同时生效）：read-only < workspace-write < danger-full-access；
 * 提权 = 模型在工具参数里带 sandbox_permissions + justification，经审批后 one-shot 放宽。
 */

// ==================== 沙盒模式词汇表 ====================

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** 严格放宽阶梯（对齐 DSH WIDER_MODES）：每个模式的"严格更宽"集合 */
export const WIDER_MODES: Record<SandboxMode, SandboxMode[]> = {
  "read-only": ["workspace-write", "danger-full-access"],
  "workspace-write": ["danger-full-access"],
  "danger-full-access": [],
};

/** 可在工具 schema 中暴露的提权目标（对齐 DSH ESCALATION_TARGETS） */
export const ESCALATION_TARGETS = [
  "workspace-write",
  "danger-full-access",
] as const satisfies readonly SandboxMode[];

/**
 * 解析提权参数（sandbox_permissions + justification 必须成对、理由非空）。
 * 返回 null = 未请求提权；解析失败抛错（参数语义错误，非审批拒绝）。
 */
export function parseEscalationArgs(
  sandboxPermissions?: "workspace-write" | "danger-full-access",
  justification?: string,
): { mode: "workspace-write" | "danger-full-access"; justification: string } | null {
  if (sandboxPermissions === undefined && justification === undefined) {
    return null;
  }
  if (
    sandboxPermissions === undefined ||
    justification === undefined ||
    !justification.trim()
  ) {
    throw new Error(
      "sandbox_permissions and justification must be provided together, and justification must be a non-empty sentence.",
    );
  }
  return { mode: sandboxPermissions, justification: justification.trim() };
}

/** 模式 → SandboxOptions（结构兼容 process-manager SandboxOptions；danger-full-access = 无沙盒） */
export function sandboxForMode(
  mode: SandboxMode,
): { enabled: true; readOnly: boolean } | undefined {
  if (mode === "read-only") return { enabled: true, readOnly: true };
  if (mode === "workspace-write") return { enabled: true, readOnly: false };
  return undefined;
}

/** 严格放宽校验：非放宽请求（平级/降级）直接抛错，永不打扰人（对齐 DSH） */
export function assertStrictlyWider(current: SandboxMode, requested: SandboxMode): void {
  if (!WIDER_MODES[current].includes(requested)) {
    const wider = WIDER_MODES[current].join(", ") || "无";
    throw new Error(
      `非严格放宽的提权请求: ${current} → ${requested}（只有 ${wider} 才构成提权）`,
    );
  }
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
