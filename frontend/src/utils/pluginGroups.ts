/**
 * 插件 / 技能列表分区工具（纯函数，UI 只负责渲染）。
 *
 * 分区 key 与 i18n 文案一一对应：
 * - 插件：plugins.localTools.groups.{core|extended|user|other}
 * - 技能：plugins.skills.groups.{builtin|plugin|user|shared|workspace}
 */

import type { PluginQueryPlugin } from '@/services/modules/settings.api'
import type { Skill } from '@/types/skills'

export interface ItemGroup<T> {
  key: string
  items: T[]
}

/**
 * 插件按 category 分区：
 * core → 核心；extended → 扩展；category=user 或 source=user/dev → 用户安装；其余 → 其他。
 * 空分区不返回，分区顺序固定。
 */
export function groupPlugins(plugins: PluginQueryPlugin[]): ItemGroup<PluginQueryPlugin>[] {
  const buckets: Record<string, PluginQueryPlugin[]> = {
    core: [],
    extended: [],
    user: [],
    other: [],
  }

  for (const plugin of plugins) {
    if (plugin.category === 'core') {
      buckets.core.push(plugin)
    } else if (plugin.category === 'extended') {
      buckets.extended.push(plugin)
    } else if (
      plugin.category === 'user' ||
      plugin.source === 'user' ||
      plugin.source === 'dev'
    ) {
      buckets.user.push(plugin)
    } else {
      buckets.other.push(plugin)
    }
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => ({ key, items }))
}

/**
 * 本地技能按来源分区（插件托管优先，避免插件技能散落到工作区/全局组）：
 * provider=plugin:* → 插件提供；system → 内置；global → 用户安装；
 * agents → 共享目录；workspace → 工作区；未知兜底到用户安装。
 */
export function groupSkills(skills: Skill[]): ItemGroup<Skill>[] {
  const buckets: Record<string, Skill[]> = {
    builtin: [],
    plugin: [],
    user: [],
    shared: [],
    workspace: [],
  }

  for (const skill of skills) {
    if (skill.provider) {
      buckets.plugin.push(skill)
    } else if (skill.source === 'system') {
      buckets.builtin.push(skill)
    } else if (skill.source === 'global') {
      buckets.user.push(skill)
    } else if (skill.source === 'agents') {
      buckets.shared.push(skill)
    } else if (skill.source === 'workspace') {
      buckets.workspace.push(skill)
    } else {
      buckets.user.push(skill)
    }
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => ({ key, items }))
}
