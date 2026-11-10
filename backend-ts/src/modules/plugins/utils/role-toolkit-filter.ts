import { RolePluginConfig, RolePluginEntryConfig } from "../types/plugin.types";

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

/**
 * v4.1：按完整角色配置判断某个（非自治理）工具包是否放行。
 *
 * 与 `isToolkitAllowedByRoleConfig` 的区别：本函数消费顶层批量开关，
 * 镜像 `PluginManager.applyRoleLayer` 的完整语义：
 * - `__strategy: "deny_nonsystem"` → 全部非受保护包拒绝（静态场景无法识别
 *   essential 插件，按拒绝处理；当前绑定技能的能力包均为 core 分类）
 * - `__default: false` 白名单模式：无条目的插件 → 全部拒绝
 * - 有条目 → 复用单条语义
 *
 * 供无 ISessionContext 的命令解析路径（如 /skill 内联）做能力包静态门控。
 */
export function isKitAllowedByRoleConfig(
  roleCfg: RolePluginConfig | undefined | null,
  pluginId: string,
  toolkitId: string,
): boolean {
  if (!roleCfg || typeof roleCfg !== "object") return true;
  if (roleCfg.__strategy === "deny_nonsystem") return false;
  const entry = roleCfg[pluginId];
  if (!entry || typeof entry !== "object") {
    return roleCfg.__default !== false;
  }
  return isToolkitAllowedByRoleConfig(
    entry as RolePluginEntryConfig,
    toolkitId,
  );
}
