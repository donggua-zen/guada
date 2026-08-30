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
