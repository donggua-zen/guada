import { RolePluginEntryConfig } from "../types/plugin.types";

/**
 * 依据智能体层条目判断某个工具包是否放行。
 *
 * 供 `ToolKitDef.governance === "self"` 的工具包在自己的 handler 中复用——
 * 自治理工具包不参与 `applyRoleLayer` 的智能体层过滤，改为在这里按需裁决，
 * 因此本函数的语义必须与 `applyRoleLayer` 的条目分支保持一致：
 *
 * - 白名单（`toolkits_filter: "allow"`）：先全拒，再放行 `toolkits_allow` 中列出的
 * - 黑名单（默认）：拒绝 `toolkits_deny` 中列出的，其余放行
 * - 全部禁用（`toolkits_filter: "deny_all"`）：压过两个列表，全部拒绝
 * - 无条目 / 条目为遗留的裸布尔或字符串：按未配置处理 → 放行
 *
 * 两个批量开关（`__strategy`、`__default`）刻意不参与：它们的字面含义是
 * "通用工具包界面的批量开关"，不触碰由自有界面管辖的能力包。自治理工具包
 * 缺条目即等于"没管过"，按默认全放行。
 *
 * @param entry  智能体配置中该插件的条目（`roleCfg[pluginId]`），可能为 undefined 或遗留形态
 * @param toolkitId 工具包 ID
 * @returns 是否放行
 */
export function isToolkitAllowedByRoleConfig(
  entry: RolePluginEntryConfig | boolean | string | undefined | null,
  toolkitId: string,
): boolean {
  if (!entry || typeof entry !== "object") return true;

  // 全部禁用：压过列表，两个列表原样保留供解除时恢复
  if (entry.toolkits_filter === "deny_all") return false;

  if (entry.toolkits_filter === "allow") {
    return (entry.toolkits_allow || []).includes(toolkitId);
  }
  return !(entry.toolkits_deny || []).includes(toolkitId);
}
