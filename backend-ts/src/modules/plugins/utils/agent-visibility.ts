import { VisibleToAgent } from "../types/plugin.types";

/**
 * 能力作用域判定（v4）：注册内容声明的 visibleTo 是否对当前智能体放行。
 *
 * 语义（与 docs/plugin-agents.md 保持一致）：
 * - 未声明（undefined/空数组）= 全局可见 → 放行（既有智能体层治理不变）
 * - "self" ↔ 本插件注册的智能体（智能体 id 前缀 plugin-<pluginId>- 命中即匹配）
 * - 其余条目 = 智能体 id 精确匹配
 * - 声明了但智能体上下文缺失（agentId 为空）→ 一律不可见（fail-closed：
 *   限定作用域的能力不允许在"不知道当前是谁"的路径上泄露）
 *
 * @param visibleTo   注册时声明的作用域列表
 * @param pluginId    注册方插件 ID（解析 "self"）
 * @param agentId     当前会话绑定的智能体 id；无智能体上下文时为 null/undefined
 */
export function isVisibleToAgent(
  visibleTo: VisibleToAgent | undefined,
  pluginId: string,
  agentId: string | null | undefined,
): boolean {
  if (!visibleTo || visibleTo.length === 0) return true;
  if (!agentId) return false;
  const selfPrefix = `plugin-${pluginId}-`;
  return visibleTo.some((entry) => {
    if (entry === "self") return agentId.startsWith(selfPrefix);
    return entry === agentId;
  });
}
