/**
 * 插件页 Skills 的「项目」作用域工具（纯函数，UI 只负责渲染）。
 *
 * 术语：这里的「项目」= 目录项目（`ProjectGroup`，按工作目录分组），
 * 有 `path` / `pathKey`，可作为技能作用域；手工会话文件夹（`SessionGroup`）
 * 没有目录，不能出现在这个下拉里。
 */

import type { ProjectGroup } from '@/types/session'

export interface SkillsProjectOption {
    label: string
    value: string
}

/** 取路径末段（同时接受 `\` 与 `/`，不依赖平台） */
export function workspaceBasename(input: string): string {
    const unified = input.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    const leaf = unified.split('/').filter(Boolean).pop()
    return leaf ?? ''
}

/**
 * 项目下拉选项（不含「全局」项，由调用方自行放在最前）。
 *
 * - 排除 `kind === 'general'`（虚拟「通用」桶，没有唯一目录）与 `path == null`
 *   （无目录无法定位 `.guada/skills`）；
 * - 按 `sortOrder` 升序，保持与侧栏一致的顺序；
 * - **同名的项目必须可区分**：先试「名称 · 目录末段」，若末段也相同（不同父目录
 *   下的同名目录，如两个 `ai_video`），退化为「名称 · 末尾两段」，仍相同则用完整路径。
 */
export function toProjectOptions(groups: readonly ProjectGroup[]): SkillsProjectOption[] {
    const usable = (groups || []).filter(
        (g): g is ProjectGroup & { path: string } =>
            g.kind !== 'general' && !!g.path,
    )
    const nameCount = new Map<string, number>()
    for (const g of usable) {
        nameCount.set(g.name, (nameCount.get(g.name) ?? 0) + 1)
    }

    /** 取路径末尾 n 段（同时接受 `\` 与 `/`） */
    const tail = (input: string, n: number): string => {
        const segments = input.replace(/\\/g, '/').split('/').filter(Boolean)
        return segments.slice(-n).join('/')
    }

    /** 同名时挑选能区分彼此的最短后缀；实在无法区分就用完整路径 */
    const disambiguate = (group: ProjectGroup & { path: string }, siblings: Array<ProjectGroup & { path: string }>): string => {
        for (const depth of [1, 2, 3]) {
            const suffix = tail(group.path, depth)
            const clash = siblings.some(
                (other) => other.id !== group.id && tail(other.path, depth) === suffix,
            )
            if (!clash) return suffix
        }
        return group.path
    }

    return [...usable]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => {
            const duplicated = (nameCount.get(g.name) ?? 0) > 1
            if (!duplicated) return { label: g.name, value: g.id }

            const siblings = usable.filter((other) => other.name === g.name)
            const suffix = disambiguate(g, siblings)
            return { label: `${g.name} · ${suffix}`, value: g.id }
        })
}

/**
 * 校验已选项目是否仍然有效（项目可能被删除）。
 *
 * @returns 有效时返回分组本身；无效/未选择时返回 null（调用方回落「全局」）
 */
export function resolveSelectedProject(
    groups: readonly ProjectGroup[],
    id: string | null | undefined,
): ProjectGroup | null {
    if (!id) return null
    return (
        (groups || []).find(
            (g) => g.id === id && g.kind !== 'general' && !!g.path,
        ) ?? null
    )
}
