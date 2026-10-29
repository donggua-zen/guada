/**
 * 逐回合工具策略（瞬态、不落库）。
 *
 * 语义是「只收窄」：未命中任何放行条件的工具一律不可见、不可执行。
 * 由 Bot 模块按发送者身份注入到 TurnSettingsOverride.internalToolPolicy，
 * 不来自客户端请求，避免外部输入放大权限。
 */
export interface ToolPolicy {
  /** 允许的模型可见工具名（精确匹配） */
  allowedTools?: string[];
  /**
   * 按名称前缀放行：MCP 工具统一命名 mcp__<原始名>，
   * 用它放行「智能体已绑定的全部 MCP」而无需知道动态 server id。
   */
  allowedToolPrefixes?: string[];
}

/** 策略判定的最小工具形状（ToolHandlerDef 兼容） */
export interface ToolPolicyTarget {
  name: string;
  toolSet?: string;
}

/** 工具是否被策略允许；policy 为空表示不限制（由调用方决定是否传入） */
export function isToolAllowedByPolicy(
  policy: ToolPolicy | null | undefined,
  tool: ToolPolicyTarget,
): boolean {
  if (!policy) return true;
  if (policy.allowedTools?.includes(tool.name)) return true;
  return Boolean(
    policy.allowedToolPrefixes?.some((prefix) => tool.name.startsWith(prefix)),
  );
}
