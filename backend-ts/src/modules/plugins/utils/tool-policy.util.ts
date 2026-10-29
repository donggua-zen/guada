import type { ResolvedPluginInfo } from '../types/plugin.types';
import {
  isToolAllowedByPolicy,
  type ToolPolicy,
  type ToolPolicyTarget,
} from '../../../common/types/tool-policy';

/**
 * 在插件决议结果上应用工具白名单（只收窄）。
 *
 * 必须同时过滤 enabledTools / allTools / enabledToolKits 三者：
 * - enabledTools 决定广告给 LLM 的工具面；
 * - allTools 是 tool_use / tool_learn 的懒加载通道（ToolExecutor.findTool 第 2 遍），
 *   不过滤就会被用来调出白名单外工具；
 * - enabledToolKits 的 loadMode/enabled 决定提示词与 activator 是否进入运行时，
 *   包内没有剩余允许工具时整包置为不可用，避免"看起来有这个工具包"误导模型。
 *
 * 返回新数组（含新对象），不修改入参——调用方直接替换 this.resolvedPlugins。
 */
export function applyToolPolicy(
  resolved: ResolvedPluginInfo[],
  policy: ToolPolicy,
): ResolvedPluginInfo[] {
  if (!policy) return resolved;

  return resolved.map((rp) => {
    const enabledTools = rp.enabledTools.filter((tool) =>
      isToolAllowedByPolicy(policy, tool as ToolPolicyTarget),
    );
    const allTools = rp.allTools.filter((tool) =>
      isToolAllowedByPolicy(policy, tool as ToolPolicyTarget),
    );

    const enabledToolKits = rp.enabledToolKits.map((kit) => {
      const remaining = allTools.filter((tool) => tool.toolSet === kit.id).length;
      if (kit.enabled && remaining === 0) {
        // 包内没有剩余允许工具：整包置为不可用（提示词/activator 一并退出运行时）
        return { ...kit, enabled: false, loadMode: 'none' as const };
      }
      return kit;
    });

    return { ...rp, enabledTools, allTools, enabledToolKits };
  });
}
