/**
 * 会话安全档位词表与平台收敛（与后端 sandbox-policy 同构）。
 *
 * 前端保留 read-only 字面量用于历史会话/排队消息兼容；是否把它渲染成
 * 可选档位由后端 /capabilities 返回的 sandboxModes 决定。
 */
export const ALL_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type SandboxMode = (typeof ALL_SANDBOX_MODES)[number];

export function isSandboxMode(value: unknown): value is SandboxMode {
  return (ALL_SANDBOX_MODES as readonly unknown[]).includes(value);
}

export function supportedSandboxModes(
  platform: string | null | undefined,
): SandboxMode[] {
  return platform === "win32"
    ? ["workspace-write", "danger-full-access"]
    : [...ALL_SANDBOX_MODES];
}

/** 未知值回退 workspace-write；Windows 上 read-only 转为 workspace-write。 */
export function normalizeSandboxMode(
  mode: unknown,
  platform: string | null | undefined,
): SandboxMode {
  const valid = isSandboxMode(mode) ? mode : "workspace-write";
  return platform === "win32" && valid === "read-only"
    ? "workspace-write"
    : valid;
}
